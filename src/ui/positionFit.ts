import type { Position } from '../engine/types';

export type PositionFit = 'natural' | 'similar' | 'poor';

/**
 * Coordenada de cada posição no campo: `line` vai do gol (0) ao ataque (5);
 * `side` vai da esquerda (-1) ao direito (+1), 0 = centro. Usado só pra medir
 * "distância" entre posições — não tem relação com a força setorial que o
 * motor de partida já calcula (essa é mais grossa, por setor amplo).
 */
const POSITION_COORD: Record<Position, { line: number; side: number }> = {
  GOL: { line: 0, side: 0 },
  ZAG: { line: 1, side: 0 },
  LD: { line: 1.3, side: 1 },
  LE: { line: 1.3, side: -1 },
  ALD: { line: 1.8, side: 1 },
  ALE: { line: 1.8, side: -1 },
  VOL: { line: 2.2, side: 0 },
  MC: { line: 3, side: 0 },
  MD: { line: 3.3, side: 1 },
  ME: { line: 3.3, side: -1 },
  MEA: { line: 4, side: 0 },
  PD: { line: 4.6, side: 1 },
  PE: { line: 4.6, side: -1 },
  SA: { line: 4.6, side: 0 },
  CA: { line: 5, side: 0 },
};

/** Distância acima da qual a posição já é considerada "ruim", não só "parecida". */
const POOR_THRESHOLD = 2.2;

/**
 * Compara a posição natural do jogador com a posição que ele está ocupando
 * na escalação. Goleiro é sempre caso especial: goleiro fora do gol (ou
 * jogador de linha no gol) é sempre "poor", não importa a geometria.
 */
export function positionFit(natural: Position, target: Position): PositionFit {
  if (natural === target) return 'natural';
  if (natural === 'GOL' || target === 'GOL') return 'poor';

  const a = POSITION_COORD[natural];
  const b = POSITION_COORD[target];
  const distance = Math.hypot(a.line - b.line, a.side - b.side);
  return distance <= POOR_THRESHOLD ? 'similar' : 'poor';
}

/** Multiplicador de força aplicado quando o jogador não está na posição natural. */
export function positionFitMultiplier(fit: PositionFit): number {
  if (fit === 'natural') return 1;
  if (fit === 'similar') return 0.9;
  return 0.65;
}

export function effectiveOverall(strength: number, fit: PositionFit): number {
  return Math.round(strength * positionFitMultiplier(fit));
}
