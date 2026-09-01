import { describe, expect, it } from 'vitest';
import { createBrasileiraoCareer } from '../generation/career';
import type { CareerState } from '../types/career';
import type { Lineup, Tactics } from '../types/tactics';
import { advanceCalendar, advanceRound, commitPlayerMatchResult, startMatchDay } from './season';
import { pickAutoLineup } from './autoLineup';
import { simulateMatch, type MatchSubstitution } from './match';

const DEFAULT_TACTICS: Tactics = { formation: '4-4-2', style: 'balanced' };

/** Composição `advanceCalendar` + `startMatchDay` usada nos testes que precisam do jogo do jogador ainda não comitado. */
function advanceToMatchDay(state: CareerState, input: { playerLineup: Lineup; playerTactics: Tactics }) {
  const calendar = advanceCalendar(state, input);
  if (!calendar.reachedPlayerMatchDay) {
    throw new Error('advanceToMatchDay: nenhum jogo do time do jogador alcançável a partir daqui');
  }
  return startMatchDay(calendar.nextState, input);
}

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

    expect(next.season.state).toBe('in_progress');
    // A rodada agora pode se espalhar por sábado e domingo (ver assignFixtureDates) — currentRound
    // só avança quando TODOS os fixtures da rodada já têm resultado. Se o jogo do time do jogador
    // caiu no primeiro dia, o resto (segundo dia) só é resolvido na PRÓXIMA chamada — então aqui
    // só garantimos que currentRound não regride, não que já avançou.
    expect(next.season.currentRound).toBeGreaterThanOrEqual(roundBefore);

    // O jogo do próprio time do jogador na rodada anterior sempre é resolvido nessa chamada.
    const playerFixtureAfter = next.season.competitions[0].fixtures[roundBefore - 1].find(
      (f) => f.homeTeamId === 'palmeiras' || f.awayTeamId === 'palmeiras',
    )!;
    expect(playerFixtureAfter.result).toBeDefined();

    // Consistência interna da tabela após o avanço.
    for (const entry of next.season.competitions[0].standings) {
      expect(entry.won + entry.drawn + entry.lost).toBe(entry.played);
    }
    const totalWon = next.season.competitions[0].standings.reduce((s, e) => s + e.won, 0);
    const totalLost = next.season.competitions[0].standings.reduce((s, e) => s + e.lost, 0);
    expect(totalWon).toBe(totalLost);

    const totalPlayedBefore = state.season.competitions[0].standings.reduce((s, e) => s + e.played, 0);
    const totalPlayedAfter = next.season.competitions[0].standings.reduce((s, e) => s + e.played, 0);
    expect(totalPlayedAfter).toBeGreaterThan(totalPlayedBefore);
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

    // Titular que não foi substituído nem expulso joga a partida inteira.
    for (const id of lineup.starters) {
      const player = next.world.players.find((p) => p.id === id)!;
      expect(player.seasonStats.minutesPlayed).toBe(90);
    }

    // Só jogadores da Série A (mesma competição usada pra somar os gols/defesas "esperados"
    // abaixo) — `next.world.players` agora inclui a Série B inteira também (duas competições
    // rodando em paralelo), então somar TODOS os jogadores misturaria as duas rodadas.
    const seriesAClubIds = new Set(next.season.competitions[0].teams);
    const seriesAPlayerIds = new Set(
      next.world.clubs.filter((c) => seriesAClubIds.has(c.id)).flatMap((c) => c.squad),
    );
    const seriesAPlayers = next.world.players.filter((p) => seriesAPlayerIds.has(p.id));

    const totalGoalsInRound = next.season.competitions[0].fixtures[state.season.currentRound - 1].reduce(
      (sum, f) => sum + (f.result?.homeGoals ?? 0) + (f.result?.awayGoals ?? 0),
      0,
    );
    const totalPlayerGoals = seriesAPlayers.reduce((sum, p) => sum + p.seasonStats.goals, 0);
    expect(totalPlayerGoals).toBe(totalGoalsInRound);

    const totalShotsSavedInRound = next.season.competitions[0].fixtures[state.season.currentRound - 1].reduce(
      (sum, f) => sum + (f.result?.events.filter((e) => e.type === 'shot_saved').length ?? 0),
      0,
    );
    const totalPlayerSaves = seriesAPlayers.reduce((sum, p) => sum + p.seasonStats.saves, 0);
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
    const outsideClub = state.world.clubs.find((c) => c.squad.includes(outsidePlayer.id))!;

    const stateWithSuspension: CareerState = {
      ...state,
      world: {
        ...state.world,
        players: state.world.players.map((p) => (p.id === outsidePlayer.id ? { ...p, suspendedMatches: 2 } : p)),
      },
    };

    // O jogo do clube de fora pode cair no mesmo dia do jogo do jogador ou no outro dia do fim de
    // semana da rodada (ver advanceToNextEvent) — nesse segundo caso só é alcançado numa chamada
    // seguinte. Avança até esse clube específico ter jogado.
    let next: CareerState = stateWithSuspension;
    for (let i = 0; i < 3; i++) {
      next = advanceRound(next, { playerLineup: lineup, playerTactics: DEFAULT_TACTICS });
      const outsideFixtureResolved = next.season.competitions[0].fixtures
        .flat()
        .some((f) => f.result && (f.homeTeamId === outsideClub.id || f.awayTeamId === outsideClub.id));
      if (outsideFixtureResolved) break;
    }

    const after = next.world.players.find((p) => p.id === outsidePlayer.id)!;
    expect(after.suspendedMatches).toBe(1);
  });
});

describe('advanceCalendar + startMatchDay + commitPlayerMatchResult (partida do jogador entregue ao vivo, com possível substituição)', () => {
  it('advanceCalendar para exatamente no dia do próximo jogo do jogador, sem simular nada dessa data ainda', () => {
    const state = createBrasileiraoCareer(11, { id: 't1', name: 'X' }, 'palmeiras');
    const lineup = autoLineupFor(state, 'palmeiras');
    const calendar = advanceCalendar(state, { playerLineup: lineup, playerTactics: DEFAULT_TACTICS });

    expect(calendar.reachedPlayerMatchDay).toBe(true);
    expect(calendar.seasonFinished).toBe(false);

    // Rodadas anteriores à do snapshot inicial não têm `.result` por design (só saldo agregado
    // nas standings) — sem o filtro por data, o primeiro fixture "do jogador" encontrado seria
    // um desses, lá no passado (ver o mesmo cuidado em Home.tsx).
    const playerFixture = calendar.nextState.season.competitions[0].fixtures
      .flat()
      .find(
        (f) =>
          !f.result &&
          f.date >= calendar.nextState.season.currentDate &&
          (f.homeTeamId === 'palmeiras' || f.awayTeamId === 'palmeiras'),
      )!;
    expect(playerFixture.date).toBe(calendar.nextState.season.currentDate);
    expect(playerFixture.result).toBeUndefined();
  });

  it('startMatchDay comita os jogos da mesma data na hora, mas deixa o do jogador sem resultado até commitPlayerMatchResult', () => {
    const state = createBrasileiraoCareer(11, { id: 't1', name: 'X' }, 'palmeiras');
    const lineup = autoLineupFor(state, 'palmeiras');
    const { nextState, playerFixture, playerMatchResult, competitionId, roundIndex } = advanceToMatchDay(state, {
      playerLineup: lineup,
      playerTactics: DEFAULT_TACTICS,
    });

    expect(playerFixture).toBeDefined();
    expect(playerMatchResult).toBeDefined();
    if (!playerFixture || competitionId === undefined || roundIndex === undefined) {
      throw new Error('rodada de teste sem partida do jogador');
    }

    const round = nextState.season.competitions[0].fixtures[roundIndex];
    const playerFixtureInRound = round.find(
      (f) => f.homeTeamId === playerFixture.homeTeamId && f.awayTeamId === playerFixture.awayTeamId,
    )!;
    expect(playerFixtureInRound.result).toBeUndefined();
    // Todo fixture da rodada com data até a do jogador (mesmo dia) já foi resolvido — o que
    // sobrar pro outro dia do fim de semana da rodada ainda não foi alcançado (ver startMatchDay).
    const alreadyReached = round.filter((f) => f !== playerFixtureInRound && f.date <= playerFixture.date);
    expect(alreadyReached.length).toBeGreaterThan(0);
    expect(alreadyReached.every((f) => f.result !== undefined)).toBe(true);
  });

  it('commitPlayerMatchResult grava o resultado final e credita estatísticas a quem entrou como substituto', () => {
    const state = createBrasileiraoCareer(11, { id: 't1', name: 'X' }, 'palmeiras');
    const lineup = autoLineupFor(state, 'palmeiras');
    const { nextState, playerFixture, playerMatchResult, homeTeamInput, awayTeamInput, competitionId, roundIndex, seed } =
      advanceToMatchDay(state, { playerLineup: lineup, playerTactics: DEFAULT_TACTICS });
    if (
      !playerFixture ||
      !playerMatchResult ||
      !homeTeamInput ||
      !awayTeamInput ||
      competitionId === undefined ||
      roundIndex === undefined ||
      seed === undefined
    ) {
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

    const committed = commitPlayerMatchResult(
      nextState,
      { playerFixture, competitionId, roundIndex, homeTeamInput, awayTeamInput },
      finalResult,
    );

    const committedFixture = committed.season.competitions[0].fixtures[roundIndex].find(
      (f) => f.homeTeamId === playerFixture.homeTeamId && f.awayTeamId === playerFixture.awayTeamId,
    )!;
    expect(committedFixture.result).toEqual(finalResult);

    const benchPlayerAfter = committed.world.players.find((p) => p.id === benchPlayer.id)!;
    expect(benchPlayerAfter.seasonStats.appearances).toBe(1);

    const outPlayerAfter = committed.world.players.find((p) => p.id === outPlayer.id)!;
    expect(outPlayerAfter.seasonStats.appearances).toBe(1);
  });

  it('commitPlayerMatchResult persiste a energia final da partida em Player.condition de quem jogou', () => {
    const state = createBrasileiraoCareer(11, { id: 't1', name: 'X' }, 'palmeiras');
    const lineup = autoLineupFor(state, 'palmeiras');
    const { nextState, playerFixture, playerMatchResult, homeTeamInput, awayTeamInput, competitionId, roundIndex } =
      advanceToMatchDay(state, { playerLineup: lineup, playerTactics: DEFAULT_TACTICS });
    if (!playerFixture || !playerMatchResult || !homeTeamInput || !awayTeamInput || competitionId === undefined || roundIndex === undefined) {
      throw new Error('rodada de teste sem partida do jogador');
    }

    const committed = commitPlayerMatchResult(
      nextState,
      { playerFixture, competitionId, roundIndex, homeTeamInput, awayTeamInput },
      playerMatchResult,
    );

    for (const starterId of [...homeTeamInput.players, ...awayTeamInput.players].map((p) => p.id)) {
      const finalEnergy = playerMatchResult.finalEnergyByPlayerId[starterId];
      const playerAfter = committed.world.players.find((p) => p.id === starterId)!;
      expect(playerAfter.condition).toBe(Math.round(finalEnergy));
      // Titular que jogou os 90 minutos gasta energia de verdade — condição não pode ficar intacta em 100.
      expect(playerAfter.condition).toBeLessThan(100);
    }
  });

  it('advanceCalendar recupera Player.condition proporcionalmente aos dias de descanso até a próxima partida', () => {
    const state = createBrasileiraoCareer(11, { id: 't1', name: 'X' }, 'palmeiras');
    const lineup = autoLineupFor(state, 'palmeiras');
    const input = { playerLineup: lineup, playerTactics: DEFAULT_TACTICS };

    // Joga (e comita) a primeira partida do jogador pra deixar o elenco cansado de verdade.
    let career = advanceRound(state, input);

    const club = career.world.clubs.find((c) => c.id === 'palmeiras')!;
    const tiredPlayer = career.world.players.find((p) => p.id === club.squad.find((id) => lineup.starters.includes(id)))!;
    expect(tiredPlayer.condition).toBeLessThan(100);
    const conditionBefore = tiredPlayer.condition;

    // Avança só o calendário (sem comitar o próximo jogo do jogador) e mede quantos dias passaram.
    const calendar = advanceCalendar(career, input);
    const daysPassed =
      new Date(calendar.nextState.season.currentDate).getTime() / 86_400_000 -
      new Date(career.season.currentDate).getTime() / 86_400_000;
    expect(daysPassed).toBeGreaterThan(0);

    const recoveredPlayer = calendar.nextState.world.players.find((p) => p.id === tiredPlayer.id)!;
    expect(recoveredPlayer.condition).toBeGreaterThan(conditionBefore);
    expect(recoveredPlayer.condition).toBeLessThanOrEqual(100);
  });
});
