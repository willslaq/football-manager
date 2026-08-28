import { chance, mulberry32, weighted } from '../rng';
import type { ClubId } from '../types/club';
import type { EngineTraceEntry, MatchEvent, MatchResult, Reason } from '../types/match';
import type { Player, PlayerId, Position } from '../types/player';
import { TACTIC_STYLE_LABELS, type TacticalIntensity, type Tactics } from '../types/tactics';
import {
  BASE_CHANCES_PER_TEAM,
  BASE_FOULS_PER_TEAM,
  BASE_FREE_KICK_CONVERSION,
  BASE_GOAL_PROBABILITY,
  BASE_PENALTY_CONVERSION,
  FOUL_PROBABILITY_CAP,
  MAX_FREE_KICK_CONVERSION,
  MAX_GOAL_PROBABILITY,
  MAX_PENALTY_CONVERSION,
  MIN_FREE_KICK_CONVERSION,
  MIN_GOAL_PROBABILITY,
  MIN_PENALTY_CONVERSION,
  ON_TARGET_MISS_PROBABILITY,
  POSSESSION_CHANCE_PROBABILITY_CAP,
  POSSESSION_HOME_BOOST,
  POSSESSION_MINUTE_CLAMP,
  POSSESSION_SCORELINE_PULL_PER_GOAL,
  POSSESSION_TARGET_CLAMP,
  POSSESSION_WALK_NOISE,
  POSSESSION_WALK_PULL_RATE,
  RATIO_COMPRESSION,
  RED_CARD_SECTOR_PENALTY,
  type StyleModifiers,
} from './config';
import {
  type CardOutcome,
  pickFouledPlayer,
  pickFouler,
  rollCardSeverity,
  rollFoulZone,
  styleFoulModifier,
  teamFoulProfile,
} from './fouls';
import { computeSectorStrengths, positionSector, type SectorStrengths } from './strength';
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
  /** Vaga exata (LD, ZAG, PE...) de cada titular na formação — ver computeSectorStrengths. */
  slotPositionByPlayerId?: Record<PlayerId, Position>;
  /** Cobrador designado de pênalti/falta direta (ver Lineup). Sem escalação manual (CPU), cai no fallback por finalização. */
  penaltyTakerId?: PlayerId;
  freeKickTakerId?: PlayerId;
}

/**
 * Estado mutável de um time durante o loop minuto a minuto: quem ainda está em campo,
 * a força de setor corrente e as taxas por minuto (chance/falta) derivadas dela — tudo
 * recomputado após uma expulsão (ver `sendOff`), já que o resto do módulo trata força e
 * taxas como fixas pra partida inteira.
 */
interface TeamMatchState {
  clubId: ClubId;
  tactics: Tactics;
  isHome: boolean;
  /** Titulares ainda em campo (encolhe a cada expulsão). */
  players: Player[];
  slotPositionByPlayerId?: Record<PlayerId, Position>;
  goalkeeper?: Player;
  penaltyTakerId?: PlayerId;
  freeKickTakerId?: PlayerId;
  strength: SectorStrengths;
  minuteRate: number;
  foulMinuteRate: number;
  /** Jogadores já advertidos nesta partida (pra detectar segundo amarelo). */
  cardedPlayers: Map<PlayerId, 'yellow'>;
  goals: number;
  shots: number;
  shotsOnTarget: number;
  fouls: number;
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
const COHERENCE_NOTE_LOW_THRESHOLD = 0.95;
const COHERENCE_NOTE_HIGH_THRESHOLD = 1.05;

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
  const homeCoherenceEdge = Math.abs(homeCoherence - 1);
  const awayCoherenceEdge = Math.abs(awayCoherence - 1);
  const mostNotableFit =
    homeCoherenceEdge >= awayCoherenceEdge
      ? (['mandante', home.tactics.formation, home.tactics.style, homeCoherence] as const)
      : (['visitante', away.tactics.formation, away.tactics.style, awayCoherence] as const);
  const [side, formation, style, coherence] = mostNotableFit;
  if (coherence <= COHERENCE_NOTE_LOW_THRESHOLD || coherence >= COHERENCE_NOTE_HIGH_THRESHOLD) {
    const isGoodFit = coherence > 1;
    reasons.push({
      factor: 'formation_style_fit',
      impact: side === 'mandante' ? coherence - 1 : 1 - coherence,
      note: isGoodFit
        ? `A formação ${formation} do ${side} combina muito bem com o estilo ${TACTIC_STYLE_LABELS[style]}, potencializando o ataque.`
        : `A formação ${formation} do ${side} não combina bem com o estilo ${TACTIC_STYLE_LABELS[style]}, tirando eficiência do ataque.`,
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

  // Goleiro titular de cada time — fixo a partida inteira (sem modelo de substituição ainda),
  // usado só pra creditar a defesa (shot_saved) ao goleiro certo.
  const homeGoalkeeper = home.players.find((p) => p.position === 'GOL');
  const awayGoalkeeper = away.players.find((p) => p.position === 'GOL');

  const homeStrength = applyFormationShape(
    computeSectorStrengths(home.players, true, home.slotPositionByPlayerId),
    home.tactics.formation,
    tacticalIntensity,
  );
  const awayStrength = applyFormationShape(
    computeSectorStrengths(away.players, false, away.slotPositionByPlayerId),
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

  // Estado mutável por time (jogadores em campo, força de setor, taxas por minuto) — encolhe e
  // se recalcula a cada expulsão (ver sendOff/recomputeRates logo abaixo). home/awayStrength
  // acima ficam intactos como o "retrato" pré-jogo, usado na explicação final do resultado.
  const homeState: TeamMatchState = {
    clubId: home.clubId,
    tactics: home.tactics,
    isHome: true,
    players: [...home.players],
    slotPositionByPlayerId: home.slotPositionByPlayerId,
    goalkeeper: homeGoalkeeper,
    penaltyTakerId: home.penaltyTakerId,
    freeKickTakerId: home.freeKickTakerId,
    strength: homeStrength,
    minuteRate: homeExpectedChances / MATCH_MINUTES,
    foulMinuteRate:
      (BASE_FOULS_PER_TEAM * teamFoulProfile(home.players, home.slotPositionByPlayerId) * styleFoulModifier(home.tactics.style)) /
      MATCH_MINUTES,
    cardedPlayers: new Map(),
    goals: 0,
    shots: 0,
    shotsOnTarget: 0,
    fouls: 0,
  };
  const awayState: TeamMatchState = {
    clubId: away.clubId,
    tactics: away.tactics,
    isHome: false,
    players: [...away.players],
    slotPositionByPlayerId: away.slotPositionByPlayerId,
    goalkeeper: awayGoalkeeper,
    penaltyTakerId: away.penaltyTakerId,
    freeKickTakerId: away.freeKickTakerId,
    strength: awayStrength,
    minuteRate: awayExpectedChances / MATCH_MINUTES,
    foulMinuteRate:
      (BASE_FOULS_PER_TEAM * teamFoulProfile(away.players, away.slotPositionByPlayerId) * styleFoulModifier(away.tactics.style)) /
      MATCH_MINUTES,
    cardedPlayers: new Map(),
    goals: 0,
    shots: 0,
    shotsOnTarget: 0,
    fouls: 0,
  };

  /** Recomputa as taxas por minuto (chance e falta) dos dois times a partir da força/elenco corrente — chamado no setup e de novo a cada expulsão, já que a força de um lado também muda a taxa de chance do outro (ataque vs. defesa). */
  function recomputeRates(): void {
    const homeExpected = expectedChances({
      attack: homeState.strength.attack,
      defense: awayState.strength.defense,
      ownStyleMod: homeStyleMod,
      oppStyleMod: awayStyleMod,
      possession: possessionTargetHome,
    });
    const awayExpected = expectedChances({
      attack: awayState.strength.attack,
      defense: homeState.strength.defense,
      ownStyleMod: awayStyleMod,
      oppStyleMod: homeStyleMod,
      possession: 1 - possessionTargetHome,
    });
    homeState.minuteRate = homeExpected / MATCH_MINUTES;
    awayState.minuteRate = awayExpected / MATCH_MINUTES;
    homeState.foulMinuteRate =
      (BASE_FOULS_PER_TEAM * teamFoulProfile(homeState.players, homeState.slotPositionByPlayerId) * styleFoulModifier(homeState.tactics.style)) /
      MATCH_MINUTES;
    awayState.foulMinuteRate =
      (BASE_FOULS_PER_TEAM * teamFoulProfile(awayState.players, awayState.slotPositionByPlayerId) * styleFoulModifier(awayState.tactics.style)) /
      MATCH_MINUTES;
  }

  /**
   * Expulsa um jogador: tira do time em campo, recalcula a força de setor (menos um corpo, e
   * ainda uma penalidade de solidez no setor dele — RED_CARD_SECTOR_PENALTY, mesmo raciocínio de
   * SHAPE_WEIGHT em tactics.ts) e propaga o efeito nas taxas por minuto dos dois lados pro resto
   * da partida. Goleiro expulso é caso especial fora do escopo v1 (ver RED_CARD_SECTOR_PENALTY).
   */
  function sendOff(state: TeamMatchState, player: Player): void {
    state.players = state.players.filter((p) => p.id !== player.id);
    const slot = state.slotPositionByPlayerId?.[player.id] ?? player.position;
    const sector = positionSector(slot);
    const recomputed = applyFormationShape(
      computeSectorStrengths(state.players, state.isHome, state.slotPositionByPlayerId),
      state.tactics.formation,
      tacticalIntensity,
    );
    if (sector !== 'goalkeeper') {
      recomputed[sector] *= RED_CARD_SECTOR_PENALTY[sector];
    }
    state.strength = recomputed;
    recomputeRates();
  }

  /** Cobrança de pênalti ou falta direta gerada por uma falta na área/zona de perigo — mesmo formato de evento de um chute normal, só marcando `setPiece`. */
  function resolveSetPiece(
    minute: number,
    attackingState: TeamMatchState,
    defendingState: TeamMatchState,
    kind: 'penalty' | 'free_kick',
  ): void {
    const takerId = kind === 'penalty' ? attackingState.penaltyTakerId : attackingState.freeKickTakerId;
    const explicitTaker = takerId ? attackingState.players.find((p) => p.id === takerId) : undefined;
    const taker = explicitTaker ?? pickShooter(rng, attackingState.players);
    if (!taker) return;

    const goalkeeper = defendingState.goalkeeper;
    const takerSkill =
      kind === 'penalty' ? taker.attributes.finishing : (taker.attributes.finishing + taker.attributes.passing) / 2;
    const goalkeeperSkill = goalkeeper?.attributes.reflexes ?? 50;
    const base = kind === 'penalty' ? BASE_PENALTY_CONVERSION : BASE_FREE_KICK_CONVERSION;
    const min = kind === 'penalty' ? MIN_PENALTY_CONVERSION : MIN_FREE_KICK_CONVERSION;
    const max = kind === 'penalty' ? MAX_PENALTY_CONVERSION : MAX_FREE_KICK_CONVERSION;
    const skillScale = kind === 'penalty' ? 0.003 : 0.0015;
    const probability = clamp(base + (takerSkill - goalkeeperSkill) * skillScale, min, max);

    const isGoal = chance(rng, probability);
    const isOnTarget = isGoal || chance(rng, kind === 'penalty' ? 0.7 : 0.35);

    attackingState.shots++;
    if (isOnTarget) attackingState.shotsOnTarget++;

    if (isGoal) {
      attackingState.goals++;
      goalsByPlayer.set(taker.id, (goalsByPlayer.get(taker.id) ?? 0) + 1);
      events.push({ minute, type: 'goal', teamId: attackingState.clubId, playerId: taker.id, setPiece: kind });
    } else {
      events.push({
        minute,
        type: isOnTarget ? 'shot_saved' : 'shot_missed',
        teamId: attackingState.clubId,
        playerId: taker.id,
        goalkeeperId: isOnTarget ? goalkeeper?.id : undefined,
        setPiece: kind,
      });
    }
  }

  /**
   * Resolve uma falta cometida por `foulingState` contra `fouledState`: sorteia quem comete,
   * onde no campo e a severidade do cartão (incluindo segundo amarelo, que vira expulsão), e
   * dispara pênalti/falta direta quando a zona pede. `foulingState`/`fouledState` são o time que
   * defende (comete) e o que ataca (sofre) naquele lance — não necessariamente home/away nessa ordem.
   */
  function resolveFoul(minute: number, foulingState: TeamMatchState, fouledState: TeamMatchState): void {
    const fouler = pickFouler(rng, foulingState.players, foulingState.slotPositionByPlayerId, foulingState.cardedPlayers);
    if (!fouler) return;
    foulingState.fouls++;

    const foulerSlot = foulingState.slotPositionByPlayerId?.[fouler.id] ?? fouler.position;
    const zone = rollFoulZone(rng, foulerSlot);
    const victim = pickFouledPlayer(rng, fouledState.players, fouledState.slotPositionByPlayerId);
    const severity = rollCardSeverity(rng, fouler, zone);

    let card: CardOutcome | 'second_yellow' = severity;
    if (severity === 'yellow' && foulingState.cardedPlayers.get(fouler.id) === 'yellow') {
      card = 'second_yellow';
    }

    onChance?.({ kind: 'foul', minute, teamId: foulingState.clubId, foulerId: fouler.id, victimId: victim?.id, zone, card });

    if (card === 'yellow') {
      foulingState.cardedPlayers.set(fouler.id, 'yellow');
      events.push({ minute, type: 'yellow_card', teamId: foulingState.clubId, playerId: fouler.id });
    } else if (card === 'second_yellow') {
      events.push({ minute, type: 'yellow_card', teamId: foulingState.clubId, playerId: fouler.id });
      events.push({ minute, type: 'red_card', teamId: foulingState.clubId, playerId: fouler.id });
      sendOff(foulingState, fouler);
    } else if (card === 'red') {
      events.push({ minute, type: 'red_card', teamId: foulingState.clubId, playerId: fouler.id });
      sendOff(foulingState, fouler);
    }

    if (zone === 'own_box') {
      resolveSetPiece(minute, fouledState, foulingState, 'penalty');
    } else if (zone === 'danger_zone') {
      resolveSetPiece(minute, fouledState, foulingState, 'free_kick');
    }
  }

  // Passeio aleatório da posse, minuto a minuto: converge pro alvo tático (ajustado pelo placar
  // corrente) com ruído, e cada minuto sorteia (Bernoulli) se aquele time cria uma chance ali —
  // com probabilidade escalada pela posse do minuto, o ritmo de chances fica preso à posse ao vivo.
  let currentPossessionHome = possessionTargetHome;
  let possessionSum = 0;

  for (let minute = 1; minute <= MATCH_MINUTES; minute++) {
    const drift = scorelineDrift(homeState.goals, awayState.goals, minute);
    const minuteTarget = clamp(possessionTargetHome + drift, POSSESSION_MINUTE_CLAMP[0], POSSESSION_MINUTE_CLAMP[1]);
    currentPossessionHome = clamp(
      currentPossessionHome + (minuteTarget - currentPossessionHome) * POSSESSION_WALK_PULL_RATE + (rng() - 0.5) * POSSESSION_WALK_NOISE,
      POSSESSION_MINUTE_CLAMP[0],
      POSSESSION_MINUTE_CLAMP[1],
    );
    possessionSum += currentPossessionHome;
    onChance?.({ kind: 'possession', minute, possessionHome: currentPossessionHome });

    const homeChanceProbability = clamp(
      homeState.minuteRate * (currentPossessionHome / possessionTargetHome),
      0,
      POSSESSION_CHANCE_PROBABILITY_CAP,
    );
    if (chance(rng, homeChanceProbability)) {
      homeState.shots++;
      const resolved = resolveChanceOutcome(rng, homeState.strength.attack, awayState.strength.defense, homeStyleMod, homeState.players);
      onChance?.({
        kind: 'chance',
        minute,
        teamId: home.clubId,
        shooterId: resolved.shooter?.id,
        attackStrength: homeState.strength.attack,
        defenseStrength: awayState.strength.defense,
        quality: resolved.quality,
        goalProbability: resolved.goalProbability,
        isOnTarget: resolved.isOnTarget,
        isGoal: resolved.isGoal,
      });
      if (resolved.isOnTarget) homeState.shotsOnTarget++;
      if (resolved.shooter) {
        if (resolved.isGoal) {
          homeState.goals++;
          goalsByPlayer.set(resolved.shooter.id, (goalsByPlayer.get(resolved.shooter.id) ?? 0) + 1);
          events.push({ minute, type: 'goal', teamId: home.clubId, playerId: resolved.shooter.id });
        } else {
          events.push({
            minute,
            type: resolved.isOnTarget ? 'shot_saved' : 'shot_missed',
            teamId: home.clubId,
            playerId: resolved.shooter.id,
            goalkeeperId: resolved.isOnTarget ? awayState.goalkeeper?.id : undefined,
          });
        }
      }
    }

    const awayChanceProbability = clamp(
      awayState.minuteRate * ((1 - currentPossessionHome) / (1 - possessionTargetHome)),
      0,
      POSSESSION_CHANCE_PROBABILITY_CAP,
    );
    if (chance(rng, awayChanceProbability)) {
      awayState.shots++;
      const resolved = resolveChanceOutcome(rng, awayState.strength.attack, homeState.strength.defense, awayStyleMod, awayState.players);
      onChance?.({
        kind: 'chance',
        minute,
        teamId: away.clubId,
        shooterId: resolved.shooter?.id,
        attackStrength: awayState.strength.attack,
        defenseStrength: homeState.strength.defense,
        quality: resolved.quality,
        goalProbability: resolved.goalProbability,
        isOnTarget: resolved.isOnTarget,
        isGoal: resolved.isGoal,
      });
      if (resolved.isOnTarget) awayState.shotsOnTarget++;
      if (resolved.shooter) {
        if (resolved.isGoal) {
          awayState.goals++;
          goalsByPlayer.set(resolved.shooter.id, (goalsByPlayer.get(resolved.shooter.id) ?? 0) + 1);
          events.push({ minute, type: 'goal', teamId: away.clubId, playerId: resolved.shooter.id });
        } else {
          events.push({
            minute,
            type: resolved.isOnTarget ? 'shot_saved' : 'shot_missed',
            teamId: away.clubId,
            playerId: resolved.shooter.id,
            goalkeeperId: resolved.isOnTarget ? homeState.goalkeeper?.id : undefined,
          });
        }
      }
    }

    // Faltas: quem defende naquele instante é quem comete — o mandante defende quando o
    // visitante tem mais bola no minuto (e vice-versa), por isso a mesma normalização por
    // posse usada acima pro lado que ataca, só que invertida.
    const homeFoulProbability = clamp(
      homeState.foulMinuteRate * ((1 - currentPossessionHome) / (1 - possessionTargetHome)),
      0,
      FOUL_PROBABILITY_CAP,
    );
    if (chance(rng, homeFoulProbability)) {
      resolveFoul(minute, homeState, awayState);
    }

    const awayFoulProbability = clamp(
      awayState.foulMinuteRate * (currentPossessionHome / possessionTargetHome),
      0,
      FOUL_PROBABILITY_CAP,
    );
    if (chance(rng, awayFoulProbability)) {
      resolveFoul(minute, awayState, homeState);
    }
  }

  const possessionHome = possessionSum / MATCH_MINUTES;

  events.sort((a, b) => a.minute - b.minute);

  const manOfTheMatch = pickManOfTheMatch(home, away, goalsByPlayer, homeState.goals, awayState.goals);

  const explanation = buildExplanation(
    homeStrength,
    awayStrength,
    possessionHome,
    home,
    away,
    homeState.goals,
    awayState.goals,
    tacticalIntensity,
  );

  const homeRedCards = events.filter((e) => e.type === 'red_card' && e.teamId === home.clubId).length;
  const awayRedCards = events.filter((e) => e.type === 'red_card' && e.teamId === away.clubId).length;
  if (homeRedCards !== awayRedCards) {
    const disadvantaged = homeRedCards > awayRedCards ? 'mandante' : 'visitante';
    explanation.push({
      factor: 'red_card',
      impact: homeRedCards > awayRedCards ? -0.25 : 0.25,
      note: `O ${disadvantaged} teve um jogador expulso e passou parte da partida em desvantagem numérica.`,
    });
  }

  return {
    homeTeamId: home.clubId,
    awayTeamId: away.clubId,
    homeGoals: homeState.goals,
    awayGoals: awayState.goals,
    events,
    stats: {
      possession: { home: Math.round(possessionHome * 100), away: Math.round((1 - possessionHome) * 100) },
      shots: { home: homeState.shots, away: awayState.shots },
      shotsOnTarget: { home: homeState.shotsOnTarget, away: awayState.shotsOnTarget },
      fouls: { home: homeState.fouls, away: awayState.fouls },
    },
    manOfTheMatch: manOfTheMatch.id,
    explanation,
  };
}

