import { chance, mulberry32, weighted } from '../rng';
import type { ClubId } from '../types/club';
import type { EngineTraceEntry, MatchEvent, MatchResult, Reason } from '../types/match';
import type { Player } from '../types/player';
import { TACTIC_STYLE_LABELS, type TacticalIntensity, type Tactics } from '../types/tactics';
import {
  BASE_CHANCES_PER_TEAM,
  BASE_GOAL_PROBABILITY,
  MAX_GOAL_PROBABILITY,
  MIN_GOAL_PROBABILITY,
  ON_TARGET_MISS_PROBABILITY,
  POSSESSION_CHANCE_PROBABILITY_CAP,
  POSSESSION_HOME_BOOST,
  POSSESSION_MINUTE_CLAMP,
  POSSESSION_SCORELINE_PULL_PER_GOAL,
  POSSESSION_TARGET_CLAMP,
  POSSESSION_WALK_NOISE,
  POSSESSION_WALK_PULL_RATE,
  RATIO_COMPRESSION,
  type StyleModifiers,
} from './config';
import { computeSectorStrengths, type SectorStrengths } from './strength';
import {
  applyFormationShape,
  effectiveStyleModifiers,
  formationStyleCoherence,
  possessionBias,
  styleMatchupModifier,
} from './tactics';

/** Duração da partida em minutos — o motor agora simula minuto a minuto (posse dinâmica). */
const MATCH_MINUTES = 90;

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

interface ResolvedChance {
  isGoal: boolean;
  isOnTarget: boolean;
  shooter?: Player;
  quality: number;
  goalProbability: number;
}

function pickShooter(rng: () => number, attackers: Player[]): Player | undefined {
  const pool = attackers.filter((p) => p.position !== 'GOL');
  if (pool.length === 0) return undefined;
  const weights = pool.map((p) => [p, p.attributes.finishing + p.attributes.heading * 0.3 + 1] as const);
  return weighted(rng, weights);
}

/** Resolve o desfecho de uma chance já decidida pelo loop minuto a minuto (o minuto vem de fora). */
function resolveChanceOutcome(
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
  const shooter = pickShooter(rng, attackers);
  return { isGoal, isOnTarget, shooter, quality, goalProbability };
}

/** Alvo de posse "de bolso" da partida inteira — passeio minuto a minuto converge pra isso. */
function possessionTarget(
  homeMidfield: number,
  awayMidfield: number,
  home: MatchTeamInput,
  away: MatchTeamInput,
  intensity: TacticalIntensity,
): number {
  const base = compressRatio(homeMidfield / (homeMidfield + awayMidfield || 1));
  const bias =
    possessionBias(home.tactics.formation, home.tactics.style, intensity) -
    possessionBias(away.tactics.formation, away.tactics.style, intensity);
  return clamp(base + bias + POSSESSION_HOME_BOOST, POSSESSION_TARGET_CLAMP[0], POSSESSION_TARGET_CLAMP[1]);
}

/** Quanto o placar corrente empurra a posse pro time atrás (cresce ao longo da partida). */
function scorelineDrift(homeGoals: number, awayGoals: number, minute: number): number {
  const goalDiff = clamp(awayGoals - homeGoals, -2, 2);
  return goalDiff * POSSESSION_SCORELINE_PULL_PER_GOAL * (minute / MATCH_MINUTES);
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

const MATCHUP_NOTE_THRESHOLD = 0.05;
const COHERENCE_NOTE_THRESHOLD = 0.95;

function buildExplanation(
  homeStrength: SectorStrengths,
  awayStrength: SectorStrengths,
  possessionHome: number,
  home: MatchTeamInput,
  away: MatchTeamInput,
  homeGoals: number,
  awayGoals: number,
  tacticalIntensity: TacticalIntensity,
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

  const homeMatchup = styleMatchupModifier(home.tactics.style, away.tactics.style, tacticalIntensity);
  const awayMatchup = styleMatchupModifier(away.tactics.style, home.tactics.style, tacticalIntensity);
  const homeMatchupEdge = Math.max(Math.abs(homeMatchup.quality - 1), Math.abs(homeMatchup.volume - 1));
  const awayMatchupEdge = Math.max(Math.abs(awayMatchup.quality - 1), Math.abs(awayMatchup.volume - 1));

  if (awayGoals > 0 && awayMatchupEdge >= MATCHUP_NOTE_THRESHOLD && awayMatchupEdge >= homeMatchupEdge) {
    const favorable = awayMatchup.quality > 1 || awayMatchup.volume > 1;
    reasons.push({
      factor: 'style_matchup',
      impact: favorable ? -0.2 : 0.15,
      note: favorable
        ? `O estilo ${TACTIC_STYLE_LABELS[away.tactics.style]} do visitante levou vantagem contra o ${TACTIC_STYLE_LABELS[home.tactics.style]} do mandante.`
        : `O estilo ${TACTIC_STYLE_LABELS[away.tactics.style]} do visitante rendeu menos diante do ${TACTIC_STYLE_LABELS[home.tactics.style]} do mandante.`,
    });
  }
  if (homeGoals > 0 && homeMatchupEdge >= MATCHUP_NOTE_THRESHOLD && homeMatchupEdge >= awayMatchupEdge) {
    const favorable = homeMatchup.quality > 1 || homeMatchup.volume > 1;
    reasons.push({
      factor: 'style_matchup',
      impact: favorable ? 0.2 : -0.15,
      note: favorable
        ? `O estilo ${TACTIC_STYLE_LABELS[home.tactics.style]} do mandante levou vantagem contra o ${TACTIC_STYLE_LABELS[away.tactics.style]} do visitante.`
        : `O estilo ${TACTIC_STYLE_LABELS[home.tactics.style]} do mandante rendeu menos diante do ${TACTIC_STYLE_LABELS[away.tactics.style]} do visitante.`,
    });
  }

  const homeCoherence = formationStyleCoherence(home.tactics.formation, home.tactics.style, tacticalIntensity);
  const awayCoherence = formationStyleCoherence(away.tactics.formation, away.tactics.style, tacticalIntensity);
  if (homeCoherence < COHERENCE_NOTE_THRESHOLD || awayCoherence < COHERENCE_NOTE_THRESHOLD) {
    const [side, formation, style, coherence] =
      homeCoherence <= awayCoherence
        ? (['mandante', home.tactics.formation, home.tactics.style, homeCoherence] as const)
        : (['visitante', away.tactics.formation, away.tactics.style, awayCoherence] as const);
    reasons.push({
      factor: 'formation_style_mismatch',
      impact: side === 'mandante' ? -(1 - coherence) : 1 - coherence,
      note: `A formação ${formation} do ${side} não combina bem com o estilo ${TACTIC_STYLE_LABELS[style]}, tirando eficiência do ataque.`,
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
export function simulateMatch(
  home: MatchTeamInput,
  away: MatchTeamInput,
  seed: number,
  tacticalIntensity: TacticalIntensity = 'subtle',
  onChance?: (entry: EngineTraceEntry) => void,
): MatchResult {
  assertValidLineup(home);
  assertValidLineup(away);

  const rng = mulberry32(seed);

  const homeStrength = applyFormationShape(
    computeSectorStrengths(home.players, true),
    home.tactics.formation,
    tacticalIntensity,
  );
  const awayStrength = applyFormationShape(
    computeSectorStrengths(away.players, false),
    away.tactics.formation,
    tacticalIntensity,
  );

  // Alvo tático da posse (formação + estilo + fator casa) — o passeio minuto a minuto converge pra isso,
  // não é mais um número fixo pra partida inteira.
  const possessionTargetHome = possessionTarget(homeStrength.midfield, awayStrength.midfield, home, away, tacticalIntensity);

  const homeStyleMod = effectiveStyleModifiers(home.tactics.formation, home.tactics.style, away.tactics.style, tacticalIntensity);
  const awayStyleMod = effectiveStyleModifiers(away.tactics.formation, away.tactics.style, home.tactics.style, tacticalIntensity);

  // Volume total de chances esperado pra partida inteira (projeção pré-jogo) — usado só pra derivar a
  // taxa por minuto abaixo; a contagem real emerge do loop minuto a minuto e pode variar bastante.
  const homeExpectedChances = expectedChances({
    attack: homeStrength.attack,
    defense: awayStrength.defense,
    ownStyleMod: homeStyleMod,
    oppStyleMod: awayStyleMod,
    possession: possessionTargetHome,
  });
  const awayExpectedChances = expectedChances({
    attack: awayStrength.attack,
    defense: homeStrength.defense,
    ownStyleMod: awayStyleMod,
    oppStyleMod: homeStyleMod,
    possession: 1 - possessionTargetHome,
  });
  const homeMinuteRate = homeExpectedChances / MATCH_MINUTES;
  const awayMinuteRate = awayExpectedChances / MATCH_MINUTES;

  onChance?.({
    kind: 'setup',
    home: { clubId: home.clubId, attack: homeStrength.attack, defense: homeStrength.defense, midfield: homeStrength.midfield },
    away: { clubId: away.clubId, attack: awayStrength.attack, defense: awayStrength.defense, midfield: awayStrength.midfield },
    possessionHome: possessionTargetHome,
    homeChanceCount: Math.round(homeExpectedChances),
    awayChanceCount: Math.round(awayExpectedChances),
  });

  const events: MatchEvent[] = [];
  const goalsByPlayer = new Map<string, number>();
  let homeGoals = 0;
  let awayGoals = 0;
  let homeShotsOnTarget = 0;
  let awayShotsOnTarget = 0;
  let homeShots = 0;
  let awayShots = 0;

  // Passeio aleatório da posse, minuto a minuto: converge pro alvo tático (ajustado pelo placar
  // corrente) com ruído, e cada minuto sorteia (Bernoulli) se aquele time cria uma chance ali —
  // com probabilidade escalada pela posse do minuto, o ritmo de chances fica preso à posse ao vivo.
  let currentPossessionHome = possessionTargetHome;
  let possessionSum = 0;

  for (let minute = 1; minute <= MATCH_MINUTES; minute++) {
    const drift = scorelineDrift(homeGoals, awayGoals, minute);
    const minuteTarget = clamp(possessionTargetHome + drift, POSSESSION_MINUTE_CLAMP[0], POSSESSION_MINUTE_CLAMP[1]);
    currentPossessionHome = clamp(
      currentPossessionHome + (minuteTarget - currentPossessionHome) * POSSESSION_WALK_PULL_RATE + (rng() - 0.5) * POSSESSION_WALK_NOISE,
      POSSESSION_MINUTE_CLAMP[0],
      POSSESSION_MINUTE_CLAMP[1],
    );
    possessionSum += currentPossessionHome;
    onChance?.({ kind: 'possession', minute, possessionHome: currentPossessionHome });

    const homeChanceProbability = clamp(
      homeMinuteRate * (currentPossessionHome / possessionTargetHome),
      0,
      POSSESSION_CHANCE_PROBABILITY_CAP,
    );
    if (chance(rng, homeChanceProbability)) {
      homeShots++;
      const resolved = resolveChanceOutcome(rng, homeStrength.attack, awayStrength.defense, homeStyleMod, home.players);
      onChance?.({
        kind: 'chance',
        minute,
        teamId: home.clubId,
        shooterId: resolved.shooter?.id,
        attackStrength: homeStrength.attack,
        defenseStrength: awayStrength.defense,
        quality: resolved.quality,
        goalProbability: resolved.goalProbability,
        isOnTarget: resolved.isOnTarget,
        isGoal: resolved.isGoal,
      });
      if (resolved.isOnTarget) homeShotsOnTarget++;
      if (resolved.shooter) {
        if (resolved.isGoal) {
          homeGoals++;
          goalsByPlayer.set(resolved.shooter.id, (goalsByPlayer.get(resolved.shooter.id) ?? 0) + 1);
          events.push({ minute, type: 'goal', teamId: home.clubId, playerId: resolved.shooter.id });
        } else {
          events.push({
            minute,
            type: resolved.isOnTarget ? 'shot_saved' : 'shot_missed',
            teamId: home.clubId,
            playerId: resolved.shooter.id,
          });
        }
      }
    }

    const awayChanceProbability = clamp(
      awayMinuteRate * ((1 - currentPossessionHome) / (1 - possessionTargetHome)),
      0,
      POSSESSION_CHANCE_PROBABILITY_CAP,
    );
    if (chance(rng, awayChanceProbability)) {
      awayShots++;
      const resolved = resolveChanceOutcome(rng, awayStrength.attack, homeStrength.defense, awayStyleMod, away.players);
      onChance?.({
        kind: 'chance',
        minute,
        teamId: away.clubId,
        shooterId: resolved.shooter?.id,
        attackStrength: awayStrength.attack,
        defenseStrength: homeStrength.defense,
        quality: resolved.quality,
        goalProbability: resolved.goalProbability,
        isOnTarget: resolved.isOnTarget,
        isGoal: resolved.isGoal,
      });
      if (resolved.isOnTarget) awayShotsOnTarget++;
      if (resolved.shooter) {
        if (resolved.isGoal) {
          awayGoals++;
          goalsByPlayer.set(resolved.shooter.id, (goalsByPlayer.get(resolved.shooter.id) ?? 0) + 1);
          events.push({ minute, type: 'goal', teamId: away.clubId, playerId: resolved.shooter.id });
        } else {
          events.push({
            minute,
            type: resolved.isOnTarget ? 'shot_saved' : 'shot_missed',
            teamId: away.clubId,
            playerId: resolved.shooter.id,
          });
        }
      }
    }
  }

  const possessionHome = possessionSum / MATCH_MINUTES;

  events.sort((a, b) => a.minute - b.minute);

  const manOfTheMatch = pickManOfTheMatch(home, away, goalsByPlayer, homeGoals, awayGoals);

  const explanation = buildExplanation(
    homeStrength,
    awayStrength,
    possessionHome,
    home,
    away,
    homeGoals,
    awayGoals,
    tacticalIntensity,
  );

  return {
    homeTeamId: home.clubId,
    awayTeamId: away.clubId,
    homeGoals,
    awayGoals,
    events,
    stats: {
      possession: { home: Math.round(possessionHome * 100), away: Math.round((1 - possessionHome) * 100) },
      shots: { home: homeShots, away: awayShots },
      shotsOnTarget: { home: homeShotsOnTarget, away: awayShotsOnTarget },
    },
    manOfTheMatch: manOfTheMatch.id,
    explanation,
  };
}

