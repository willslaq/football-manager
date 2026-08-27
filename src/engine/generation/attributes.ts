import type { RNG } from '../rng';
import { deriveSeed, roll } from '../rng';
import type { Position, PlayerAttributes } from '../types/player';
import { ATTRIBUTE_KEYS, POSITION_ATTRIBUTE_WEIGHTS } from './attributeWeights';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Combina a seed global da carreira com o id do jogador — mesma carreira, mesmo jogador, mesmos atributos. */
export function playerSeed(globalSeed: number, playerId: string): number {
  return deriveSeed(globalSeed, playerId);
}

/**
 * Deriva uma reputação de clube (0-100) a partir da posição real na tabela.
 * 1º colocado ~= 90, último colocado ~= 40. Única fonte de "força de clube"
 * disponível para dados reais (não temos histórico de títulos/finanças no MVP).
 */
export function clubReputationFromStanding(position: number, totalTeams: number): number {
  if (totalTeams <= 1) return 70;
  const t = (position - 1) / (totalTeams - 1);
  return clamp(90 - t * 50, 0, 100);
}

/** Curva de idade: rendimento sobe até ~24, platô 24-29, declina depois dos 29. */
function ageFactor(age: number): number {
  if (age < 24) return 0.82 + (age - 15) * (0.18 / 9);
  if (age <= 29) return 1.0;
  if (age <= 35) return 1.0 - (age - 29) * 0.025;
  return 0.85;
}

export interface DerivedPlayerData {
  attributes: PlayerAttributes;
  strength: number;
  potential: number;
  condition: number;
  morale: number;
}

export function generatePlayerDerived(
  rng: RNG,
  position: Position,
  age: number,
  clubReputation: number,
): DerivedPlayerData {
  const weights = POSITION_ATTRIBUTE_WEIGHTS[position];
  const baseLevel = clamp(clubReputation * ageFactor(age), 20, 95);

  const attributes = {} as PlayerAttributes;
  let weightedSum = 0;
  let weightTotal = 0;

  for (const key of ATTRIBUTE_KEYS) {
    const weight = weights[key];
    const center = baseLevel * (0.45 + 0.55 * weight);
    const noise = roll(rng, -8, 8);
    const value = clamp(center + noise, 5, 99);
    attributes[key] = value;
    weightedSum += value * weight;
    weightTotal += weight;
  }

  const strength = clamp(weightedSum / weightTotal, 5, 99);

  const youthRoom = Math.max(0, 26 - age);
  const potentialBoost = youthRoom > 0 ? roll(rng, 0, youthRoom * 2) : roll(rng, 0, 3);
  const potential = clamp(strength + potentialBoost, strength, 99);

  const morale = clamp(70 + roll(rng, -10, 10), 30, 100);

  return {
    attributes,
    strength,
    potential,
    condition: 100,
    morale,
  };
}
