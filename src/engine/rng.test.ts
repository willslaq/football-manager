import { describe, expect, it } from 'vitest';
import { chance, mulberry32, pick, roll, weighted } from './rng';

describe('mulberry32', () => {
  it('produz a mesma sequência para a mesma seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produz sequências diferentes para seeds diferentes', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('gera floats no intervalo [0, 1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('roll', () => {
  it('respeita os limites inclusive', () => {
    const rng = mulberry32(123);
    for (let i = 0; i < 1000; i++) {
      const v = roll(rng, 1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
  });
});

describe('pick', () => {
  it('escolhe sempre um item da lista', () => {
    const rng = mulberry32(5);
    const items = ['a', 'b', 'c'];
    for (let i = 0; i < 100; i++) {
      expect(items).toContain(pick(rng, items));
    }
  });
});

describe('weighted', () => {
  it('favorece itens com maior peso ao longo de muitas amostras', () => {
    const rng = mulberry32(9);
    const counts = { alto: 0, baixo: 0 };
    for (let i = 0; i < 10000; i++) {
      const item = weighted(rng, [
        ['alto', 90],
        ['baixo', 10],
      ] as const);
      counts[item]++;
    }
    expect(counts.alto).toBeGreaterThan(counts.baixo * 3);
  });
});

describe('chance', () => {
  it('aproxima a probabilidade informada ao longo de muitas amostras', () => {
    const rng = mulberry32(3);
    let hits = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      if (chance(rng, 0.3)) hits++;
    }
    const ratio = hits / n;
    expect(ratio).toBeGreaterThan(0.27);
    expect(ratio).toBeLessThan(0.33);
  });
});
