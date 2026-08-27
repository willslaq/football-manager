// PRNG com seed (mulberry32) — determinismo é requisito do motor (SRS RNF-005).
// Nunca usar Math.random() dentro do motor: toda aleatoriedade passa por aqui.

export type RNG = () => number;

/**
 * mulberry32: gerador simples, rápido e determinístico.
 * Retorna uma função que produz floats em [0, 1) a cada chamada.
 */
export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inteiro aleatório em [min, max] (inclusive). */
export function roll(rng: RNG, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/** Escolhe um elemento uniformemente ao acaso. */
export function pick<T>(rng: RNG, items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error('pick: items vazio');
  }
  return items[Math.floor(rng() * items.length)];
}

/** Escolhe um elemento ponderado por peso (pesos > 0). */
export function weighted<T>(rng: RNG, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) {
    throw new Error('weighted: soma dos pesos deve ser > 0');
  }
  let target = rng() * total;
  for (const [item, weight] of items) {
    target -= weight;
    if (target <= 0) return item;
  }
  return items[items.length - 1][0];
}

/** true com probabilidade `p` (0..1). */
export function chance(rng: RNG, p: number): boolean {
  return rng() < p;
}

/** Hash determinístico simples (FNV-1a) — usado para derivar seeds por entidade (jogador, partida, ...). */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Combina uma seed global com uma chave estável (id de jogador, partida, ...) numa nova seed determinística. */
export function deriveSeed(globalSeed: number, key: string): number {
  return (globalSeed ^ hashString(key)) >>> 0;
}
