// Instancia o motor e roteia mensagens tipadas entre a UI e o motor de simulação.
// Único lugar com estado mutável de carreira — o motor em si continua puro.

import {
  commitPlayerMatchResult,
  createBrasileiraoCareer,
  generateSeason,
  generateWorld,
  MAX_SUBSTITUTIONS_PER_TEAM,
  pickAutoLineup,
  setTacticalIntensity,
  simulateMatch,
  simulateRound,
  startNewSeason,
  validateCareerState,
} from '../engine';
import type { MatchSubstitution, MatchTeamInput } from '../engine';
import type { CareerState, EngineTraceEntry, Fixture, Lineup, MatchResult, Tactics } from '../engine/types';
import {
  runLiveMatch,
  type ChanceTraceEntry,
  type EnergyTraceEntry,
  type LiveMatchController,
  type OtherRoundResult,
  type PossessionTraceEntry,
} from './liveMatch';
import type { ClubSummary, EngineRequest, EngineResponse } from './protocol';

/**
 * Sessão de uma partida do jogador em transmissão ao vivo — guarda tudo que
 * `requestSubstitution` precisa pra rerodar `simulateMatch` do zero com a mesma seed (ver
 * match.ts's determinismo de prefixo) e, no fim, comitar o resultado final via
 * `commitPlayerMatchResult` (ver season.ts).
 */
interface LiveMatchSession {
  controller: LiveMatchController;
  homeTeamInput: MatchTeamInput;
  awayTeamInput: MatchTeamInput;
  seed: number;
  playerFixture: Fixture;
  roundIndex: number;
  playerTeamSide: 'home' | 'away';
  /** Substituições confirmadas até agora, acumuladas — reenviadas por inteiro a cada nova rodada de `simulateMatch`. */
  substitutions: MatchSubstitution[];
  latestResult: MatchResult;
  latestTrace: EngineTraceEntry[];
  subCount: number;
  /** Último minuto "batido" pelo relógio ao vivo (ver onTick) — ponto de corte de uma nova substituição. */
  currentMinute: number;
}

let career: CareerState | null = null;
const liveSessions = new Map<string, LiveMatchSession>();

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
        const engineTrace: EngineTraceEntry[] = [];
        const { nextState, roundIndex, playerFixture, playerMatchResult, homeTeamInput, awayTeamInput, seed } =
          simulateRound(career, {
            playerLineup: request.payload.playerLineup,
            playerTactics: request.payload.playerTactics,
            onPlayerChance: (entry) => engineTrace.push(entry),
          });
        career = nextState;

        const sendRoundResult = (state: CareerState, playerMatch: MatchResult | null): void => {
          respond({ type: 'roundResult', requestId: request.requestId, payload: { state, playerMatch } });
        };

        if (!playerFixture || !playerMatchResult || !homeTeamInput || !awayTeamInput || seed === undefined) {
          sendRoundResult(career, null);
          break;
        }

        // Os demais confrontos da rodada já foram comitados por completo dentro de `simulateRound`
        // (mesmo motor, ver season.ts) — só a entrega ao vivo do jogo do jogador é escalonada no
        // tempo; os outros "chegam" aos poucos, gol a gol, no mesmo minuto em que aconteceram na
        // simulação deles (mesma linha do tempo — todos os jogos da rodada acontecem "ao mesmo tempo").
        const playedRound = career.season.competitions[0].fixtures[roundIndex];
        const otherFixtures = playedRound.filter((f) => f !== playerFixture);
        const otherResults: OtherRoundResult[] = otherFixtures.map((fixture) => ({ fixture }));

        respond({
          type: 'liveMatchStarted',
          requestId: request.requestId,
          payload: {
            homeTeamId: playerMatchResult.homeTeamId,
            awayTeamId: playerMatchResult.awayTeamId,
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
        const energyTrace = engineTrace.filter((entry): entry is EnergyTraceEntry => entry.kind === 'energy');

        const controller = runLiveMatch(
          playerMatchResult,
          { chances: chanceTrace, possession: possessionTrace, energy: energyTrace },
          {
            onEvent: (event, homeGoals, awayGoals) =>
              respond({ type: 'liveMatchEvent', requestId: request.requestId, payload: { event, homeGoals, awayGoals } }),
            onTrace: (entry) => respond({ type: 'liveMatchTrace', requestId: request.requestId, payload: { entry } }),
            onTick: (minute, homeGoals, awayGoals, possessionHome, energyByPlayerId) => {
              const session = liveSessions.get(request.requestId);
              if (session) session.currentMinute = minute;
              respond({
                type: 'liveMatchTick',
                requestId: request.requestId,
                payload: { minute, homeGoals, awayGoals, possessionHome, energyByPlayerId },
              });
            },
            onOtherResult: (fixture: Fixture, homeGoals: number, awayGoals: number, finished: boolean) =>
              respond({
                type: 'liveMatchOtherResult',
                requestId: request.requestId,
                payload: { fixture, homeGoals, awayGoals, finished },
              }),
          },
          otherResults,
        );
        liveSessions.set(request.requestId, {
          controller,
          homeTeamInput,
          awayTeamInput,
          seed,
          playerFixture,
          roundIndex,
          playerTeamSide: playerFixture.homeTeamId === career.playerClubId ? 'home' : 'away',
          substitutions: [],
          latestResult: playerMatchResult,
          latestTrace: engineTrace,
          subCount: 0,
          currentMinute: 0,
        });
        controller.done.then(() => {
          const session = liveSessions.get(request.requestId);
          liveSessions.delete(request.requestId);
          if (!session || !career) return;

          // Anexa o rastro técnico bruto da última simulação (com ou sem substituições) ao
          // result final antes de persistir — sem isso ele existiria só na transmissão ao vivo.
          const finalResult: MatchResult =
            session.latestTrace.length > 0 ? { ...session.latestResult, trace: session.latestTrace } : session.latestResult;

          career = commitPlayerMatchResult(
            career,
            { playerFixture: session.playerFixture, roundIndex: session.roundIndex, homeTeamInput, awayTeamInput },
            finalResult,
          );
          sendRoundResult(career, finalResult);
        });
        break;
      }

      case 'requestSubstitution': {
        if (!career) throw new Error('Nenhuma carreira iniciada');
        const session = liveSessions.get(request.payload.liveRequestId);
        if (!session) throw new Error('Sessão de partida ao vivo não encontrada');

        const { substitutions: requested } = request.payload;
        if (session.subCount + requested.length > MAX_SUBSTITUTIONS_PER_TEAM) {
          throw new Error(`Limite de ${MAX_SUBSTITUTIONS_PER_TEAM} substituições por partida excedido`);
        }
        const alreadyOut = new Set(session.substitutions.map((s) => s.playerOutId));
        const alreadyIn = new Set(session.substitutions.map((s) => s.playerIn.id));
        for (const { playerOutId, playerInId } of requested) {
          if (alreadyOut.has(playerOutId) || alreadyIn.has(playerInId)) {
            throw new Error('Substituição repetida: jogador já saiu ou já entrou nessa partida');
          }
        }

        const playersById = new Map(career.world.players.map((p) => [p.id, p]));
        const teamInput = session.playerTeamSide === 'home' ? session.homeTeamInput : session.awayTeamInput;
        const fromMinute = session.currentMinute;
        const newSubs: MatchSubstitution[] = requested.map(({ playerOutId, playerInId }) => {
          const playerIn = playersById.get(playerInId);
          if (!playerIn) throw new Error(`Jogador reserva não encontrado (${playerInId})`);
          return {
            minute: fromMinute + 1,
            teamSide: session.playerTeamSide,
            playerOutId,
            playerIn,
            slotPosition: teamInput.slotPositionByPlayerId?.[playerOutId],
          };
        });

        session.substitutions.push(...newSubs);

        const newTrace: EngineTraceEntry[] = [];
        const newResult = simulateMatch(
          session.homeTeamInput,
          session.awayTeamInput,
          session.seed,
          career.settings.tacticalIntensity,
          (entry) => newTrace.push(entry),
          session.substitutions,
        );

        const newChanceTrace = newTrace.filter((entry): entry is ChanceTraceEntry => entry.kind === 'chance');
        const newPossessionTrace = newTrace.filter((entry): entry is PossessionTraceEntry => entry.kind === 'possession');
        const newEnergyTrace = newTrace.filter((entry): entry is EnergyTraceEntry => entry.kind === 'energy');
        session.controller.applyNewResult(
          newResult,
          { chances: newChanceTrace, possession: newPossessionTrace, energy: newEnergyTrace },
          fromMinute,
        );
        session.latestResult = newResult;
        session.latestTrace = newTrace;
        session.subCount += newSubs.length;

        respond({
          type: 'liveMatchSubstitutionApplied',
          requestId: request.requestId,
          payload: {
            substitutions: newSubs.map((s) => ({ playerOutId: s.playerOutId, playerInId: s.playerIn.id })),
            subCount: session.subCount,
          },
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
        liveSessions.get(request.payload.liveRequestId)?.controller.skip();
        break;
      }

      case 'setLiveMatchSpeed': {
        liveSessions.get(request.payload.liveRequestId)?.controller.setSpeed(request.payload.speed);
        break;
      }

      case 'setLiveMatchPaused': {
        liveSessions.get(request.payload.liveRequestId)?.controller.setPaused(request.payload.paused);
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
