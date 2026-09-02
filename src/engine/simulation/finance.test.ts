import { describe, expect, it } from 'vitest';
import type { CareerState } from '../types/career';
import type { Club } from '../types/club';
import type { StandingEntry } from '../types/competition';
import {
  applyMatchdayRevenue,
  computeMatchdayRevenue,
  computePrizeMoney,
  computeStartingBudget,
  defaultTicketPrice,
  prizePoolForDivision,
  setTicketPrice,
  ticketPriceRange,
} from './finance';

function makeClub(overrides: Partial<Club> = {}): Club {
  return {
    id: 'club-a',
    name: 'Clube A',
    shortName: 'CLA',
    reputation: 50,
    morale: 50,
    colors: { primary: '#000', secondary: '#fff' },
    stadiumCapacity: 40000,
    squad: ['p1'],
    budget: 10_000_000,
    ticketPrice: 25,
    ...overrides,
  };
}

function makeStandings(clubIds: string[]): StandingEntry[] {
  return clubIds.map((clubId) => ({ clubId, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 }));
}

describe('computeStartingBudget', () => {
  it('cresce com reputação e capacidade do estádio', () => {
    const small = computeStartingBudget(30, 6000);
    const big = computeStartingBudget(90, 78000);
    expect(big).toBeGreaterThan(small);
    expect(small).toBeGreaterThan(0);
  });
});

describe('defaultTicketPrice / ticketPriceRange', () => {
  it('Série A é mais cara que Série B, e a faixa contém o próprio padrão', () => {
    expect(defaultTicketPrice(true)).toBeGreaterThan(defaultTicketPrice(false));
    for (const isSeriesA of [true, false]) {
      const base = defaultTicketPrice(isSeriesA);
      const { min, max } = ticketPriceRange(isSeriesA);
      expect(min).toBeLessThanOrEqual(base);
      expect(max).toBeGreaterThanOrEqual(base);
    }
  });
});

describe('computeMatchdayRevenue', () => {
  it('nunca dá público negativo nem maior que a capacidade, e receita bate com público × preço', () => {
    const homeClub = makeClub({ reputation: 80, morale: 90, stadiumCapacity: 50000, ticketPrice: 25 });
    const awayClub = makeClub({ id: 'club-b', reputation: 40 });
    for (let seed = 0; seed < 50; seed++) {
      const result = computeMatchdayRevenue({
        homeClub,
        awayClub,
        homeTablePosition: 1,
        totalTeams: 20,
        isSeriesA: true,
        seed,
      });
      expect(result.attendance).toBeGreaterThanOrEqual(0);
      expect(result.attendance).toBeLessThanOrEqual(homeClub.stadiumCapacity);
      expect(result.revenueEur).toBe(Math.round(result.attendance * homeClub.ticketPrice));
    }
  });

  it('preço acima do padrão da divisão reduz ocupação (elasticidade) em igualdade de resto', () => {
    const base = makeClub({ ticketPrice: defaultTicketPrice(true) });
    const expensive = makeClub({ ticketPrice: defaultTicketPrice(true) * 2 });
    const away = makeClub({ id: 'club-b' });
    const input = { awayClub: away, homeTablePosition: 10, totalTeams: 20, isSeriesA: true, seed: 42 };
    const baseResult = computeMatchdayRevenue({ ...input, homeClub: base });
    const expensiveResult = computeMatchdayRevenue({ ...input, homeClub: expensive });
    expect(expensiveResult.occupancy).toBeLessThan(baseResult.occupancy);
  });
});

describe('computePrizeMoney', () => {
  it('taper linear: 1º lugar recebe mais que o último, soma bate com o pool', () => {
    const totalTeams = 20;
    const pool = 40_000_000;
    const first = computePrizeMoney(1, totalTeams, pool);
    const last = computePrizeMoney(totalTeams, totalTeams, pool);
    expect(first).toBeGreaterThan(last);

    let sum = 0;
    for (let position = 1; position <= totalTeams; position++) sum += computePrizeMoney(position, totalTeams, pool);
    expect(sum).toBeCloseTo(pool, -3);
  });
});

describe('prizePoolForDivision', () => {
  it('Série A tem pool maior que Série B', () => {
    expect(prizePoolForDivision(true)).toBeGreaterThan(prizePoolForDivision(false));
  });
});

describe('applyMatchdayRevenue', () => {
  it('credita só o mandante e só gera transação de extrato pro clube do jogador', () => {
    const home = makeClub({ id: 'home', budget: 1_000_000 });
    const away = makeClub({ id: 'away', budget: 2_000_000 });
    const clubs = [home, away];
    const standings = makeStandings(['home', 'away']);

    const asHome = applyMatchdayRevenue(clubs, 'home', 'away', standings, 20, true, 'home', '2026-05-01', 1);
    expect(asHome.clubs.find((c) => c.id === 'home')!.budget).toBeGreaterThan(home.budget);
    expect(asHome.clubs.find((c) => c.id === 'away')!.budget).toBe(away.budget);
    expect(asHome.transaction).not.toBeNull();
    expect(asHome.transaction!.type).toBe('matchday');

    const asBystander = applyMatchdayRevenue(clubs, 'home', 'away', standings, 20, true, 'someone-else', '2026-05-01', 1);
    expect(asBystander.transaction).toBeNull();
  });
});

describe('setTicketPrice', () => {
  function makeCareer(clubId: string, ticketPrice: number): CareerState {
    const club = makeClub({ id: clubId, ticketPrice });
    return {
      seed: 1,
      trainer: { id: 't1', name: 'Treinador' },
      playerClubId: clubId,
      world: { clubs: [club], players: [] },
      season: {
        year: 2026,
        calendar: [],
        competitions: [{ id: 'serie-a', name: 'Série A', teams: [clubId], fixtures: [], standings: [] }],
        state: 'in_progress',
        currentDate: '2026-05-01',
        currentRound: 1,
      },
      history: [],
      settings: { tacticalIntensity: 'subtle' },
      financeLog: [],
    };
  }

  it('clampa o preço à faixa da divisão do clube do jogador', () => {
    const career = makeCareer('home', 25);
    const { min, max } = ticketPriceRange(true);

    const tooHigh = setTicketPrice(career, max + 1000);
    expect(tooHigh.world.clubs[0].ticketPrice).toBe(max);

    const tooLow = setTicketPrice(career, min - 1000);
    expect(tooLow.world.clubs[0].ticketPrice).toBe(min);

    const valid = min + 1;
    expect(setTicketPrice(career, valid).world.clubs[0].ticketPrice).toBe(Math.round(valid));
  });
});
