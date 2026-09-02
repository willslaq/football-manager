// Fim de temporada: resumo (campeão, Libertadores/acesso, rebaixados, artilheiro, luva de ouro) e
// transição pra temporada seguinte. Funções puras — devolvem novo estado, não mutam o recebido.

import { generateNextSeason } from '../generation/season';
import { moraleFromFinalStanding } from '../generation/attributes';
import type { CareerHistoryEntry, CareerState } from '../types/career';
import type { ClubId } from '../types/club';
import type { CompetitionId } from '../types/competition';
import type { PlayerId } from '../types/player';
import { LIBERTADORES_CUTOFF_POSITION, PROMOTION_CUTOFF_POSITION, RELEGATION_CUTOFF_POSITION } from './config';
import { developAcademyPlayer, developPlayer } from './development';
import { advanceAcademies } from './academy';
import { computePrizeMoney, prizePoolForDivision } from './finance';
import { sortStandings } from './standings';

export interface SeasonSummary {
  competitionId: CompetitionId;
  champion: ClubId;
  /** Posições 1 a `LIBERTADORES_CUTOFF_POSITION` (fase de grupos + Pré-Libertadores) — vazio pra Série B. */
  libertadores: ClubId[];
  /**
   * Posições a partir de `RELEGATION_CUTOFF_POSITION`. Pra Série A é REAL (ver `startNewSeason` —
   * esses clubes de fato disputam a Série B no ano seguinte). Pra Série B é só informativo (não há
   * dados de Série C pra substituí-los).
   */
  relegated: ClubId[];
  /** Posições 1 a `PROMOTION_CUTOFF_POSITION` — só populado pra Série B (regra real: sobem pra Série A). Vazio pra Série A. */
  promoted: ClubId[];
  topScorer: { playerId: PlayerId; goals: number } | null;
  goldenGlove: { playerId: PlayerId; saves: number } | null;
}

/**
 * Escolhe o "melhor" entre dois jogadores empatados numa métrica de temporada: menos
 * partidas jogadas pra chegar no número vence (mais eficiente), e por fim o id (determinístico).
 */
function betterTiebreak(a: { playerId: PlayerId; appearances: number }, b: { playerId: PlayerId; appearances: number }): boolean {
  if (a.appearances !== b.appearances) return a.appearances < b.appearances;
  return a.playerId < b.playerId;
}

function findLeader(
  players: CareerState['world']['players'],
  metric: (stats: CareerState['world']['players'][number]['seasonStats']) => number,
): { playerId: PlayerId; value: number } | null {
  let best: { playerId: PlayerId; value: number; appearances: number } | null = null;
  for (const player of players) {
    const value = metric(player.seasonStats);
    if (value <= 0) continue;
    const candidate = { playerId: player.id, value, appearances: player.seasonStats.appearances };
    if (!best || candidate.value > best.value || (candidate.value === best.value && betterTiebreak(candidate, best))) {
      best = candidate;
    }
  }
  return best ? { playerId: best.playerId, value: best.value } : null;
}

/** Jogadores cujo clube atual pertence a `clubIds` — usado pra apurar artilheiro/luva de ouro POR DIVISÃO, não misturando Série A e B. */
function playersInClubs(state: CareerState, clubIds: Set<ClubId>): CareerState['world']['players'] {
  const clubIdByPlayer = new Map<PlayerId, ClubId>();
  for (const club of state.world.clubs) {
    if (!clubIds.has(club.id)) continue;
    for (const playerId of club.squad) clubIdByPlayer.set(playerId, club.id);
  }
  return state.world.players.filter((player) => clubIdByPlayer.has(player.id));
}

/**
 * Resumo de fim de temporada de UMA competição — `competitionIndex` 0 = Série A, 1 = Série B
 * (ordem fixa, ver `generation/season.ts`'s `DIVISIONS`). Pura — usada tanto pra exibir o resumo
 * (Home.tsx, sempre a divisão do próprio clube do jogador) quanto (via `startNewSeason`) pra
 * persistir as DUAS em `history`.
 */
export function buildSeasonSummary(state: CareerState, competitionIndex = 0): SeasonSummary {
  const competition = state.season.competitions[competitionIndex];
  const table = sortStandings(competition.standings);
  const isSeriesA = competitionIndex === 0;

  const divisionPlayers = playersInClubs(state, new Set(competition.teams));
  const topScorer = findLeader(divisionPlayers, (s) => s.goals);
  const goldenGlove = findLeader(divisionPlayers, (s) => s.saves);

  return {
    competitionId: competition.id,
    champion: table[0]?.clubId ?? state.playerClubId,
    libertadores: isSeriesA ? table.slice(0, LIBERTADORES_CUTOFF_POSITION).map((e) => e.clubId) : [],
    relegated: table.slice(RELEGATION_CUTOFF_POSITION - 1).map((e) => e.clubId),
    promoted: isSeriesA ? [] : table.slice(0, PROMOTION_CUTOFF_POSITION).map((e) => e.clubId),
    topScorer: topScorer ? { playerId: topScorer.playerId, goals: topScorer.value } : null,
    goldenGlove: goldenGlove ? { playerId: goldenGlove.playerId, saves: goldenGlove.value } : null,
  };
}

/**
 * Encerra a temporada atual e começa a seguinte: registra o resumo de CADA divisão em `history`,
 * reposiciona a moral de cada clube pela colocação final na SUA divisão (`moraleFromFinalStanding`
 * — ver `Club.morale`), evolui a força de cada jogador com base na temporada que acabou
 * (`developPlayer` — idade e minutagem AINDA da temporada que terminou, antes de
 * envelhecer/zerar estatísticas abaixo), envelhece cada jogador em 1 ano (recalculado de
 * `nextYear - birthYear`, não um +1 cego — ver `Player.birthYear`), zera estatísticas/suspensões/
 * condição dos jogadores e gera a próxima temporada (`generateNextSeason`).
 *
 * Acesso/rebaixamento agora é REAL (regra oficial CBF, sem playoff): os 4 últimos da Série A
 * (`summaryA.relegated`) trocam de lugar com os 4 primeiros da Série B (`summaryB.promoted`) —
 * os clubes literalmente migram de `competition.teams` pra temporada seguinte. O rebaixamento da
 * Série B pra uma hipotética Série C continua só informativo (`summaryB.relegated`): não há dados
 * de clubes da Série C neste projeto.
 *
 * Também gira a categoria de base de cada clube (`advanceAcademies`): libera por idade quem não
 * foi promovido, faz cada promessa restante crescer em treino (`developAcademyPlayer` — sem
 * minutagem, diferente de `developPlayer`) e gera o intake do próximo ano — ver `academy.ts`.
 *
 * Distribui a premiação de fim de temporada de cada divisão (`computePrizeMoney`, taperada pela
 * posição final NA divisão da temporada que acabou, antes do acesso/rebaixamento acima) — soma
 * ao `Club.budget` de todo mundo, e registra em `financeLog` só se for o clube do jogador.
 */
export function startNewSeason(state: CareerState): CareerState {
  if (state.season.state !== 'finished') {
    throw new Error('startNewSeason: a temporada atual ainda não terminou');
  }
  if (state.season.competitions.length < 2) {
    throw new Error('startNewSeason: esperava Série A e Série B (season.competitions.length < 2)');
  }

  const [competitionA, competitionB] = state.season.competitions;
  const tableA = sortStandings(competitionA.standings);
  const tableB = sortStandings(competitionB.standings);

  const positionByClub = new Map<ClubId, number>();
  const totalTeamsByClub = new Map<ClubId, number>();
  const matchesPlayedByClub = new Map<ClubId, number>();
  for (const table of [tableA, tableB]) {
    table.forEach((entry, index) => {
      positionByClub.set(entry.clubId, index + 1);
      totalTeamsByClub.set(entry.clubId, table.length);
      matchesPlayedByClub.set(entry.clubId, entry.played);
    });
  }

  const clubIdByPlayer = new Map<PlayerId, ClubId>();
  for (const club of state.world.clubs) {
    for (const playerId of club.squad) clubIdByPlayer.set(playerId, club.id);
  }

  const summaryA = buildSeasonSummary(state, 0);
  const summaryB = buildSeasonSummary(state, 1);
  const historyEntryA: CareerHistoryEntry = { year: state.season.year, ...summaryA };
  const historyEntryB: CareerHistoryEntry = { year: state.season.year, ...summaryB };

  // Premiação de fim de temporada: taperada por posição final NA PRÓPRIA divisão (ver
  // `computePrizeMoney`), somada ao caixa antes de qualquer coisa mudar de divisão pra
  // temporada seguinte — a posição que rendeu o prêmio é a da temporada que ACABOU.
  const seriesATeamIds = new Set(competitionA.teams);
  const prizeByClub = new Map<ClubId, number>();
  for (const [clubId, position] of positionByClub) {
    const totalTeams = totalTeamsByClub.get(clubId) ?? 20;
    prizeByClub.set(clubId, computePrizeMoney(position, totalTeams, prizePoolForDivision(seriesATeamIds.has(clubId))));
  }

  const relegatedFromA = new Set(summaryA.relegated);
  const promotedFromB = new Set(summaryB.promoted);
  const nextSeriesATeams = [...competitionA.teams.filter((id) => !relegatedFromA.has(id)), ...promotedFromB];
  const nextSeriesBTeams = [...competitionB.teams.filter((id) => !promotedFromB.has(id)), ...relegatedFromA];

  const nextYear = state.season.year + 1;

  // Categoria de base: poda quem foi liberado por idade, gera o intake do próximo ano por clube
  // (ver academy.ts) — roda antes do resto porque só depende de `birthYear` (estável), não da
  // idade recém-incrementada abaixo.
  const academy = advanceAcademies(state, nextYear);
  const academyClubById = new Map(academy.clubs.map((club) => [club.id, club]));
  const academyPlayerIds = new Set(state.world.clubs.flatMap((club) => club.academySquad ?? []));

  const clubs = state.world.clubs.map((club) => {
    const totalTeams = totalTeamsByClub.get(club.id) ?? 20;
    const base = academyClubById.get(club.id) ?? club;
    return {
      ...base,
      morale: moraleFromFinalStanding(positionByClub.get(club.id) ?? totalTeams, totalTeams),
      budget: base.budget + (prizeByClub.get(club.id) ?? 0),
    };
  });

  const playerPrize = prizeByClub.get(state.playerClubId) ?? 0;
  const financeLog =
    playerPrize > 0
      ? [
          ...state.financeLog,
          {
            date: state.season.currentDate,
            type: 'prize' as const,
            description: `Premiação ${seriesATeamIds.has(state.playerClubId) ? 'Série A' : 'Série B'} — ${positionByClub.get(state.playerClubId) ?? '?'}º lugar`,
            amountEur: playerPrize,
            balanceAfterEur: clubs.find((c) => c.id === state.playerClubId)?.budget ?? 0,
          },
        ]
      : state.financeLog;

  const players = [
    ...state.world.players
      .filter((player) => !academy.releasedPlayerIds.has(player.id))
      .map((player) => {
        const developed = academyPlayerIds.has(player.id)
          ? developAcademyPlayer(player)
          : developPlayer(player, matchesPlayedByClub.get(clubIdByPlayer.get(player.id) ?? '') ?? 0);
        return {
          ...player,
          strength: developed.strength,
          age: nextYear - player.birthYear,
          condition: 100,
          seasonStats: { appearances: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0, saves: 0, minutesPlayed: 0 },
          pendingYellowCards: 0,
          suspendedMatches: 0,
        };
      }),
    ...academy.newPlayers,
  ];

  return {
    ...state,
    world: { clubs, players },
    season: generateNextSeason(state.season.year, {
      [competitionA.id]: nextSeriesATeams,
      [competitionB.id]: nextSeriesBTeams,
    }),
    history: [...state.history, historyEntryA, historyEntryB],
    financeLog,
  };
}
