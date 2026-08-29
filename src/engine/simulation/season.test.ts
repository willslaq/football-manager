import { describe, expect, it } from 'vitest';
import { createBrasileiraoCareer } from '../generation/career';
import type { CareerState } from '../types/career';
import type { Lineup, Tactics } from '../types/tactics';
import { advanceRound, commitPlayerMatchResult, simulateRound } from './season';
import { pickAutoLineup } from './autoLineup';
import { simulateMatch, type MatchSubstitution } from './match';

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

describe('advanceRound', () => {
  it('simula a rodada atual, preenche resultados e atualiza a tabela de forma consistente', () => {
    const state = createBrasileiraoCareer(11, { id: 't1', name: 'X' }, 'palmeiras');
    const roundBefore = state.season.currentRound;
    const fixturesBefore = state.season.competitions[0].fixtures[roundBefore - 1];
    expect(fixturesBefore.every((f) => f.result === undefined)).toBe(true);

    const lineup = autoLineupFor(state, 'palmeiras');
    const next = advanceRound(state, { playerLineup: lineup, playerTactics: DEFAULT_TACTICS });

    expect(next.season.currentRound).toBe(roundBefore + 1);
    expect(next.season.state).toBe('in_progress');

    const playedRound = next.season.competitions[0].fixtures[roundBefore - 1];
    expect(playedRound.every((f) => f.result !== undefined)).toBe(true);

    // Consistência interna da tabela após a rodada.
    for (const entry of next.season.competitions[0].standings) {
      expect(entry.won + entry.drawn + entry.lost).toBe(entry.played);
    }
    const totalWon = next.season.competitions[0].standings.reduce((s, e) => s + e.won, 0);
    const totalLost = next.season.competitions[0].standings.reduce((s, e) => s + e.lost, 0);
    expect(totalWon).toBe(totalLost);

    const totalPlayedBefore = state.season.competitions[0].standings.reduce((s, e) => s + e.played, 0);
    const totalPlayedAfter = next.season.competitions[0].standings.reduce((s, e) => s + e.played, 0);
    expect(totalPlayedAfter - totalPlayedBefore).toBe(playedRound.length * 2);
  });

  it('atualiza estatísticas de temporada dos jogadores que jogaram (aparições, gols e defesas)', () => {
    const state = createBrasileiraoCareer(11, { id: 't1', name: 'X' }, 'palmeiras');
    const lineup = autoLineupFor(state, 'palmeiras');
    const next = advanceRound(state, { playerLineup: lineup, playerTactics: DEFAULT_TACTICS });

    const startersWithAppearance = lineup.starters.filter((id) => {
      const player = next.world.players.find((p) => p.id === id)!;
      return player.seasonStats.appearances === 1;
    });
    expect(startersWithAppearance.length).toBe(11);

    const totalGoalsInRound = next.season.competitions[0].fixtures[state.season.currentRound - 1].reduce(
      (sum, f) => sum + (f.result?.homeGoals ?? 0) + (f.result?.awayGoals ?? 0),
      0,
    );
    const totalPlayerGoals = next.world.players.reduce((sum, p) => sum + p.seasonStats.goals, 0);
    expect(totalPlayerGoals).toBe(totalGoalsInRound);

    const totalShotsSavedInRound = next.season.competitions[0].fixtures[state.season.currentRound - 1].reduce(
      (sum, f) => sum + (f.result?.events.filter((e) => e.type === 'shot_saved').length ?? 0),
      0,
    );
    const totalPlayerSaves = next.world.players.reduce((sum, p) => sum + p.seasonStats.saves, 0);
    expect(totalPlayerSaves).toBe(totalShotsSavedInRound);
    expect(totalPlayerSaves).toBeGreaterThan(0);
  });

  it('rejeita avançar depois que a temporada terminou', () => {
    const state = createBrasileiraoCareer(11, { id: 't1', name: 'X' }, 'palmeiras');
    const finished = { ...state, season: { ...state.season, state: 'finished' as const } };
    const lineup = autoLineupFor(state, 'palmeiras');
    expect(() => advanceRound(finished, { playerLineup: lineup, playerTactics: DEFAULT_TACTICS })).toThrow();
  });

  it('roda uma rodada em poucos milissegundos (RNF-001)', () => {
    const state = createBrasileiraoCareer(11, { id: 't1', name: 'X' }, 'palmeiras');
    const lineup = autoLineupFor(state, 'palmeiras');

    const start = performance.now();
    advanceRound(state, { playerLineup: lineup, playerTactics: DEFAULT_TACTICS });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
  });

  it('simula a temporada inteira de ponta a ponta até o fim, sem intervenção', () => {
    let state = createBrasileiraoCareer(11, { id: 't1', name: 'X' }, 'palmeiras');
    const totalRounds = state.season.competitions[0].fixtures.length;
    const firstRoundToSimulate = state.season.currentRound;
    const roundsToPlay = totalRounds - state.season.currentRound + 1;

    const start = performance.now();
    let iterations = 0;
    while (state.season.state !== 'finished') {
      const lineup = autoLineupFor(state, 'palmeiras');
      state = advanceRound(state, { playerLineup: lineup, playerTactics: DEFAULT_TACTICS });
      iterations++;
      expect(iterations).toBeLessThanOrEqual(totalRounds + 1); // trava de segurança contra loop infinito
    }
    const elapsed = performance.now() - start;

    expect(state.season.state).toBe('finished');
    expect(iterations).toBe(roundsToPlay);
    console.log(`Temporada completa (${roundsToPlay} rodadas) simulada em ${elapsed.toFixed(1)}ms`);

    const competition = state.season.competitions[0];
    competition.fixtures.forEach((round, index) => {
      const roundNumber = index + 1;
      const shouldHaveResult = roundNumber >= firstRoundToSimulate;
      expect(round.every((f) => (f.result !== undefined) === shouldHaveResult)).toBe(true);
    });
    for (const entry of competition.standings) {
      expect(entry.won + entry.drawn + entry.lost).toBe(entry.played);
      expect(entry.points).toBe(entry.won * 3 + entry.drawn);
    }

    const champion = [...competition.standings].sort((a, b) => b.points - a.points)[0];
    console.log('Campeão simulado:', champion.clubId, 'com', champion.points, 'pontos');
    expect(champion.points).toBeGreaterThan(0);
  });

  it('decrementa suspensão de quem não jogou uma única vez, mesmo com o commit em duas etapas (simulateRound + commitPlayerMatchResult)', () => {
    const state = createBrasileiraoCareer(11, { id: 't1', name: 'X' }, 'palmeiras');
    const lineup = autoLineupFor(state, 'palmeiras');
    const palmeirasSquad = new Set(state.world.clubs.find((c) => c.id === 'palmeiras')!.squad);
    const outsidePlayer = state.world.players.find((p) => !palmeirasSquad.has(p.id))!;

    const stateWithSuspension: CareerState = {
      ...state,
      world: {
        ...state.world,
        players: state.world.players.map((p) => (p.id === outsidePlayer.id ? { ...p, suspendedMatches: 2 } : p)),
      },
    };

    const next = advanceRound(stateWithSuspension, { playerLineup: lineup, playerTactics: DEFAULT_TACTICS });
    const after = next.world.players.find((p) => p.id === outsidePlayer.id)!;
    expect(after.suspendedMatches).toBe(1);
  });
});

describe('simulateRound + commitPlayerMatchResult (partida do jogador entregue ao vivo, com possível substituição)', () => {
  it('simulateRound comita as partidas de CPU na hora, mas deixa a do jogador sem resultado até commitPlayerMatchResult', () => {
    const state = createBrasileiraoCareer(11, { id: 't1', name: 'X' }, 'palmeiras');
    const lineup = autoLineupFor(state, 'palmeiras');
    const { nextState, playerFixture, playerMatchResult, roundIndex } = simulateRound(state, {
      playerLineup: lineup,
      playerTactics: DEFAULT_TACTICS,
    });

    expect(playerFixture).toBeDefined();
    expect(playerMatchResult).toBeDefined();

    const round = nextState.season.competitions[0].fixtures[roundIndex];
    const playerFixtureInRound = round.find(
      (f) => f.homeTeamId === playerFixture!.homeTeamId && f.awayTeamId === playerFixture!.awayTeamId,
    )!;
    expect(playerFixtureInRound.result).toBeUndefined();
    expect(round.filter((f) => f !== playerFixtureInRound).every((f) => f.result !== undefined)).toBe(true);
  });

  it('commitPlayerMatchResult grava o resultado final e credita estatísticas a quem entrou como substituto', () => {
    const state = createBrasileiraoCareer(11, { id: 't1', name: 'X' }, 'palmeiras');
    const lineup = autoLineupFor(state, 'palmeiras');
    const { nextState, playerFixture, playerMatchResult, homeTeamInput, awayTeamInput, roundIndex, seed } = simulateRound(
      state,
      { playerLineup: lineup, playerTactics: DEFAULT_TACTICS },
    );
    if (!playerFixture || !playerMatchResult || !homeTeamInput || !awayTeamInput || seed === undefined) {
      throw new Error('rodada de teste sem partida do jogador');
    }

    const isHome = playerFixture.homeTeamId === 'palmeiras';
    const playerTeamInput = isHome ? homeTeamInput : awayTeamInput;
    const outPlayer = playerTeamInput.players.find((p) => p.position !== 'GOL')!;
    const club = nextState.world.clubs.find((c) => c.id === 'palmeiras')!;
    const benchPlayerId = club.squad.find((id) => !lineup.starters.includes(id))!;
    const benchPlayer = nextState.world.players.find((p) => p.id === benchPlayerId)!;

    const sub: MatchSubstitution = {
      minute: 60,
      teamSide: isHome ? 'home' : 'away',
      playerOutId: outPlayer.id,
      playerIn: benchPlayer,
    };
    const finalResult = simulateMatch(homeTeamInput, awayTeamInput, seed, state.settings.tacticalIntensity, undefined, [sub]);

    const committed = commitPlayerMatchResult(nextState, { playerFixture, roundIndex, homeTeamInput, awayTeamInput }, finalResult);

    const committedFixture = committed.season.competitions[0].fixtures[roundIndex].find(
      (f) => f.homeTeamId === playerFixture.homeTeamId && f.awayTeamId === playerFixture.awayTeamId,
    )!;
    expect(committedFixture.result).toEqual(finalResult);

    const benchPlayerAfter = committed.world.players.find((p) => p.id === benchPlayer.id)!;
    expect(benchPlayerAfter.seasonStats.appearances).toBe(1);

    const outPlayerAfter = committed.world.players.find((p) => p.id === outPlayer.id)!;
    expect(outPlayerAfter.seasonStats.appearances).toBe(1);
  });
});
