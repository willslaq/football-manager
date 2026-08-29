import type { RawFixturesFile } from './rawData';

/**
 * Geração de datas do calendário: puro, determinístico, sem RNG. O Brasileirão real 2026 já
 * está embutido em fixtures.json (pareamentos reais, sem data) — aqui só aproximamos QUANDO cada
 * rodada acontece: uma rodada por semana, jogos só aos sábados e domingos (metade dos jogos da
 * rodada em cada dia, na ordem real já existente em fixtures.json). Não tenta reproduzir as datas
 * reais de transmissão (não há fonte confiável pra isso, ver plano) — só um calendário plausível,
 * ancorado pra bater com o snapshot real (`standings-current.json`'s currentRound/snapshotDate).
 */

const MS_PER_DAY = 86_400_000;

/** Dias desde a época Unix, em UTC — aritmética de data sem risco de fuso horário/horário de verão. */
export function toEpochDay(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

export function fromEpochDay(day: number): string {
  const date = new Date(day * MS_PER_DAY);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${dayOfMonth}`;
}

export function addDays(iso: string, days: number): string {
  return fromEpochDay(toEpochDay(iso) + days);
}

/** 0 = domingo, 6 = sábado (mesma convenção de Date.getUTCDay). */
function weekday(iso: string): number {
  return new Date(toEpochDay(iso) * MS_PER_DAY).getUTCDay();
}

/** O primeiro sábado igual ou depois de `iso`. */
export function nearestSaturdayOnOrAfter(iso: string): string {
  const daysUntilSaturday = (6 - weekday(iso) + 7) % 7;
  return addDays(iso, daysUntilSaturday);
}

/** Troca só o componente de ano de uma data ISO (mesmo mês/dia) — usado pra reaproveitar os limites da temporada real em anos seguintes. */
export function shiftYear(iso: string, deltaYears: number): string {
  const [year, month, day] = iso.split('-');
  return `${Number(year) + deltaYears}-${month}-${day}`;
}

/**
 * Atribui uma data a cada partida de cada rodada: a rodada `anchorRound` cai no sábado
 * `anchorSaturday` (e domingo seguinte); toda outra rodada fica `(round - anchorRound)` semanas
 * de distância. Dentro da rodada, a primeira metade das partidas (ordem real, já fixa em
 * fixtures.json) joga no sábado, a segunda metade no domingo. Paralelo em formato a `fixturesRaw`
 * (`dates[i][j]` corresponde a `fixturesRaw[i].matches[j]`).
 */
export function assignFixtureDates(fixturesRaw: RawFixturesFile, anchorRound: number, anchorSaturday: string): string[][] {
  return fixturesRaw.map((round) => {
    const saturday = addDays(anchorSaturday, (round.round - anchorRound) * 7);
    const sunday = addDays(saturday, 1);
    const half = Math.ceil(round.matches.length / 2);
    return round.matches.map((_, i) => (i < half ? saturday : sunday));
  });
}
