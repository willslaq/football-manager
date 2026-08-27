import type { TacticStyle } from '../types/tactics';

/** Todos os pesos/constantes de balanceamento do motor de partida vivem aqui. */

/** Multiplicador aplicado às três notas de setor do time mandante. */
export const HOME_ADVANTAGE = 1.06;

/**
 * Fator de compressão (0-1) aplicado a toda razão de força centrada em 0.5
 * (ataque vs defesa, posse) antes de virar volume/qualidade de chances.
 * Sem isso, o mesmo gap de força é aplicado duas vezes (volume E qualidade
 * de chance), o que eleva o resultado a um expoente e torna partidas entre
 * times muito desiguais quase determinísticas — o que o futebol real não é.
 * 1.0 = sem compressão; menor = jogos mais equilibrados.
 */
export const RATIO_COMPRESSION = 0.6;

/** Chances "claras" médias criadas por um time num jogo equilibrado. */
export const BASE_CHANCES_PER_TEAM = 6;

/** Probabilidade de gol por chance, antes de modulação por qualidade. */
export const BASE_GOAL_PROBABILITY = 0.32;
export const MIN_GOAL_PROBABILITY = 0.05;
export const MAX_GOAL_PROBABILITY = 0.75;

/** Fração de chances não convertidas em gol que ainda vão na direção do gol (defesa do goleiro, não erro). */
export const ON_TARGET_MISS_PROBABILITY = 0.45;

export interface StyleModifiers {
  /** Multiplica o volume de chances que o próprio time cria. */
  attackVolume: number;
  /** Multiplica o volume de chances que o time concede ao adversário. */
  concedeVolume: number;
  /** Multiplica a probabilidade de conversão de cada chance criada. */
  qualityMultiplier: number;
}

export const STYLE_MODIFIERS: Record<TacticStyle, StyleModifiers> = {
  offensive: { attackVolume: 1.25, concedeVolume: 1.2, qualityMultiplier: 0.95 },
  balanced: { attackVolume: 1.0, concedeVolume: 1.0, qualityMultiplier: 1.0 },
  defensive: { attackVolume: 0.8, concedeVolume: 0.7, qualityMultiplier: 1.0 },
  counter: { attackVolume: 0.85, concedeVolume: 0.9, qualityMultiplier: 1.3 },
  possession: { attackVolume: 1.05, concedeVolume: 0.85, qualityMultiplier: 1.0 },
  direct: { attackVolume: 1.1, concedeVolume: 1.05, qualityMultiplier: 0.9 },
  pressing: { attackVolume: 1.15, concedeVolume: 1.15, qualityMultiplier: 1.0 },
};
