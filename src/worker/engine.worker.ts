// Instancia o motor e roteia mensagens tipadas entre a UI e o motor de simulação.
// Único lugar com estado mutável de carreira — o motor em si continua puro.

import {
  advanceCalendar,
  backfillFixtureDates,
  commitPlayerMatchResult,
  createBrasileiraoCareer,
  generateAcademyIntake,
  generateSeason,
  generateWorld,
  initialStandingsByClub,
  MAX_SUBSTITUTIONS_PER_TEAM,
  pickAutoLineup,
  promotePlayer,
  setTacticalIntensity,
  simulateMatch,
  startMatchDay,
  startNewSeason,
  validateCareerState,
} from '../engine';
import type { MatchSubstitution, MatchTeamInput } from '../engine';
import type { CareerState, CompetitionId, EngineTraceEntry, Fixture, Lineup, MatchResult, Tactics } from '../engine/types';
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
  competitionId: CompetitionId;
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

        // Posição real na tabela atual (da PRÓPRIA divisão do clube) — dado de verdade, não
        // estimado a partir da reputação. Ver `initialStandingsByClub` (generation/season.ts).
        const standingByClub = initialStandingsByClub();

        const clubs: ClubSummary[] = world.clubs
          .map((c) => {
            const standing = standingByClub.get(c.id);
            return {
              id: c.id,
              name: c.name,
              shortName: c.shortName,
              reputation: c.reputation,
              colors: c.colors,
              tablePosition: standing?.position ?? 0,
              division: (standing?.competitionId.includes('serie-b') ? 'B' : 'A') as 'A' | 'B',
            };
          })
          .sort((a, b) => (a.division === b.division ? a.tablePosition - b.tablePosition : a.division === 'A' ? -1 : 1));
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

      case 'advanceTime': {
        if (!career) throw new Error('Nenhuma carreira iniciada');
        const { nextState, simulatedAlongTheWay, seasonFinished } = advanceCalendar(career, {
          playerLineup: request.payload.playerLineup,
          playerTactics: request.payload.playerTactics,
        });
        career = nextState;

        if (simulatedAlongTheWay.length > 0) {
          respond({ type: 'passedFixtures', requestId: request.requestId, payload: { fixtures: simulatedAlongTheWay } });
        }

        // Só move o calendário — nunca inicia a partida sozinho, mesmo ao chegar exatamente no
        // dia do próximo jogo do jogador. Iniciar é uma ação separada (`startMatch`, ver a UI:
        // o botão vira "Iniciar Partida" quando `career.season.currentDate` bate com essa data).
        respond({ type: 'roundResult', requestId: request.requestId, payload: { state: career, playerMatch: null, seasonFinished } });
        break;
      }

      case 'startMatch': {
        if (!career) throw new Error('Nenhuma carreira iniciada');
        const engineTrace: EngineTraceEntry[] = [];
        const {
          nextState,
          competitionId,
          roundIndex,
          playerFixture,
          playerMatchResult,
          homeTeamInput,
          awayTeamInput,
          seed,
          sameDateFixtures,
          simulatedAlongTheWay,
          seasonFinished,
        } = startMatchDay(career, {
          playerLineup: request.payload.playerLineup,
          playerTactics: request.payload.playerTactics,
          onPlayerChance: (entry) => engineTrace.push(entry),
        });
        career = nextState;

        // Só populado quando esse era o último jogo do jogador na temporada (ver startMatchDay's
        // varredura do resto do calendário) — "enquanto isso" de jogos que nunca vão ficar "ao
        // vivo" já que não há mais partida do jogador pra assistir depois.
        if (simulatedAlongTheWay.length > 0) {
          respond({ type: 'passedFixtures', requestId: request.requestId, payload: { fixtures: simulatedAlongTheWay } });
        }

        const sendRoundResult = (state: CareerState, playerMatch: MatchResult | null, finished: boolean): void => {
          respond({ type: 'roundResult', requestId: request.requestId, payload: { state, playerMatch, seasonFinished: finished } });
        };

        if (
          !playerFixture ||
          !playerMatchResult ||
          !homeTeamInput ||
          !awayTeamInput ||
          seed === undefined ||
          competitionId === undefined ||
          roundIndex === undefined
        ) {
          // Defensivo — não deveria acontecer (startMatch só é enviado quando currentDate já é
          // dia de jogo do jogador, ver o comentário em AdvanceTimeRequest).
          sendRoundResult(career, null, seasonFinished);
          break;
        }

        // Os demais jogos da MESMA DATA já foram comitados dentro de `startMatchDay` — só a
        // entrega ao vivo do jogo do jogador é escalonada no tempo; os outros "chegam" aos poucos,
        // gol a gol, no mesmo minuto em que aconteceram na simulação deles (mesma linha do tempo).
        const otherResults: OtherRoundResult[] = sameDateFixtures.map((fixture) => ({ fixture }));

        respond({
          type: 'liveMatchStarted',
          requestId: request.requestId,
          payload: {
            homeTeamId: playerMatchResult.homeTeamId,
            awayTeamId: playerMatchResult.awayTeamId,
            otherFixtures: sameDateFixtures.map((f) => ({ homeTeamId: f.homeTeamId, awayTeamId: f.awayTeamId })),
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
          competitionId,
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
            {
              playerFixture: session.playerFixture,
              competitionId: session.competitionId,
              roundIndex: session.roundIndex,
              homeTeamInput,
              awayTeamInput,
            },
            finalResult,
          );
          sendRoundResult(career, finalResult, seasonFinished);
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
        // Saves de antes do calendário real não têm date/currentDate — sem o snapshot original pra
        // reancorar, usa a rodada já salva + a data real de hoje como âncora (ver backfillFixtureDates).
        // Saves de antes da Série B só têm a competição da Série A (`competitions.length === 1`) e
        // um `world` sem nenhum clube/jogador da Série B — completa as duas coisas gerando uma
        // Série B nova em folha (mesma seed, snapshot real de hoje) e anexando, sem tocar no
        // progresso já salvo da Série A (competição, tabela, calendário, elenco do jogador).
        // Saves de antes da categoria de base não têm `Club.academySquad` (undefined, não `[]` —
        // é o que distingue "nunca gerada" de "gerada e vazia") — completa com um intake pro ano
        // ATUAL da temporada salva (mesma lógica de `world.ts`'s ano inicial, só que aplicada
        // agora em vez de na criação da carreira; não tenta reconstruir os anos que já passaram).
        const incoming = request.payload.state;
        const needsSerieB = incoming.season.competitions.length < 2;
        const serieBAddon = needsSerieB ? generateSeason(incoming.playerClubId) : null;
        const serieBCompetition = serieBAddon?.competitions.find(
          (c) => !incoming.season.competitions.some((existing) => existing.id === c.id),
        );
        const serieBClubIds = new Set(serieBCompetition?.teams ?? []);
        const existingClubIds = new Set(incoming.world.clubs.map((c) => c.id));
        const serieBWorld = needsSerieB ? generateWorld(incoming.seed) : null;
        const newClubs = serieBWorld?.clubs.filter((c) => serieBClubIds.has(c.id) && !existingClubIds.has(c.id)) ?? [];
        const newPlayers = serieBWorld?.players.filter((p) => newClubs.some((c) => c.squad.includes(p.id))) ?? [];

        const baseSeason =
          serieBCompetition && serieBAddon
            ? {
                ...incoming.season,
                competitions: [...incoming.season.competitions, serieBCompetition],
                calendar: [...incoming.season.calendar, ...serieBAddon.calendar.filter((e) => e.competitionId === serieBCompetition.id)],
              }
            : incoming.season;
        const baseWorld = {
          clubs: [...incoming.world.clubs, ...newClubs],
          players: [...incoming.world.players, ...newPlayers],
        };

        const academyByClub = new Map(
          baseWorld.clubs
            .filter((club) => club.academySquad === undefined)
            .map((club) => [club.id, generateAcademyIntake(incoming.seed, club, incoming.season.year)]),
        );

        const normalized: CareerState = {
          ...incoming,
          settings: incoming.settings ?? { tacticalIntensity: 'subtle' },
          season: baseSeason.currentDate ? baseSeason : backfillFixtureDates(baseSeason, new Date().toISOString().slice(0, 10)),
          world: {
            ...baseWorld,
            clubs: baseWorld.clubs.map((club) => ({
              ...club,
              morale: club.morale ?? 70,
              academySquad: club.academySquad ?? (academyByClub.get(club.id) ?? []).map((p) => p.id),
            })),
            players: [
              ...baseWorld.players.map((player) => ({
                ...player,
                attributes:
                  typeof player.attributes.aggression === 'number' ? player.attributes : { ...player.attributes, aggression: 50 },
                seasonStats: {
                  ...player.seasonStats,
                  saves: player.seasonStats.saves ?? 0,
                  minutesPlayed: player.seasonStats.minutesPlayed ?? 0,
                },
                pendingYellowCards: player.pendingYellowCards ?? 0,
                suspendedMatches: player.suspendedMatches ?? 0,
              })),
              ...[...academyByClub.values()].flat(),
            ],
          },
          history: incoming.history.map((entry) => ({
            ...entry,
            libertadores: entry.libertadores ?? [],
            relegated: entry.relegated ?? [],
            promoted: entry.promoted ?? [],
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

      case 'promotePlayer': {
        if (!career) throw new Error('Nenhuma carreira iniciada');
        career = promotePlayer(career, request.payload.clubId, request.payload.playerId);
        respond({ type: 'playerPromoted', requestId: request.requestId, payload: { state: career } });
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
