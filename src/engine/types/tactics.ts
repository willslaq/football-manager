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

/** Rótulo em pt-BR de cada estilo — usado tanto na UI (seletor) quanto nas explicações do motor. */
export const TACTIC_STYLE_LABELS: Record<TacticStyle, string> = {
  offensive: 'Ofensivo',
  balanced: 'Equilibrado',
  defensive: 'Defensivo',
  counter: 'Contra-ataque',
  possession: 'Posse de bola',
  direct: 'Direto',
  pressing: 'Pressão',
};

/**
 * Quanto o motor leva formação/estilo em conta na simulação (RF tático):
 * 'subtle' = ajuste leve, qualidade dos jogadores ainda domina o resultado;
 * 'strong' = tática pesa mais, podendo decidir jogos parelhos.
 * Configuração por save (CareerState.settings), não por partida.
 */
export const TACTICAL_INTENSITIES = ['subtle', 'strong'] as const;

export type TacticalIntensity = (typeof TACTICAL_INTENSITIES)[number];

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
