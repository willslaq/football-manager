import { describe, expect, it } from 'vitest';
import { addDays, assignFixtureDates, nearestSaturdayOnOrAfter, shiftYear } from './calendar';
import type { RawFixturesFile } from './rawData';

function weekdayOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** 5 rodadas x 4 partidas — pareamentos fictícios, só a estrutura importa aqui. */
function buildFixturesRaw(rounds: number, matchesPerRound: number): RawFixturesFile {
  return Array.from({ length: rounds }, (_, i) => ({
    round: i + 1,
    matches: Array.from({ length: matchesPerRound }, (_, m) => ({
      homeTeamId: `home-${i}-${m}`,
      awayTeamId: `away-${i}-${m}`,
    })),
  }));
}

describe('addDays / nearestSaturdayOnOrAfter', () => {
  it('addDays soma/subtrai dias corretamente, inclusive atravessando mês/ano', () => {
    expect(addDays('2026-08-29', 1)).toBe('2026-08-30');
    expect(addDays('2026-08-29', -1)).toBe('2026-08-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('nearestSaturdayOnOrAfter encontra o próprio dia se já for sábado', () => {
    // 2026-08-29 é um sábado.
    expect(weekdayOf('2026-08-29')).toBe(6);
    expect(nearestSaturdayOnOrAfter('2026-08-29')).toBe('2026-08-29');
  });

  it('nearestSaturdayOnOrAfter avança pro próximo sábado quando não é sábado', () => {
    // 2026-08-27 é uma quinta-feira (snapshot real do jogo).
    expect(weekdayOf('2026-08-27')).toBe(4);
    const result = nearestSaturdayOnOrAfter('2026-08-27');
    expect(weekdayOf(result)).toBe(6);
    expect(toDaysDiff('2026-08-27', result)).toBeLessThanOrEqual(6);
  });
});

function toDaysDiff(a: string, b: string): number {
  return (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000;
}

describe('shiftYear', () => {
  it('troca só o ano, mantendo mês/dia', () => {
    expect(shiftYear('2026-01-28', 1)).toBe('2027-01-28');
    expect(shiftYear('2026-01-28', 0)).toBe('2026-01-28');
    expect(shiftYear('2026-12-02', 2)).toBe('2028-12-02');
  });
});

describe('assignFixtureDates', () => {
  const fixturesRaw = buildFixturesRaw(6, 10);
  const anchorRound = 3;
  const anchorSaturday = '2026-08-29';

  it('é determinístico: mesma entrada produz sempre a mesma saída', () => {
    const a = assignFixtureDates(fixturesRaw, anchorRound, anchorSaturday);
    const b = assignFixtureDates(fixturesRaw, anchorRound, anchorSaturday);
    expect(a).toEqual(b);
  });

  it('a rodada âncora cai exatamente no sábado informado (e domingo seguinte)', () => {
    const dates = assignFixtureDates(fixturesRaw, anchorRound, anchorSaturday);
    const anchorRoundDates = dates[anchorRound - 1];
    expect(anchorRoundDates.slice(0, 5)).toEqual(Array(5).fill('2026-08-29'));
    expect(anchorRoundDates.slice(5)).toEqual(Array(5).fill('2026-08-30'));
  });

  it('só produz sábados e domingos, nunca outro dia da semana', () => {
    const dates = assignFixtureDates(fixturesRaw, anchorRound, anchorSaturday);
    for (const roundDates of dates) {
      for (const date of roundDates) {
        expect([0, 6]).toContain(weekdayOf(date));
      }
    }
  });

  it('rodadas ficam em ordem cronológica não decrescente (uma semana de distância)', () => {
    const dates = assignFixtureDates(fixturesRaw, anchorRound, anchorSaturday);
    for (let i = 1; i < dates.length; i++) {
      const prevMax = dates[i - 1][dates[i - 1].length - 1];
      const currentMin = dates[i][0];
      expect(toDaysDiff(prevMax, currentMin)).toBeGreaterThan(0);
    }
  });

  it('cada rodada é uma semana (7 dias) de distância da âncora', () => {
    const dates = assignFixtureDates(fixturesRaw, anchorRound, anchorSaturday);
    dates.forEach((roundDates, i) => {
      const round = i + 1;
      const expectedSaturday = addDays(anchorSaturday, (round - anchorRound) * 7);
      expect(roundDates[0]).toBe(expectedSaturday);
    });
  });

  it('paralelo em formato a fixturesRaw (mesmo número de rodadas e partidas por rodada)', () => {
    const dates = assignFixtureDates(fixturesRaw, anchorRound, anchorSaturday);
    expect(dates.length).toBe(fixturesRaw.length);
    dates.forEach((roundDates, i) => expect(roundDates.length).toBe(fixturesRaw[i].matches.length));
  });
});
