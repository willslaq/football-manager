import type { Player, Position } from '../types/player';
import { HOME_ADVANTAGE } from './config';
import { positionFit, POSITION_FIT_MULTIPLIER, PRIMARY_POSITION_BONUS } from './positionFit';

export type Sector = 'goalkeeper' | 'defense' | 'midfield' | 'attack';

const SECTOR_BY_POSITION: Record<Position, Sector> = {
  GOL: 'goalkeeper',
  ZAG: 'defense',
  LD: 'defense',
  LE: 'defense',
  ALD: 'defense',
  ALE: 'defense',
  VOL: 'midfield',
  MC: 'midfield',
  MD: 'midfield',
  ME: 'midfield',
  MEA: 'midfield',
  PD: 'attack',
  PE: 'attack',
  SA: 'attack',
  CA: 'attack',
};

export function positionSector(position: Position): Sector {
  return SECTOR_BY_POSITION[position];
}

/**
 * Nota efetiva de um jogador numa vaga: força base (+ bônus de posição
 * principal) modulada por condição, moral e o encaixe posicional real
 * (`targetPosition` é a vaga exata da escalação — LD, ZAG, PE etc. —, não
 * só o setor amplo). Único lugar que decide quanto vale um jogador fora de
 * posição pra valer, tanto pra escalação do jogador quanto pra CPU.
 */
export function effectiveRating(player: Player, targetPosition: Position): number {
  const fit = positionFit(player, targetPosition);
  const bonus = fit === 'primary' ? PRIMARY_POSITION_BONUS : 0;
  const conditionFactor = 0.7 + 0.3 * (player.condition / 100);
  const moraleFactor = 0.85 + 0.15 * (player.morale / 100);
  return (player.strength + bonus) * conditionFactor * moraleFactor * POSITION_FIT_MULTIPLIER[fit];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export interface SectorStrengths {
  defense: number;
  midfield: number;
  attack: number;
}

/**
 * Força por setor a partir da escalação (SRS §14 / plano §7). O goleiro entra
 * na nota de defesa junto com os zagueiros/laterais.
 *
 * `slotPositionByPlayerId`, quando informado, traz a vaga exata (LD, ZAG,
 * PE...) que cada titular ocupa na formação escolhida — tanto o setor de
 * cada um (defesa/meio/ataque) quanto a nota efetiva passam a vir dessa
 * vaga real, não da posição natural do próprio jogador. Sem isso (times sem
 * escalação detalhada), cai de volta na posição natural, como sempre foi.
 */
export function computeSectorStrengths(
  starters: Player[],
  isHome: boolean,
  slotPositionByPlayerId?: Record<string, Position>,
): SectorStrengths {
  const slotFor = (p: Player): Position => slotPositionByPlayerId?.[p.id] ?? p.position;
  const sectorFor = (p: Player) => positionSector(slotFor(p));

  const goalkeeper = starters.find((p) => sectorFor(p) === 'goalkeeper');
  const defenders = starters.filter((p) => sectorFor(p) === 'defense');
  const midfielders = starters.filter((p) => sectorFor(p) === 'midfield');
  const attackers = starters.filter((p) => sectorFor(p) === 'attack');

  const goalkeeperRating = goalkeeper ? effectiveRating(goalkeeper, slotFor(goalkeeper)) : 50;
  const defenseRatings = [goalkeeperRating, ...defenders.map((p) => effectiveRating(p, slotFor(p)))];

  const strengths: SectorStrengths = {
    defense: mean(defenseRatings),
    midfield: mean(midfielders.map((p) => effectiveRating(p, slotFor(p)))),
    attack: mean(attackers.map((p) => effectiveRating(p, slotFor(p)))),
  };

  if (!isHome) return strengths;

  return {
    defense: strengths.defense * HOME_ADVANTAGE,
    midfield: strengths.midfield * HOME_ADVANTAGE,
    attack: strengths.attack * HOME_ADVANTAGE,
  };
}
