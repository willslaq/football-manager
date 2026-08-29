// Fim de temporada: resumo (campeão, Libertadores, rebaixados, artilheiro, luva de ouro) e
// transição pra temporada seguinte. Funções puras — devolvem novo estado, não mutam o recebido.

import { generateNextSeason } from '../generation/season';
import { moraleFromFinalStanding } from '../generation/attributes';
import type { CareerHistoryEntry, CareerState } from '../types/career';
import type { ClubId } from '../types/club';
import type { PlayerId } from '../types/player';
import { LIBERTADORES_CUTOFF_POSITION, RELEGATION_CUTOFF_POSITION } from './config';
import { sortStandings } from './standings';

export interface SeasonSummary {
  champion: ClubId;
  /** Posições 1 a `LIBERTADORES_CUTOFF_POSITION` (fase de grupos + Pré-Libertadores). */
  libertadores: ClubId[];
  /** Posições a partir de `RELEGATION_CUTOFF_POSITION`. */
  relegated: ClubId[];
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

/** Pura — usada tanto pra exibir o resumo de fim de temporada quanto (via `startNewSeason`) pra persistir em `history`. */
export function buildSeasonSummary(state: CareerState): SeasonSummary {
  const table = sortStandings(state.season.competitions[0].standings);

  const topScorer = findLeader(state.world.players, (s) => s.goals);
  const goldenGlove = findLeader(state.world.players, (s) => s.saves);

  return {
    champion: table[0]?.clubId ?? state.playerClubId,
    libertadores: table.slice(0, LIBERTADORES_CUTOFF_POSITION).map((e) => e.clubId),
    relegated: table.slice(RELEGATION_CUTOFF_POSITION - 1).map((e) => e.clubId),
    topScorer: topScorer ? { playerId: topScorer.playerId, goals: topScorer.value } : null,
    goldenGlove: goldenGlove ? { playerId: goldenGlove.playerId, saves: goldenGlove.value } : null,
  };
}

/**
 * Encerra a temporada atual e começa a seguinte: registra o resumo em `history`, reposiciona a
 * moral de cada clube pela colocação final (`moraleFromFinalStanding` — ver `Club.morale`), zera
 * estatísticas/suspensões/condição dos jogadores e gera a próxima temporada (`generateNextSeason`
 * — mesmos 20 clubes, calendário reaproveitado, tabela zerada, rodada 1). Rebaixamento é só
 * informativo no resumo: sem dados da Série B pra promover substitutos, os mesmos clubes voltam
 * (confirmado com o usuário).
 */
export function startNewSeason(state: CareerState): CareerState {
  if (state.season.state !== 'finished') {
    throw new Error('startNewSeason: a temporada atual ainda não terminou');
  }

  const competition = state.season.competitions[0];
  const table = sortStandings(competition.standings);
  const positionByClub = new Map(table.map((entry, index) => [entry.clubId, index + 1]));
  const totalTeams = table.length;

  const summary = buildSeasonSummary(state);
  const historyEntry: CareerHistoryEntry = {
    year: state.season.year,
    competitionId: competition.id,
    ...summary,
  };

  const clubs = state.world.clubs.map((club) => ({
    ...club,
    morale: moraleFromFinalStanding(positionByClub.get(club.id) ?? totalTeams, totalTeams),
  }));

  const players = state.world.players.map((player) => ({
    ...player,
    condition: 100,
    seasonStats: { appearances: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0, saves: 0 },
    pendingYellowCards: 0,
    suspendedMatches: 0,
  }));

  return {
    ...state,
    world: { clubs, players },
    season: generateNextSeason(state.season.year, competition.teams),
    history: [...state.history, historyEntry],
  };
}
