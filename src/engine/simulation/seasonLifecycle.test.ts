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

  it('registra o resumo em history, reseta jogadores e clubes, e gera a temporada seguinte do zero', () => {
    const finished = playToFinished(11, 'palmeiras');
    const table = sortStandings(finished.season.competitions[0].standings);
    const summary = buildSeasonSummary(finished);

    const next = startNewSeason(finished);

    // history
    expect(next.history).toHaveLength(1);
    expect(next.history[0]).toEqual({
      year: finished.season.year,
      competitionId: finished.season.competitions[0].id,
      ...summary,
    });
    expect(next.history[0].champion).toBe(table[0].clubId);
    expect(next.history[0].libertadores).toHaveLength(5);
    expect(next.history[0].relegated).toHaveLength(4);
    expect(next.history[0].topScorer?.goals).toBeGreaterThan(0);
    expect(next.history[0].goldenGlove?.saves).toBeGreaterThan(0);

    // moral por posição final
    const championClub = next.world.clubs.find((c) => c.id === table[0].clubId)!;
    const lastPlacedClub = next.world.clubs.find((c) => c.id === table[table.length - 1].clubId)!;
    expect(championClub.morale).toBe(100);
    expect(lastPlacedClub.morale).toBe(20);

    // jogadores resetados
    for (const player of next.world.players) {
      expect(player.seasonStats).toEqual({ appearances: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0, saves: 0 });
      expect(player.pendingYellowCards).toBe(0);
      expect(player.suspendedMatches).toBe(0);
      expect(player.condition).toBe(100);
    }

    // temporada nova, do zero, mesmos 20 clubes
    expect(next.season.year).toBe(finished.season.year + 1);
    expect(next.season.currentRound).toBe(1);
    expect(next.season.state).toBe('in_progress');
    const nextCompetition = next.season.competitions[0];
    expect(nextCompetition.teams).toEqual(finished.season.competitions[0].teams);
    expect(nextCompetition.fixtures.every((round) => round.every((f) => f.result === undefined))).toBe(true);
    expect(nextCompetition.standings.every((e) => e.played === 0 && e.points === 0)).toBe(true);
  });
});
