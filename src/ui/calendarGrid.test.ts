import { describe, expect, it } from 'vitest';
import { buildMonthGrid, weekdayOfEpochDay } from './calendarGrid';
import { toEpochDay } from '../engine/generation/calendar';

describe('weekdayOfEpochDay', () => {
  it('bate com Date.getUTCDay() pra uma amostra de dias conhecidos', () => {
    // 2026-08-29 é um sábado (mesmo snapshot usado em engine/generation/calendar.test.ts).
    expect(weekdayOfEpochDay(toEpochDay('2026-08-29'))).toBe(6);
    // 2026-08-30 é domingo.
    expect(weekdayOfEpochDay(toEpochDay('2026-08-30'))).toBe(0);
    // Época 0 (1970-01-01) é uma quinta-feira.
    expect(weekdayOfEpochDay(0)).toBe(4);
  });
});

describe('buildMonthGrid', () => {
  it('sempre devolve 42 células (6 semanas fixas), qualquer que seja o mês', () => {
    for (const [year, month] of [
      [2026, 0],
      [2026, 1],
      [2026, 7],
      [2027, 11],
    ]) {
      expect(buildMonthGrid(year, month)).toHaveLength(42);
    }
  });

  it('o primeiro dia do mês cai na coluna certa (mesmo weekday devolvido por weekdayOfEpochDay)', () => {
    // Agosto de 2026 começa numa sábado (2026-08-01) — confirma contra o cálculo independente.
    const grid = buildMonthGrid(2026, 7);
    const firstOfMonthIndex = grid.findIndex((c) => c.inMonth);
    expect(grid[firstOfMonthIndex].iso).toBe('2026-08-01');
    expect(firstOfMonthIndex).toBe(weekdayOfEpochDay(toEpochDay('2026-08-01')));
  });

  it('todas as células "inMonth" têm o dia certo, em sequência, sem pular nem repetir', () => {
    const grid = buildMonthGrid(2026, 1); // fevereiro de 2026 (28 dias, sem ano bissexto)
    const inMonthDays = grid.filter((c) => c.inMonth).map((c) => c.day);
    expect(inMonthDays).toEqual(Array.from({ length: 28 }, (_, i) => i + 1));
  });

  it('células de preenchimento (fora do mês) têm datas ISO contíguas ao mês, não arbitrárias', () => {
    const grid = buildMonthGrid(2026, 7); // agosto de 2026
    const leading = grid.filter((c, i) => !c.inMonth && i < 20);
    const trailing = grid.filter((c, i) => !c.inMonth && i >= 20);
    for (const cell of leading) expect(cell.iso < '2026-08-01').toBe(true);
    for (const cell of trailing) expect(cell.iso > '2026-08-31').toBe(true);
  });

  it('é determinístico: mesma entrada produz sempre a mesma saída', () => {
    expect(buildMonthGrid(2026, 7)).toEqual(buildMonthGrid(2026, 7));
  });
});
