import type { RNG } from '../rng';
import { deriveSeed, roll } from '../rng';
import type { Position, PlayerAttributes } from '../types/player';
import type { RawFifaAttributes } from './rawData';
import { ATTRIBUTE_KEYS, POSITION_ATTRIBUTE_WEIGHTS } from './attributeWeights';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function avg(...values: (number | undefined)[]): number {
  const present = values.filter((v): v is number => typeof v === 'number');
  if (present.length === 0) return 50;
  return clamp(present.reduce((sum, v) => sum + v, 0) / present.length, 0, 100);
}

/**
 * Dados reais (EA FC 26) de um jogador, quando disponíveis — substitui a
 * geração procedural de strength/potential/attributes por valores reais.
 * Ver TODO.md: altura/peso/pé ainda não entram na simulação, só na UI.
 */
export interface RealPlayerData {
  overall: number;
  potential: number;
  attributes: RawFifaAttributes;
}

/**
 * Reduz os 33 atributos granulares do FIFA aos 9 campos internos
 * (modelo simplificado do motor), fazendo a média dos sub-atributos mais
 * correlatos a cada categoria. Único lugar desse mapeamento — ajustar aqui.
 */
function mapRealAttributes(a: RawFifaAttributes): PlayerAttributes {
  return {
    finishing: avg(a.finishing, a.shotpower, a.volleys, a.penalties, a.longshots),
    speed: avg(a.acceleration, a.sprintspeed),
    dribbling: avg(a.dribbling, a.agility, a.balance, a.ballcontrol),
    passing: avg(a.shortpassing, a.longpassing, a.crossing, a.vision, a.curve, a.freekickaccuracy),
    heading: avg(a.headingaccuracy, a.jumping),
    marking: avg(a.defensiveawareness, a.interceptions),
    tackling: avg(a.standingtackle, a.slidingtackle),
    positioning: avg(a.positioning, a.reactions, a.composure),
    reflexes: avg(a.gkreflexes, a.gkdiving, a.gkhandling, a.gkpositioning, a.gkkicking),
    aggression: avg(a.aggression),
  };
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
  real?: RealPlayerData,
): DerivedPlayerData {
  const morale = clamp(70 + roll(rng, -10, 10), 30, 100);

  if (real) {
    return {
      attributes: mapRealAttributes(real.attributes),
      strength: clamp(real.overall, 0, 100),
      potential: clamp(real.potential, 0, 100),
      condition: 100,
      morale,
    };
  }

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

  return {
    attributes,
    strength,
    potential,
    condition: 100,
    morale,
  };
}
