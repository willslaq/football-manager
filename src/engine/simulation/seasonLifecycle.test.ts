import { describe, expect, it } from 'vitest';
import { createBrasileiraoCareer } from '../generation/career';
import { moraleFromFinalStanding } from '../generation/attributes';
import type { Lineup, Tactics } from '../types/tactics';
import { advanceRound } from './season';
import { buildSeasonSummary, startNewSeason } from './seasonLifecycle';
import { sortStandings } from './standings';
import { pickAutoLineup } from './autoLineup';

const DEFAULT_TACTICS: Tactics = { formation: '4-4-2', style: 'balanced' };

function autoLineupFor(state: ReturnType<typeof createBrasileiraoCareer>, clubId: string): Lineup {
  const playersById = new Map(state.world.players.map((p) => [p.id, p]));
  const club = state.world.clubs.find((c) => c.id === clubId)!;
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

function playToFinished(seed: number, clubId: string): ReturnType<typeof createBrasileiraoCareer> {
  let state = createBrasileiraoCareer(seed, { id: 't1', name: 'X' }, clubId);
  while (state.season.state !== 'finished') {
    const lineup = autoLineupFor(state, clubId);
    state = advanceRound(state, { playerLineup: lineup, playerTactics: DEFAULT_TACTICS });
  }
  return state;
}

describe('moraleFromFinalStanding', () => {
  it('vai de 100 (1º) a 20 (último), linear', () => {
    expect(moraleFromFinalStanding(1, 20)).toBe(100);
    expect(moraleFromFinalStanding(20, 20)).toBe(20);
    expect(moraleFromFinalStanding(10.5, 20)).toBeCloseTo(60, 0);
  });
});

describe('advanceRound — moral do clube (só exibição)', () => {
  it('sobe a moral de quem venceu e desce a de quem perdeu, sem alterar a simulação', () => {
    const state = createBrasileiraoCareer(11, { id: 't1', name: 'X' }, 'palmeiras');
    const lineup = autoLineupFor(state, 'palmeiras');
    const next = advanceRound(state, { playerLineup: lineup, playerTactics: DEFAULT_TACTICS });

    // A rodada pode se espalhar por sábado e domingo (ver assignFixtureDates) — só os fixtures já
    // alcançados por essa chamada (mesmo dia do jogo do jogador ou antes) têm resultado.
    const round = next.season.competitions[0].fixtures[state.season.currentRound - 1].filter((f) => f.result);
    expect(round.length).toBeGreaterThan(0);
    for (const fixture of round) {
      const result = fixture.result!;
      const homeBefore = state.world.clubs.find((c) => c.id === fixture.homeTeamId)!.morale;
      const awayBefore = state.world.clubs.find((c) => c.id === fixture.awayTeamId)!.morale;
      const homeAfter = next.world.clubs.find((c) => c.id === fixture.homeTeamId)!.morale;
      const awayAfter = next.world.clubs.find((c) => c.id === fixture.awayTeamId)!.morale;

      expect(homeAfter).toBeGreaterThanOrEqual(0);
      expect(homeAfter).toBeLessThanOrEqual(100);
      if (result.homeGoals > result.awayGoals) {
        expect(homeAfter).toBeGreaterThanOrEqual(homeBefore);
        expect(awayAfter).toBeLessThanOrEqual(awayBefore);
      } else if (result.homeGoals < result.awayGoals) {
        expect(homeAfter).toBeLessThanOrEqual(homeBefore);
        expect(awayAfter).toBeGreaterThanOrEqual(awayBefore);
      }
    }
  });
});

describe('startNewSeason', () => {
  it('rejeita encerrar uma temporada que ainda não terminou', () => {
    const state = createBrasileiraoCareer(11, { id: 't1', name: 'X' }, 'palmeiras');
    expect(() => startNewSeason(state)).toThrow();
  });

  it('registra o resumo das DUAS divisões em history, reseta jogadores e clubes, e gera a temporada seguinte do zero', () => {
    const finished = playToFinished(11, 'palmeiras');
    const tableA = sortStandings(finished.season.competitions[0].standings);
    const tableB = sortStandings(finished.season.competitions[1].standings);
    const summaryA = buildSeasonSummary(finished, 0);
    const summaryB = buildSeasonSummary(finished, 1);

    const next = startNewSeason(finished);

    // history: uma entrada por divisão
    expect(next.history).toHaveLength(2);
    expect(next.history[0]).toEqual({ year: finished.season.year, ...summaryA });
    expect(next.history[1]).toEqual({ year: finished.season.year, ...summaryB });

    expect(next.history[0].champion).toBe(tableA[0].clubId);
    expect(next.history[0].libertadores).toHaveLength(5);
    expect(next.history[0].relegated).toHaveLength(4);
    expect(next.history[0].promoted).toHaveLength(0);
    expect(next.history[0].topScorer?.goals).toBeGreaterThan(0);
    expect(next.history[0].goldenGlove?.saves).toBeGreaterThan(0);

    expect(next.history[1].champion).toBe(tableB[0].clubId);
    expect(next.history[1].libertadores).toHaveLength(0);
    expect(next.history[1].promoted).toHaveLength(4);

    // moral por posição final (dentro da PRÓPRIA divisão)
    const championClubA = next.world.clubs.find((c) => c.id === tableA[0].clubId)!;
    const lastPlacedClubA = next.world.clubs.find((c) => c.id === tableA[tableA.length - 1].clubId)!;
    expect(championClubA.morale).toBe(100);
    expect(lastPlacedClubA.morale).toBe(20);

    // jogadores resetados e envelhecidos (recalculado de `nextYear - birthYear`, não um +1 cego —
    // por isso alguns sobem 2 nessa primeira virada: `age` de origem é preciso por data real de
    // nascimento (scrape), enquanto só temos `birthYear` aqui, então quem ainda não fez aniversário
    // no ano do scrape começa 1 "atrasado" em relação a `year - birthYear`; a partir da 2ª virada em
    // diante o incremento é sempre exatamente +1).
    for (const player of next.world.players) {
      expect(player.seasonStats).toEqual({
        appearances: 0,
        goals: 0,
        assists: 0,
        yellowCards: 0,
        redCards: 0,
        saves: 0,
        minutesPlayed: 0,
      });
      expect(player.pendingYellowCards).toBe(0);
      expect(player.suspendedMatches).toBe(0);
      expect(player.condition).toBe(100);
      expect(player.age).toBe(next.season.year - player.birthYear);
    }

    // temporada nova, do zero, 20 clubes em cada divisão
    expect(next.season.year).toBe(finished.season.year + 1);
    expect(next.season.currentRound).toBe(1);
    expect(next.season.state).toBe('in_progress');
    for (const nextCompetition of next.season.competitions) {
      expect(nextCompetition.teams).toHaveLength(20);
      expect(new Set(nextCompetition.teams).size).toBe(20);
      expect(nextCompetition.fixtures.every((round) => round.every((f) => f.result === undefined))).toBe(true);
      expect(nextCompetition.standings.every((e) => e.played === 0 && e.points === 0)).toBe(true);
    }

    // acesso/rebaixamento real: os 4 rebaixados da Série A viram time da Série B, e os 4
    // promovidos da Série B viram time da Série A — troca direta, sem playoff.
    const nextSeriesATeams = new Set(next.season.competitions[0].teams);
    const nextSeriesBTeams = new Set(next.season.competitions[1].teams);
    for (const clubId of summaryA.relegated) {
      expect(nextSeriesATeams.has(clubId)).toBe(false);
      expect(nextSeriesBTeams.has(clubId)).toBe(true);
    }
    for (const clubId of summaryB.promoted) {
      expect(nextSeriesBTeams.has(clubId)).toBe(false);
      expect(nextSeriesATeams.has(clubId)).toBe(true);
    }
  });
});
