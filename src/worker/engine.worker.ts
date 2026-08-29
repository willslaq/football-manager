// Instancia o motor e roteia mensagens tipadas entre a UI e o motor de simulação.
// Único lugar com estado mutável de carreira — o motor em si continua puro.

import {
  advanceRound,
  createBrasileiraoCareer,
  deriveSeed,
  generateSeason,
  generateWorld,
  mulberry32,
  pickAutoLineup,
  roll,
  setTacticalIntensity,
  startNewSeason,
  validateCareerState,
} from '../engine';
import type { CareerState, EngineTraceEntry, Fixture, Lineup, Tactics } from '../engine/types';
import {
  runLiveMatch,
  type ChanceTraceEntry,
  type LiveMatchController,
  type OtherRoundResult,
  type PossessionTraceEntry,
} from './liveMatch';
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
        const simulatedState = advanceRound(career, {
          playerLineup: request.payload.playerLineup,
          playerTactics: request.payload.playerTactics,
          onPlayerChance: (entry) => engineTrace.push(entry),
        });

        // Anexa o rastro técnico bruto (gerado só pro fixture do jogador, acima) ao result desse
        // fixture antes de persistir — sem isso ele existiria só na transmissão ao vivo e se perderia.
        const roundIndex = previousRound - 1;
        const simulatedRound = simulatedState.season.competitions[0].fixtures[roundIndex];
        const enrichedRound = simulatedRound.map((fixture) => {
          const isPlayerFixture =
            fixture.homeTeamId === simulatedState.playerClubId || fixture.awayTeamId === simulatedState.playerClubId;
          if (!isPlayerFixture || !fixture.result || engineTrace.length === 0) return fixture;
          return { ...fixture, result: { ...fixture.result, trace: engineTrace } };
        });
        const nextState: CareerState = {
          ...simulatedState,
          season: {
            ...simulatedState.season,
            competitions: [
              {
                ...simulatedState.season.competitions[0],
                fixtures: simulatedState.season.competitions[0].fixtures.map((round, i) =>
                  i === roundIndex ? enrichedRound : round,
                ),
              },
            ],
          },
        };
        career = nextState;

        const playedRound = nextState.season.competitions[0].fixtures[roundIndex];
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

        // Os demais confrontos da rodada já foram simulados por completo dentro de `advanceRound`
        // (mesmo motor, ver season.ts) — só a entrega ao vivo do jogo do jogador é escalonada no
        // tempo; os outros "chegam" aos poucos, em minutos sorteados de forma determinística (mesma
        // seed da carreira), pra dar a sensação de estarem acontecendo ao mesmo tempo.
        const otherFixtures = playedRound.filter((f) => f !== playerFixture);
        const revealRng = mulberry32(deriveSeed(nextState.seed, `roundReveal:${previousRound}`));
        const otherResults: OtherRoundResult[] = otherFixtures.map((fixture) => ({
          fixture,
          revealMinute: roll(revealRng, 5, 90),
        }));

        respond({
          type: 'liveMatchStarted',
          requestId: request.requestId,
          payload: {
            homeTeamId: playerMatch.homeTeamId,
            awayTeamId: playerMatch.awayTeamId,
            otherFixtures: otherFixtures.map((f) => ({ homeTeamId: f.homeTeamId, awayTeamId: f.awayTeamId })),
          },
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
            onOtherResult: (fixture: Fixture) =>
              respond({ type: 'liveMatchOtherResult', requestId: request.requestId, payload: { fixture } }),
          },
          otherResults,
        );
        liveSessions.set(request.requestId, controller);
        controller.done.then(() => {
          liveSessions.delete(request.requestId);
          sendRoundResult();
        });
        break;
      }

      case 'startNewSeason': {
        if (!career) throw new Error('Nenhuma carreira iniciada');
        career = startNewSeason(career);
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
        // Saves de antes do motor de faltas não têm `aggression` nos atributos do jogador — sem isso,
        // todo cálculo de falta (simulation/fouls.ts) vira NaN silenciosamente (chance(rng, NaN) é
        // sempre falso) e faltas/cartões somem pro resto da carreira sem erro nenhum. Completa com 50
        // (neutro — mesmo "jogador médio" usado pra calibrar o motor).
        // Saves de antes da suspensão por cartão não têm pendingYellowCards/suspendedMatches — sem
        // isso, o decremento em updatePlayerStats (season.ts) vira NaN silenciosamente. Completa com 0.
        // Saves de antes da moral de clube não têm `Club.morale` — completa com 70 (neutro).
        // Saves de antes do resumo de temporada (history) só tinham {year, competitionId, champion} —
        // completa os campos novos com "vazio" (sem Libertadores/rebaixados/artilheiro/luva de ouro
        // registrados retroativamente pra temporadas já encerradas antes dessa versão).
        const incoming = request.payload.state;
        const normalized: CareerState = {
          ...incoming,
          settings: incoming.settings ?? { tacticalIntensity: 'subtle' },
          world: {
            ...incoming.world,
            clubs: incoming.world.clubs.map((club) => ({ ...club, morale: club.morale ?? 70 })),
            players: incoming.world.players.map((player) => ({
              ...player,
              attributes:
                typeof player.attributes.aggression === 'number' ? player.attributes : { ...player.attributes, aggression: 50 },
              seasonStats: { ...player.seasonStats, saves: player.seasonStats.saves ?? 0 },
              pendingYellowCards: player.pendingYellowCards ?? 0,
              suspendedMatches: player.suspendedMatches ?? 0,
            })),
          },
          history: incoming.history.map((entry) => ({
            ...entry,
            libertadores: entry.libertadores ?? [],
            relegated: entry.relegated ?? [],
            topScorer: entry.topScorer ?? null,
            goldenGlove: entry.goldenGlove ?? null,
          })),
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
