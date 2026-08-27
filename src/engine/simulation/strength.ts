import type { Player, Position } from '../types/player';
import { HOME_ADVANTAGE } from './config';

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

const SECTOR_ADJACENCY: Partial<Record<Sector, Sector[]>> = {
  defense: ['midfield'],
  midfield: ['defense', 'attack'],
  attack: ['midfield'],
};

/**
 * Quanto um jogador rende jogando fora da sua posição natural.
 * 1.0 = posição natural; setor adjacente rende menos; extremos opostos, bem menos.
 */
function positionFit(natural: Sector, target: Sector): number {
  if (natural === target) return 1.0;
  if (SECTOR_ADJACENCY[target]?.includes(natural)) return 0.85;
  return 0.6;
}

/** Nota efetiva de um jogador num setor: força base modulada por condição, moral e adequação posicional. */
export function effectiveRating(player: Player, sector: Sector): number {
  const natural = positionSector(player.position);
  const fit = natural === 'goalkeeper' ? (sector === 'goalkeeper' ? 1.0 : 0.5) : positionFit(natural, sector);
  const conditionFactor = 0.7 + 0.3 * (player.condition / 100);
  const moraleFactor = 0.85 + 0.15 * (player.morale / 100);
  return player.strength * conditionFactor * moraleFactor * fit;
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
 */
export function computeSectorStrengths(starters: Player[], isHome: boolean): SectorStrengths {
  const goalkeeper = starters.find((p) => positionSector(p.position) === 'goalkeeper');
  const defenders = starters.filter((p) => positionSector(p.position) === 'defense');
  const midfielders = starters.filter((p) => positionSector(p.position) === 'midfield');
  const attackers = starters.filter((p) => positionSector(p.position) === 'attack');

  const goalkeeperRating = goalkeeper ? effectiveRating(goalkeeper, 'goalkeeper') : 50;
  const defenseRatings = [goalkeeperRating, ...defenders.map((p) => effectiveRating(p, 'defense'))];

  const strengths: SectorStrengths = {
    defense: mean(defenseRatings),
    midfield: mean(midfielders.map((p) => effectiveRating(p, 'midfield'))),
    attack: mean(attackers.map((p) => effectiveRating(p, 'attack'))),
  };

  if (!isHome) return strengths;

  return {
    defense: strengths.defense * HOME_ADVANTAGE,
    midfield: strengths.midfield * HOME_ADVANTAGE,
    attack: strengths.attack * HOME_ADVANTAGE,
  };
}
