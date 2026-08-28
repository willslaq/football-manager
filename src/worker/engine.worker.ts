// Instancia o motor e roteia mensagens tipadas entre a UI e o motor de simulação.
// Único lugar com estado mutável de carreira — o motor em si continua puro.

import {
  advanceRound,
  createBrasileiraoCareer,
  generateSeason,
  generateWorld,
  pickAutoLineup,
  setTacticalIntensity,
  validateCareerState,
} from '../engine';
import type { CareerState, EngineTraceEntry, Lineup, Tactics } from '../engine/types';
import { runLiveMatch, type ChanceTraceEntry, type LiveMatchController, type PossessionTraceEntry } from './liveMatch';
import type { ClubSummary, EngineRequest, EngineResponse } from './protocol';

let career: CareerState | null = null;
const liveSessions = new Map<string, LiveMatchController>();

const DEFAULT_TACTICS: Tactics = { formation: '4-4-2', style: 'balanced' };

function buildSuggestedLineup(state: CareerState): Lineup {
  const club = state.world.clubs.find((c) => c.id === state.playerClubId);
  if (!club) throw new Error(`Clube do jogador não encontrado (${state.playerClubId})`);
  const playersById = new Map(state.world.players.map((p) => [p.id, p]));
  const squad = club.squad.map((id) => playersById.get(id)!);
  const starters = pickAutoLineup(squad, DEFAULT_TACTICS.formation);
  const ids = starters.map((p) => p.id);
  return {
    starters: ids,
    formation: DEFAULT_TACTICS.formation,
    captain: ids[0],
    penaltyTaker: ids[ids.length - 1],
    freeKickTaker: ids[ids.length - 1],
  };
}

function respond(response: EngineResponse): void {
  self.postMessage(response);
}

self.onmessage = (event: MessageEvent<EngineRequest>) => {
  const request = event.data;

  try {
    switch (request.type) {
      case 'listClubs': {
        const world = generateWorld(request.payload.seed);

        // Posição real na tabela atual — dado de verdade, não estimado a partir da reputação.
        const standings = [...generateSeason().competitions[0].standings].sort((a, b) => {
          if (b.points !== a.points) return b.points - a.points;
          if (b.won !== a.won) return b.won - a.won;
          const gdDiff = b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst);
          if (gdDiff !== 0) return gdDiff;
          return b.goalsFor - a.goalsFor;
        });
        const positionByClub = new Map(standings.map((entry, index) => [entry.clubId, index + 1]));

        const clubs: ClubSummary[] = world.clubs
          .map((c) => ({
            id: c.id,
            name: c.name,
            shortName: c.shortName,
            reputation: c.reputation,
            colors: c.colors,
            tablePosition: positionByClub.get(c.id) ?? 0,
          }))
          .sort((a, b) => a.tablePosition - b.tablePosition);
        respond({ type: 'clubsList', requestId: request.requestId, payload: { clubs } });
        break;
      }

      case 'startCareer': {
        const state = createBrasileiraoCareer(
          request.payload.seed,
          { id: 'trainer-1', name: request.payload.trainerName },
          request.payload.clubId,
          request.payload.tacticalIntensity,
        );
        career = state;
        respond({
          type: 'careerState',
          requestId: request.requestId,
          payload: { state, suggestedLineup: buildSuggestedLineup(state), suggestedTactics: DEFAULT_TACTICS },
        });
        break;
      }

      case 'advanceRound': {
        if (!career) throw new Error('Nenhuma carreira iniciada');
        const previousRound = career.season.currentRound;
        const engineTrace: EngineTraceEntry[] = [];
        const nextState = advanceRound(career, {
          playerLineup: request.payload.playerLineup,
          playerTactics: request.payload.playerTactics,
          onPlayerChance: (entry) => engineTrace.push(entry),
        });
        career = nextState;

        const playedRound = nextState.season.competitions[0].fixtures[previousRound - 1];
        const playerFixture = playedRound.find(
          (f) => f.homeTeamId === nextState.playerClubId || f.awayTeamId === nextState.playerClubId,
        );
        const playerMatch = playerFixture?.result ?? null;

        const sendRoundResult = (): void => {
          respond({
            type: 'roundResult',
            requestId: request.requestId,
            payload: { state: nextState, playerMatch },
          });
        };

        if (!playerMatch) {
          sendRoundResult();
          break;
        }

        respond({
          type: 'liveMatchStarted',
          requestId: request.requestId,
          payload: { homeTeamId: playerMatch.homeTeamId, awayTeamId: playerMatch.awayTeamId },
        });

        // A entrada 'setup' é a análise pré-jogo (força por setor, posse, nº de chances) — chega
        // de uma vez, sem espera; as entradas 'chance' são pareadas por minuto com os eventos.
        const setupEntry = engineTrace.find((entry) => entry.kind === 'setup');
        if (setupEntry) {
          respond({ type: 'liveMatchTrace', requestId: request.requestId, payload: { entry: setupEntry } });
        }
        const chanceTrace = engineTrace.filter((entry): entry is ChanceTraceEntry => entry.kind === 'chance');
        const possessionTrace = engineTrace.filter((entry): entry is PossessionTraceEntry => entry.kind === 'possession');

        const controller = runLiveMatch(
          playerMatch,
          { chances: chanceTrace, possession: possessionTrace },
          {
            onEvent: (event, homeGoals, awayGoals) =>
              respond({ type: 'liveMatchEvent', requestId: request.requestId, payload: { event, homeGoals, awayGoals } }),
            onTrace: (entry) => respond({ type: 'liveMatchTrace', requestId: request.requestId, payload: { entry } }),
            onTick: (minute, homeGoals, awayGoals, possessionHome) =>
              respond({
                type: 'liveMatchTick',
                requestId: request.requestId,
                payload: { minute, homeGoals, awayGoals, possessionHome },
              }),
          },
        );
        liveSessions.set(request.requestId, controller);
        controller.done.then(() => {
          liveSessions.delete(request.requestId);
          sendRoundResult();
        });
        break;
      }

      case 'skipLiveMatch': {
        liveSessions.get(request.payload.liveRequestId)?.skip();
        break;
      }

      case 'setLiveMatchSpeed': {
        liveSessions.get(request.payload.liveRequestId)?.setSpeed(request.payload.speed);
        break;
      }

      case 'setLiveMatchPaused': {
        liveSessions.get(request.payload.liveRequestId)?.setPaused(request.payload.paused);
        break;
      }

      case 'setCareer': {
        // Saves de antes do modo tático (settings.tacticalIntensity) não têm o campo — completa com o padrão.
        // Saves de antes das defesas do goleiro (seasonStats.saves) idem — completa com 0.
        const incoming = request.payload.state;
        const normalized: CareerState = {
          ...incoming,
          settings: incoming.settings ?? { tacticalIntensity: 'subtle' },
          world: {
            ...incoming.world,
            players: incoming.world.players.map((player) => ({
              ...player,
              seasonStats: { ...player.seasonStats, saves: player.seasonStats.saves ?? 0 },
            })),
          },
        };
        const result = validateCareerState(normalized);
        if (!result.valid) {
          throw new Error(`Estado de carreira inválido: ${result.errors.slice(0, 5).join('; ')}`);
        }
        career = normalized;
        respond({
          type: 'careerState',
          requestId: request.requestId,
          payload: {
            state: career,
            suggestedLineup: buildSuggestedLineup(career),
            suggestedTactics: DEFAULT_TACTICS,
          },
        });
        break;
      }

      case 'setTacticalIntensity': {
        if (!career) throw new Error('Nenhuma carreira iniciada');
        career = setTacticalIntensity(career, request.payload.tacticalIntensity);
        respond({ type: 'settingsUpdated', requestId: request.requestId, payload: { state: career } });
        break;
      }
    }
  } catch (err) {
    respond({
      type: 'error',
      requestId: request.requestId,
      payload: { message: err instanceof Error ? err.message : String(err) },
    });
  }
};
