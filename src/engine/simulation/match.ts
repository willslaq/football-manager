import { chance, mulberry32, roll, weighted } from '../rng';
import type { ClubId } from '../types/club';
import type { MatchEvent, MatchResult, Reason } from '../types/match';
import type { Player } from '../types/player';
import type { Tactics, TacticStyle } from '../types/tactics';
import {
  BASE_CHANCES_PER_TEAM,
  BASE_GOAL_PROBABILITY,
  MAX_GOAL_PROBABILITY,
  MIN_GOAL_PROBABILITY,
  ON_TARGET_MISS_PROBABILITY,
  RATIO_COMPRESSION,
  STYLE_MODIFIERS,
  type StyleModifiers,
} from './config';
import { computeSectorStrengths, type SectorStrengths } from './strength';

export interface MatchTeamInput {
  clubId: ClubId;
  /** Exatamente 11 titulares. */
  players: Player[];
  tactics: Tactics;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function assertValidLineup(team: MatchTeamInput): void {
  if (team.players.length !== 11) {
    throw new Error(`simulateMatch: time ${team.clubId} precisa de exatamente 11 titulares, recebeu ${team.players.length}`);
  }
}

function possessionFactor(share: number): number {
  return 0.7 + 0.6 * share;
}

/** Aproxima uma razão 0..1 de 0.5, para evitar que o mesmo gap de força seja aplicado duas vezes (volume e qualidade). */
function compressRatio(ratio: number): number {
  return 0.5 + (ratio - 0.5) * RATIO_COMPRESSION;
}

interface ChanceParams {
  attack: number;
  defense: number;
  ownStyleMod: StyleModifiers;
  oppStyleMod: StyleModifiers;
  possession: number;
}

function expectedChances(params: ChanceParams): number {
  const { attack, defense, ownStyleMod, oppStyleMod, possession } = params;
  const ratio = compressRatio(attack / (attack + defense || 1));
  return (
    BASE_CHANCES_PER_TEAM * ratio * 2 * ownStyleMod.attackVolume * oppStyleMod.concedeVolume * possessionFactor(possession)
  );
}

function rollChanceCount(rng: () => number, params: ChanceParams): number {
  const expected = expectedChances(params);
  const noisy = Math.round(expected) + roll(rng, -1, 1);
  return Math.max(0, noisy);
}

interface ResolvedChance {
  minute: number;
  isGoal: boolean;
  isOnTarget: boolean;
  scorer?: Player;
}

function pickScorer(rng: () => number, attackers: Player[]): Player | undefined {
  const pool = attackers.filter((p) => p.position !== 'GOL');
  if (pool.length === 0) return undefined;
  const weights = pool.map((p) => [p, p.attributes.finishing + p.attributes.heading * 0.3 + 1] as const);
  return weighted(rng, weights);
}

function resolveChance(
  rng: () => number,
  attackStrength: number,
  defenseStrength: number,
  styleMod: StyleModifiers,
  attackers: Player[],
): ResolvedChance {
  const quality = compressRatio(attackStrength / (attackStrength + defenseStrength || 1));
  const goalProbability = clamp(
    BASE_GOAL_PROBABILITY * (quality / 0.5) * styleMod.qualityMultiplier,
    MIN_GOAL_PROBABILITY,
    MAX_GOAL_PROBABILITY,
  );
  const isGoal = chance(rng, goalProbability);
  const isOnTarget = isGoal || chance(rng, ON_TARGET_MISS_PROBABILITY);
  const minute = roll(rng, 1, 90);
  const scorer = isGoal ? pickScorer(rng, attackers) : undefined;
  return { minute, isGoal, isOnTarget, scorer };
}

function pickManOfTheMatch(
  home: MatchTeamInput,
  away: MatchTeamInput,
  goalsByPlayer: Map<string, number>,
  homeGoals: number,
  awayGoals: number,
): Player {
  const allPlayers = [...home.players, ...away.players];
  let topScorers = allPlayers.filter((p) => (goalsByPlayer.get(p.id) ?? 0) > 0);
  if (topScorers.length > 0) {
    const maxGoals = Math.max(...topScorers.map((p) => goalsByPlayer.get(p.id) ?? 0));
    topScorers = topScorers.filter((p) => (goalsByPlayer.get(p.id) ?? 0) === maxGoals);
    return topScorers.sort((a, b) => b.strength - a.strength)[0];
  }

  const pool = homeGoals === awayGoals ? allPlayers : homeGoals > awayGoals ? home.players : away.players;
  return [...pool].sort((a, b) => b.strength - a.strength)[0];
}

function normalizeImpact(diff: number, scale: number): number {
  return clamp(diff / scale, -1, 1);
}

const COUNTER_EXPOSED_STYLES: TacticStyle[] = ['offensive', 'pressing', 'possession'];

function buildExplanation(
  homeStrength: SectorStrengths,
  awayStrength: SectorStrengths,
  possessionHome: number,
  home: MatchTeamInput,
  away: MatchTeamInput,
  homeGoals: number,
  awayGoals: number,
): Reason[] {
  const reasons: Reason[] = [];

  if (Math.abs(possessionHome - 0.5) >= 0.08) {
    const homeHasMore = possessionHome > 0.5;
    reasons.push({
      factor: 'possession',
      impact: normalizeImpact(possessionHome - 0.5, 0.25),
      note: `O ${homeHasMore ? 'mandante' : 'visitante'} dominou a posse de bola (${Math.round(
        (homeHasMore ? possessionHome : 1 - possessionHome) * 100,
      )}%), controlando o ritmo da partida.`,
    });
  }

  const homeAttackEdge = homeStrength.attack - awayStrength.defense;
  const awayAttackEdge = awayStrength.attack - homeStrength.defense;
  const midfieldEdge = homeStrength.midfield - awayStrength.midfield;

  const edges = [
    { key: 'home_attack_vs_away_defense', value: homeAttackEdge },
    { key: 'away_attack_vs_home_defense', value: -awayAttackEdge },
    { key: 'midfield', value: midfieldEdge },
  ];
  const biggest = edges.reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a));

  if (Math.abs(biggest.value) >= 5) {
    if (biggest.key === 'home_attack_vs_away_defense') {
      reasons.push({
        factor: 'attack_vs_defense',
        impact: normalizeImpact(biggest.value, 30),
        note: 'O ataque do mandante foi superior à defesa visitante, criando as chances mais perigosas.',
      });
    } else if (biggest.key === 'away_attack_vs_home_defense') {
      reasons.push({
        factor: 'attack_vs_defense',
        impact: normalizeImpact(biggest.value, 30),
        note: 'O ataque do visitante foi superior à defesa do mandante, criando as chances mais perigosas.',
      });
    } else {
      reasons.push({
        factor: 'midfield',
        impact: normalizeImpact(biggest.value, 30),
        note: `O meio-campo ${midfieldEdge > 0 ? 'do mandante' : 'do visitante'} teve mais controle sobre a criação de jogadas.`,
      });
    }
  }

  if (away.tactics.style === 'counter' && COUNTER_EXPOSED_STYLES.includes(home.tactics.style) && awayGoals > 0) {
    reasons.push({
      factor: 'style_mismatch',
      impact: -0.2,
      note: 'O visitante explorou os contra-ataques diante da postura ofensiva do mandante.',
    });
  }
  if (home.tactics.style === 'counter' && COUNTER_EXPOSED_STYLES.includes(away.tactics.style) && homeGoals > 0) {
    reasons.push({
      factor: 'style_mismatch',
      impact: 0.2,
      note: 'O mandante explorou os contra-ataques diante da postura ofensiva do visitante.',
    });
  }

  if (reasons.length === 0) {
    reasons.push({
      factor: 'balanced_match',
      impact: 0,
      note: 'Jogo equilibrado entre as duas equipes, sem um fator claramente decisivo.',
    });
  }

  return reasons;
}

/**
 * Motor de partida: probabilístico, determinístico por seed, explicável.
 * Ver plano §7 — modelo de força por setor, geração de chances e trace de explicação.
 */
export function simulateMatch(home: MatchTeamInput, away: MatchTeamInput, seed: number): MatchResult {
  assertValidLineup(home);
  assertValidLineup(away);

  const rng = mulberry32(seed);

  const homeStrength = computeSectorStrengths(home.players, true);
  const awayStrength = computeSectorStrengths(away.players, false);

  const possessionHome = clamp(
    compressRatio(homeStrength.midfield / (homeStrength.midfield + awayStrength.midfield || 1)),
    0.3,
    0.7,
  );
  const possessionAway = 1 - possessionHome;

  const homeStyleMod = STYLE_MODIFIERS[home.tactics.style];
  const awayStyleMod = STYLE_MODIFIERS[away.tactics.style];

  const homeChanceCount = rollChanceCount(rng, {
    attack: homeStrength.attack,
    defense: awayStrength.defense,
    ownStyleMod: homeStyleMod,
    oppStyleMod: awayStyleMod,
    possession: possessionHome,
  });
  const awayChanceCount = rollChanceCount(rng, {
    attack: awayStrength.attack,
    defense: homeStrength.defense,
    ownStyleMod: awayStyleMod,
    oppStyleMod: homeStyleMod,
    possession: possessionAway,
  });

  const events: MatchEvent[] = [];
  const goalsByPlayer = new Map<string, number>();
  let homeGoals = 0;
  let awayGoals = 0;
  let homeShotsOnTarget = 0;
  let awayShotsOnTarget = 0;

  for (let i = 0; i < homeChanceCount; i++) {
    const resolved = resolveChance(rng, homeStrength.attack, awayStrength.defense, homeStyleMod, home.players);
    if (resolved.isOnTarget) homeShotsOnTarget++;
    if (resolved.isGoal && resolved.scorer) {
      homeGoals++;
      goalsByPlayer.set(resolved.scorer.id, (goalsByPlayer.get(resolved.scorer.id) ?? 0) + 1);
      events.push({ minute: resolved.minute, type: 'goal', teamId: home.clubId, playerId: resolved.scorer.id });
    }
  }

  for (let i = 0; i < awayChanceCount; i++) {
    const resolved = resolveChance(rng, awayStrength.attack, homeStrength.defense, awayStyleMod, away.players);
    if (resolved.isOnTarget) awayShotsOnTarget++;
    if (resolved.isGoal && resolved.scorer) {
      awayGoals++;
      goalsByPlayer.set(resolved.scorer.id, (goalsByPlayer.get(resolved.scorer.id) ?? 0) + 1);
      events.push({ minute: resolved.minute, type: 'goal', teamId: away.clubId, playerId: resolved.scorer.id });
    }
  }

  events.sort((a, b) => a.minute - b.minute);

  const manOfTheMatch = pickManOfTheMatch(home, away, goalsByPlayer, homeGoals, awayGoals);

  const explanation = buildExplanation(homeStrength, awayStrength, possessionHome, home, away, homeGoals, awayGoals);

  return {
    homeTeamId: home.clubId,
    awayTeamId: away.clubId,
    homeGoals,
    awayGoals,
    events,
    stats: {
      possession: { home: Math.round(possessionHome * 100), away: Math.round(possessionAway * 100) },
      shots: { home: homeChanceCount, away: awayChanceCount },
      shotsOnTarget: { home: homeShotsOnTarget, away: awayShotsOnTarget },
    },
    manOfTheMatch: manOfTheMatch.id,
    explanation,
  };
}

