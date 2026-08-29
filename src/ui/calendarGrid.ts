import { fromEpochDay, toEpochDay } from '../engine/generation/calendar';

export interface MonthCell {
  iso: string;
  day: number;
  /** false = preenchimento do mês anterior/seguinte, só pra fechar a grade em semanas completas. */
  inMonth: boolean;
}

/** 0 = domingo — mesma convenção de `Date.getUTCDay`, mas sem criar um `Date` (época 0 = quinta-feira). */
export function weekdayOfEpochDay(epochDay: number): number {
  return (((epochDay + 4) % 7) + 7) % 7;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Grade fixa de 6 semanas (42 células) do mês `year`-`month` (0-indexado) começando no domingo —
 * mesma aritmética de dia-época UTC de `engine/generation/calendar.ts`, pra nunca sofrer de fuso
 * horário. Altura fixa em 6 semanas mesmo quando o mês cabe em menos, pra não pular de tamanho ao
 * navegar entre meses (ver Calendar.tsx).
 */
export function buildMonthGrid(year: number, month: number): MonthCell[] {
  const firstIso = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const firstEpoch = toEpochDay(firstIso);
  const leadingBlanks = weekdayOfEpochDay(firstEpoch);
  const totalDaysInMonth = daysInMonth(year, month);
  const startEpoch = firstEpoch - leadingBlanks;

  return Array.from({ length: 42 }, (_, i) => {
    const epoch = startEpoch + i;
    const iso = fromEpochDay(epoch);
    return { iso, day: Number(iso.slice(8, 10)), inMonth: i >= leadingBlanks && i < leadingBlanks + totalDaysInMonth };
  });
}
