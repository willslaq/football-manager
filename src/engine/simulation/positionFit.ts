import type { Player, Position } from '../types/player';

/**
 * Encaixe de um jogador numa vaga: 'primary' (posição principal — ganha
 * bônus), 'secondary' (posição secundária dele — sem bônus nem penalidade),
 * 'similar'/'poor' (fora de posição — penalidade crescente). Fonte única
 * usada tanto pela UI de Escalação (indicador visual) quanto pelo motor de
 * partida (força efetiva de fato) — o que se vê no campo é o que decide o
 * jogo.
 */
export type PositionFit = 'primary' | 'secondary' | 'similar' | 'poor';

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

/** Bônus fixo somado à força antes dos multiplicadores, só quando jogando exatamente na posição principal. */
export const PRIMARY_POSITION_BONUS = 1;

/** Multiplicador de força: 1.0 quando não há penalidade (principal ou secundária), <1 fora de posição. */
export const POSITION_FIT_MULTIPLIER: Record<PositionFit, number> = {
  primary: 1,
  secondary: 1,
  similar: 0.9,
  poor: 0.65,
};

/**
 * Compara a posição principal e as secundárias do jogador com a vaga que
 * ele está ocupando na escalação. Quando a vaga não é nenhuma das duas, usa
 * a menor distância geométrica até qualquer posição do jogador. Goleiro é
 * sempre caso especial: goleiro fora do gol (ou jogador de linha no gol) é
 * sempre "poor", não importa a geometria.
 */
export function positionFit(player: Pick<Player, 'position' | 'secondaryPositions'>, target: Position): PositionFit {
  if (player.position === target) return 'primary';
  if (player.secondaryPositions.includes(target)) return 'secondary';

  const positions: Position[] = [player.position, ...player.secondaryPositions];
  if (target === 'GOL' || positions.includes('GOL')) return 'poor';

  const b = POSITION_COORD[target];
  const bestDistance = Math.min(
    ...positions.map((p) => Math.hypot(POSITION_COORD[p].line - b.line, POSITION_COORD[p].side - b.side)),
  );
  return bestDistance <= POOR_THRESHOLD ? 'similar' : 'poor';
}

/** Overall efetivo de um jogador numa vaga: força base + bônus de posição principal, com o multiplicador de encaixe. */
export function effectiveOverall(
  player: Pick<Player, 'position' | 'secondaryPositions' | 'strength'>,
  target: Position,
): number {
  const fit = positionFit(player, target);
  const bonus = fit === 'primary' ? PRIMARY_POSITION_BONUS : 0;
  return Math.round((player.strength + bonus) * POSITION_FIT_MULTIPLIER[fit]);
}
