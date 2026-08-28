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

/** Todas as constantes do algoritmo de posse dinâmica (ver simulation/match.ts). */

/**
 * Viés "de bolso" de cada estilo pra manter a bola, além do que a qualidade de elenco
 * já explica — ex.: um time de posse tenta ativamente manter a bola mesmo contra um
 * meio-campo mais forte; um time de contra-ataque abre mão da bola de propósito.
 */
export const POSSESSION_STYLE_AFFINITY: Record<TacticStyle, number> = {
  possession: 0.08,
  pressing: 0.03,
  offensive: 0.01,
  balanced: 0,
  direct: -0.05,
  defensive: -0.04,
  counter: -0.06,
};

/** Alvo tático da posse (média da partida) fica dentro dessa faixa — igual ao clamp de antes. */
export const POSSESSION_TARGET_CLAMP: [number, number] = [0.3, 0.7];
/** Cada minuto pode se afastar mais do alvo do que a média da partida — dá vida ao passeio. */
export const POSSESSION_MINUTE_CLAMP: [number, number] = [0.18, 0.82];
/** Fração da distância até o alvo do minuto que a posse recupera a cada minuto. */
export const POSSESSION_WALK_PULL_RATE = 0.18;
/** Amplitude do ruído aleatório somado a cada minuto (passeio, não é um degrau reto até o alvo). */
export const POSSESSION_WALK_NOISE = 0.05;
/** Empurrão de posse por gol de diferença no placar, no minuto 90 (cresce ao longo do jogo). */
export const POSSESSION_SCORELINE_PULL_PER_GOAL = 0.02;
/** Viés de posse por meio-campista a mais/menos que o 4-4-2 (baseline), por causa da forma da formação. */
export const POSSESSION_MIDFIELD_SHAPE_WEIGHT = 0.015;
/** Teto de segurança pra probabilidade de chance num único minuto (nunca deveria ser atingido na prática). */
export const POSSESSION_CHANCE_PROBABILITY_CAP = 0.9;
/**
 * Leve empurrão de posse pro mandante, independente do HOME_ADVANTAGE (que só afeta a
 * qualidade das notas de setor). Representa fatores "sociais" do mando de campo
 * (torcida, familiaridade com o gramado). Propositalmente uma constante simples por
 * ora — candidato natural a virar função de apoio do clube/público (reputação,
 * tamanho de estádio/público presente) numa evolução futura da mecânica.
 */
export const POSSESSION_HOME_BOOST = 0.02;
