import type { Position } from '../types/player';
import type { TacticStyle } from '../types/tactics';
import type { Sector } from './strength';

/** Todos os pesos/constantes de balanceamento do motor de partida vivem aqui. */

/** Multiplicador aplicado às três notas de setor do time mandante. */
export const HOME_ADVANTAGE = 1.06;

/**
 * Ajuste de `Club.morale` (0-100) aplicado ao fim de cada partida da rodada, conforme o
 * resultado — puramente de exibição (ver `Club.morale`), não realimenta a simulação.
 */
export const CLUB_MORALE_WIN_DELTA = 4;
export const CLUB_MORALE_DRAW_DELTA = 0;
export const CLUB_MORALE_LOSS_DELTA = -4;

/**
 * Cortes de posição final usados tanto pela tabela (zonas de classificação/rebaixamento,
 * `ui/utils.ts`) quanto pelo resumo de fim de temporada (`seasonLifecycle.ts`) — mesma fonte
 * pros dois lados não divergirem. 20 times: 1-4 Libertadores (fase de grupos), 5 Pré-Libertadores
 * (ainda "classificado pra Libertadores" pro resumo de temporada), 17-20 rebaixamento.
 */
export const LIBERTADORES_CUTOFF_POSITION = 5;
export const RELEGATION_CUTOFF_POSITION = 17;

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

/** Todas as constantes do motor de faltas/cartões/bolas paradas (ver simulation/fouls.ts e match.ts). */

/**
 * Faltas "claras" médias cometidas por um time num jogo equilibrado (perfil de falta neutro),
 * em 90 min. Calibrado empiricamente (ver fouls.sanity.test.ts) porque elenco real (EA FC) roda
 * bem acima do "jogador neutro" hipotético usado pra normalizar `teamFoulProfile` — o número
 * aqui já compensa isso, não é o "11 faltas reais" ingênuo por si só.
 */
export const BASE_FOULS_PER_TEAM = 7.5;
/** Teto de segurança pra probabilidade de falta num único minuto. */
export const FOUL_PROBABILITY_CAP = 0.6;
/**
 * Quanto o peso de sorteio de "quem comete a falta" cai pra um jogador já advertido na
 * partida — jogador advertido segura o carrinho, não pra de disputar. Sem isso, o mesmo
 * jogador de peso alto (zagueiro/volante) acumula faltas demais e o segundo amarelo vira
 * comum demais (calibrado via fouls.sanity.test.ts).
 */
export const CAUTIONED_FOUL_WEIGHT_MULTIPLIER = 0.06;
/** Quanto um bom carrinho (tackling) mitiga a agressão na hora de virar falta — 0 = não mitiga, 1 = anula. */
export const FOUL_TACKLING_MITIGATION = 0.5;

/** Multiplicador de taxa de falta por estilo tático de quem comete — pressão/marcação alta erram mais entradas. */
export const STYLE_FOUL_MODIFIERS: Record<TacticStyle, number> = {
  pressing: 1.35,
  defensive: 1.15,
  counter: 1.05,
  balanced: 1.0,
  direct: 1.0,
  offensive: 0.9,
  possession: 0.85,
};

/**
 * Propensão a cometer falta por posição (função tática + geografia do campo): zagueiros e
 * volantes disputam bola em duelos de risco o jogo inteiro; pontas/atacantes fazem falta
 * bem menos (mais posse de bola do que desarme). Goleiro fica de fora do sorteio no motor.
 */
export const POSITION_FOUL_WEIGHT: Record<Position, number> = {
  GOL: 0.05,
  ZAG: 1.3,
  LD: 1.1,
  LE: 1.1,
  ALD: 1.1,
  ALE: 1.1,
  VOL: 1.4,
  MC: 1.0,
  MD: 0.9,
  ME: 0.9,
  MEA: 0.8,
  PD: 0.7,
  PE: 0.7,
  SA: 0.8,
  CA: 0.9,
};

/** Propensão a SOFRER falta por posição — quem carrega a bola (ataque/drible) apanha mais. */
export const POSITION_FOUL_VICTIM_WEIGHT: Record<Position, number> = {
  GOL: 0.05,
  ZAG: 0.4,
  LD: 0.7,
  LE: 0.7,
  ALD: 0.8,
  ALE: 0.8,
  VOL: 0.6,
  MC: 0.8,
  MD: 0.9,
  ME: 0.9,
  MEA: 1.1,
  PD: 1.3,
  PE: 1.3,
  SA: 1.2,
  CA: 1.2,
};

export interface FoulZoneWeights {
  ownBox: number;
  dangerZone: number;
  midfield: number;
}

/**
 * Zona do campo (da perspectiva de quem comete a falta) onde ela acontece, por posição de
 * quem a cometeu: zagueiro faz falta perto do próprio gol com bem mais frequência que um
 * meia; atacante quase nunca faz falta na própria área. `ownBox` vira pênalti pro time que
 * sofreu, `dangerZone` vira cobrança direta de falta; `midfield` só conta como estatística.
 */
export const POSITION_FOUL_ZONE: Record<Position, FoulZoneWeights> = {
  GOL: { ownBox: 0, dangerZone: 0, midfield: 1 },
  ZAG: { ownBox: 0.025, dangerZone: 0.18, midfield: 0.795 },
  LD: { ownBox: 0.015, dangerZone: 0.2, midfield: 0.785 },
  LE: { ownBox: 0.015, dangerZone: 0.2, midfield: 0.785 },
  ALD: { ownBox: 0.015, dangerZone: 0.2, midfield: 0.785 },
  ALE: { ownBox: 0.015, dangerZone: 0.2, midfield: 0.785 },
  VOL: { ownBox: 0.008, dangerZone: 0.22, midfield: 0.772 },
  MC: { ownBox: 0.003, dangerZone: 0.2, midfield: 0.797 },
  MD: { ownBox: 0.003, dangerZone: 0.2, midfield: 0.797 },
  ME: { ownBox: 0.003, dangerZone: 0.2, midfield: 0.797 },
  MEA: { ownBox: 0, dangerZone: 0.15, midfield: 0.85 },
  PD: { ownBox: 0, dangerZone: 0.1, midfield: 0.9 },
  PE: { ownBox: 0, dangerZone: 0.1, midfield: 0.9 },
  SA: { ownBox: 0, dangerZone: 0.1, midfield: 0.9 },
  CA: { ownBox: 0, dangerZone: 0.1, midfield: 0.9 },
};

/**
 * Probabilidade-base de severidade de cartão dado que a falta já aconteceu (soma 1) —
 * calibrado pra ~4 amarelos e ~0.15 vermelho por partida (soma dos dois times) com o volume
 * de faltas acima. Escalado por `foulerAggressionCardFactor` e, pra vermelho, também pela
 * zona (última defesa/pênalti claro tem bem mais chance de ser reta).
 */
export const FOUL_CARD_BASE = { yellow: 0.16, red: 0.0042 };
/** Multiplicador de chance de vermelho quando a falta é na própria área (última defesa / pênalti claro). */
export const OWN_BOX_RED_CARD_MULTIPLIER = 3;
/** Faixa do multiplicador de chance de cartão pela agressão do jogador — 50 (neutro) = 1.0. */
export const FOUL_CARD_AGGRESSION_MIN_FACTOR = 0.6;
export const FOUL_CARD_AGGRESSION_MAX_FACTOR = 1.4;

/** Conversão de pênalti: taxa-base e faixa de clamp após ajuste por batedor x goleiro. */
export const BASE_PENALTY_CONVERSION = 0.78;
export const MIN_PENALTY_CONVERSION = 0.5;
export const MAX_PENALTY_CONVERSION = 0.93;

/** Conversão de cobrança direta de falta: taxa-base bem mais baixa que pênalti (chute de longe, barreira). */
export const BASE_FREE_KICK_CONVERSION = 0.04;
export const MIN_FREE_KICK_CONVERSION = 0.01;
export const MAX_FREE_KICK_CONVERSION = 0.12;

/**
 * Penalidade de força por setor quando o time fica com 10 (além da média cair por perder um
 * jogador, a falta de corpo no setor tira solidez — mesmo raciocínio de SHAPE_WEIGHT em
 * tactics.ts). Goleiro expulso é caso especial (linha vira goleiro na vida real) — fora do
 * escopo v1, ver TODO.md.
 */
export const RED_CARD_SECTOR_PENALTY: Record<Sector, number> = {
  goalkeeper: 1,
  defense: 0.88,
  midfield: 0.9,
  attack: 0.92,
};
