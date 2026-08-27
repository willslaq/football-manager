import type { PlayerId } from './player';

export const FORMATIONS = [
  '4-4-2',
  '4-3-3',
  '4-2-3-1',
  '3-5-2',
  '5-3-2',
  '4-5-1',
  '3-4-3',
] as const;

export type Formation = (typeof FORMATIONS)[number];

export const TACTIC_STYLES = [
  'offensive',
  'balanced',
  'defensive',
  'counter',
  'possession',
  'direct',
  'pressing',
] as const;

export type TacticStyle = (typeof TACTIC_STYLES)[number];

export interface Tactics {
  formation: Formation;
  style: TacticStyle;
}

export interface Lineup {
  /** Exatamente 11 jogadores. */
  starters: PlayerId[];
  formation: Formation;
  captain: PlayerId;
  penaltyTaker: PlayerId;
  freeKickTaker: PlayerId;
}
