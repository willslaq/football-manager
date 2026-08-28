// Motor de faltas: quem comete, quem sofre, onde no campo e qual a severidade do cartão.
// Puro e determinístico (mesmo espírito de tactics.ts/strength.ts) — o loop minuto a minuto
// em match.ts é quem decide SE uma falta acontece naquele minuto e orquestra os efeitos
// (eventos, segundo amarelo, expulsão) usando as funções daqui.

import { type RNG, weighted } from '../rng';
import type { Player, PlayerId, Position } from '../types/player';
import type { TacticStyle } from '../types/tactics';
import {
  CAUTIONED_FOUL_WEIGHT_MULTIPLIER,
  FOUL_CARD_AGGRESSION_MAX_FACTOR,
  FOUL_CARD_AGGRESSION_MIN_FACTOR,
  FOUL_CARD_BASE,
  FOUL_TACKLING_MITIGATION,
  OWN_BOX_RED_CARD_MULTIPLIER,
  POSITION_FOUL_VICTIM_WEIGHT,
  POSITION_FOUL_WEIGHT,
  POSITION_FOUL_ZONE,
  STYLE_FOUL_MODIFIERS,
} from './config';

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function slotOf(player: Player, slotPositionByPlayerId?: Record<PlayerId, Position>): Position {
  return slotPositionByPlayerId?.[player.id] ?? player.position;
}

/**
 * Índice individual de propensão a cometer falta: agressão empurra pra cima, um bom
 * carrinho (tackling) mitiga — jogador agressivo mas tecnicamente ruim no desarme é quem
 * mais comete falta; um zagueiro agressivo mas de carrinho limpo comete menos do que a
 * agressão sozinha sugeriria.
 */
export function foulTendency(player: Player): number {
  const { aggression, tackling } = player.attributes;
  return clamp01((aggression / 100) * (1 - (tackling / 100) * FOUL_TACKLING_MITIGATION));
}

function foulerWeight(player: Player, slotPosition: Position): number {
  return foulTendency(player) * POSITION_FOUL_WEIGHT[slotPosition];
}

/** "Jogador médio" de referência (agressão 50, tackling 50, peso de posição médio ~0.85) — normaliza o perfil do time em torno de 1.0. */
const NEUTRAL_FOULER_WEIGHT = 0.5 * (1 - 0.5 * FOUL_TACKLING_MITIGATION) * 0.85;

/** Perfil agregado de faltas do time (0..~2, centrado em 1.0) — usado pra projetar o volume da partida inteira. */
export function teamFoulProfile(players: Player[], slotPositionByPlayerId?: Record<PlayerId, Position>): number {
  const outfield = players.filter((p) => slotOf(p, slotPositionByPlayerId) !== 'GOL');
  if (outfield.length === 0) return 1;
  const avgWeight =
    outfield.reduce((sum, p) => sum + foulerWeight(p, slotOf(p, slotPositionByPlayerId)), 0) / outfield.length;
  return avgWeight / NEUTRAL_FOULER_WEIGHT;
}

export function styleFoulModifier(style: TacticStyle): number {
  return STYLE_FOUL_MODIFIERS[style];
}

/**
 * Sorteia quem comete a falta dentre os jogadores em campo (goleiro fora do sorteio).
 * `cardedPlayers` (jogadores já advertidos nesta partida) reduz o peso de quem já levou
 * amarelo — segura o carrinho depois de advertido — senão o mesmo jogador de peso alto
 * (zagueiro/volante) acumula faltas demais e o segundo amarelo vira comum demais.
 */
export function pickFouler(
  rng: RNG,
  players: Player[],
  slotPositionByPlayerId?: Record<PlayerId, Position>,
  cardedPlayers?: ReadonlyMap<PlayerId, 'yellow'>,
): Player | undefined {
  const pool = players.filter((p) => slotOf(p, slotPositionByPlayerId) !== 'GOL');
  if (pool.length === 0) return undefined;
  const weights = pool.map((p) => {
    const base = foulerWeight(p, slotOf(p, slotPositionByPlayerId)) + 0.01;
    const dampened = cardedPlayers?.get(p.id) === 'yellow' ? base * CAUTIONED_FOUL_WEIGHT_MULTIPLIER : base;
    return [p, dampened] as const;
  });
  return weighted(rng, weights);
}

/** Sorteia quem sofre a falta dentre os jogadores adversários em campo (goleiro fora do sorteio). */
export function pickFouledPlayer(
  rng: RNG,
  opponents: Player[],
  slotPositionByPlayerId?: Record<PlayerId, Position>,
): Player | undefined {
  const pool = opponents.filter((p) => slotOf(p, slotPositionByPlayerId) !== 'GOL');
  if (pool.length === 0) return undefined;
  const weights = pool.map((p) => [p, POSITION_FOUL_VICTIM_WEIGHT[slotOf(p, slotPositionByPlayerId)] + 0.01] as const);
  return weighted(rng, weights);
}

export type FoulZone = 'own_box' | 'danger_zone' | 'midfield';

/** Em que zona do campo (do lado de quem cometeu) a falta acontece, a partir da posição de quem a cometeu. */
export function rollFoulZone(rng: RNG, foulerSlotPosition: Position): FoulZone {
  const weights = POSITION_FOUL_ZONE[foulerSlotPosition];
  return weighted(rng, [
    ['own_box', weights.ownBox] as const,
    ['danger_zone', weights.dangerZone] as const,
    ['midfield', weights.midfield] as const,
  ]);
}

export type CardOutcome = 'none' | 'yellow' | 'red';

/**
 * Severidade do cartão dado que a falta já aconteceu. Não decide segundo amarelo — isso
 * depende de o jogador já estar advertido na partida, algo que só o loop de match.ts sabe.
 *
 * A agressão escala a chance de cartão por um multiplicador limitado (0.6x-1.4x, neutro em
 * 50) em vez de somar direto — uma escala aditiva ingênua faz jogador de agressão alta
 * dominar a probabilidade-base e produz vermelho toda hora, o que não é o que se quer.
 */
export function rollCardSeverity(rng: RNG, fouler: Player, zone: FoulZone): CardOutcome {
  const aggressionFactor =
    FOUL_CARD_AGGRESSION_MIN_FACTOR + (fouler.attributes.aggression / 100) * (FOUL_CARD_AGGRESSION_MAX_FACTOR - FOUL_CARD_AGGRESSION_MIN_FACTOR);
  const zoneRedMultiplier = zone === 'own_box' ? OWN_BOX_RED_CARD_MULTIPLIER : 1;
  const red = clamp01(FOUL_CARD_BASE.red * aggressionFactor * zoneRedMultiplier);
  const yellow = clamp01(FOUL_CARD_BASE.yellow * aggressionFactor);
  const roll = rng();
  if (roll < red) return 'red';
  if (roll < red + yellow) return 'yellow';
  return 'none';
}
