// Como formação e estilo pesam na simulação, além da qualidade dos jogadores:
// 1) forma da formação — mais corpos num setor rendem solidez/ímpeto ali, mesmo com a
//    mesma qualidade média de elenco (ex.: 5 zagueiros seguram mais que 3, mesmo iguais);
// 2) confronto de estilos — alguns pares têm vantagem real (contra-ataque explora time
//    ofensivo; pressão sufoca posse de bola; jogo direto passa por cima da pressão);
// 3) coerência formação×estilo — cada par formação×estilo tem uma afinidade real vinda
//    do futebol de verdade (ex.: 4-3-3 é a formação clássica de posse E de pressão alta;
//    já 5-3-2 não serve pra nenhum dos dois). Tabela autorada, não uma fórmula de eixo
//    único — um único eixo "quão ofensivo" não segura uma formação boa pra vários
//    estilos diferentes ao mesmo tempo (ver nota em FORMATION_STYLE_FIT).
// Tudo escalado por CareerState.settings.tacticalIntensity: 'subtle' ainda deixa a
// qualidade dos jogadores dominar; 'strong' deixa a tática decidir jogos parelhos.

import type { Formation, TacticalIntensity, TacticStyle } from '../types/tactics';
import { sectorSlotCounts } from './autoLineup';
import { POSSESSION_MIDFIELD_SHAPE_WEIGHT, POSSESSION_STYLE_AFFINITY, STYLE_MODIFIERS, type StyleModifiers } from './config';
import type { SectorStrengths } from './strength';

const INTENSITY_SCALE: Record<TacticalIntensity, number> = {
  subtle: 0.5,
  strong: 1,
};

/** Aproxima um multiplicador de 1.0 conforme a intensidade tática escolhida no save. */
function scaled(multiplier: number, intensity: TacticalIntensity): number {
  return 1 + (multiplier - 1) * INTENSITY_SCALE[intensity];
}

// --- 1) Forma da formação: mais corpos num setor = mais solidez/ímpeto ali ---

/** 4-4-2 como referência neutra (é o padrão do time sem escalação manual). */
const SECTOR_BASELINE = { defense: 4, midfield: 4, attack: 2 };

const SHAPE_WEIGHT = { defense: 0.08, midfield: 0.06, attack: 0.1 };

export function applyFormationShape(
  strengths: SectorStrengths,
  formation: Formation,
  intensity: TacticalIntensity,
): SectorStrengths {
  const slots = sectorSlotCounts(formation);
  return {
    defense: strengths.defense * scaled(1 + (slots.defense - SECTOR_BASELINE.defense) * SHAPE_WEIGHT.defense, intensity),
    midfield: strengths.midfield * scaled(1 + (slots.midfield - SECTOR_BASELINE.midfield) * SHAPE_WEIGHT.midfield, intensity),
    attack: strengths.attack * scaled(1 + (slots.attack - SECTOR_BASELINE.attack) * SHAPE_WEIGHT.attack, intensity),
  };
}

// --- 1b) Viés de posse por formação/estilo (não é volume/qualidade de chance, é a bola em si) ---

/**
 * Quanto a formação/estilo do time puxa a posse média da partida além do que a razão
 * de força de meio-campo já explica — ex.: um time de posse com meio-campo lotado tenta
 * ativamente segurar a bola; um time de contra-ataque abre mão dela de propósito, mesmo
 * com elenco parecido. Some `possessionBias(home) - possessionBias(away)` ao alvo de
 * posse (SectorStrengths.midfield ratio) antes do clamp final.
 */
export function possessionBias(formation: Formation, style: TacticStyle, intensity: TacticalIntensity): number {
  const slots = sectorSlotCounts(formation);
  const shapeBias = (slots.midfield - SECTOR_BASELINE.midfield) * POSSESSION_MIDFIELD_SHAPE_WEIGHT;
  const styleBias = POSSESSION_STYLE_AFFINITY[style];
  return scaled(1 + shapeBias + styleBias, intensity) - 1;
}

// --- 2) Coerência formação × estilo ---

/**
 * Afinidade real de cada par formação×estilo, vinda do futebol de verdade (EA FC,
 * Football Manager e análise tática consultados pra calibrar): >1 = combinação
 * consagrada, ganha um pequeno bônus de eficiência; <1 = fricção tática real. Só os
 * pares com uma razão concreta ganham entrada aqui — o resto fica neutro (1.0). Mesmo
 * espírito de STYLE_MATCHUPS: uma matriz 7x7 preenchida por completude finge precisão
 * que não existe; um único eixo "quão ofensivo" (o modelo anterior) também não serve —
 * o 4-3-3, por exemplo, é referência tanto em posse quanto em pressão alta e contra-
 * ataque ao mesmo tempo, três estilos que um eixo único não consegue aproximar todos.
 */
const FORMATION_STYLE_FIT: Partial<Record<Formation, Partial<Record<TacticStyle, number>>>> = {
  '4-3-3': {
    // Formação-referência de posse (Guardiola/tiki-taka) e de pressão alta (gegenpressing do Klopp).
    possession: 1.08,
    pressing: 1.08,
    offensive: 1.05,
    counter: 1.03,
    // Sem um alvo de bola aérea/2º atacante pra jogo direto; não é formação pra recuar.
    direct: 0.9,
    defensive: 0.88,
  },
  '4-2-3-1': {
    // Muitos triângulos de passe e um double pivot que protege a saída de bola.
    possession: 1.06,
    pressing: 1.04,
    // Alas avançados deixam brecha nas costas quando o time perde a bola em transição.
    counter: 0.92,
  },
  '4-4-2': {
    // Clássica de contra-ataque e jogo direto — dois atacantes dão alvo pra bola longa.
    counter: 1.06,
    direct: 1.06,
    // Faltam opções centrais de passe pra sustentar posse paciente.
    possession: 0.9,
  },
  '5-3-2': {
    defensive: 1.05,
    counter: 1.05,
    possession: 0.85,
    pressing: 0.85,
    offensive: 0.8,
  },
  '3-5-2': {
    // Cinco no meio-campo dá números pra pressionar alto com sobra.
    pressing: 1.06,
  },
  '3-4-3': {
    // Linha de três zagueiros dá uma opção extra de passe na saída; alas avançados = time muito ofensivo.
    possession: 1.05,
    offensive: 1.08,
    // Recuar expõe o back-3 (sem lateral de origem) contra qualquer ataque de verdade.
    defensive: 0.85,
  },
  '4-5-1': {
    // Linha de cinco no meio fecha os corredores de passe — ótima pra segurar resultado no contra-ataque.
    defensive: 1.06,
    counter: 1.05,
    // Só um centroavante de vaga não sustenta postura ofensiva de verdade.
    offensive: 0.85,
  },
};

const COHERENCE_FLOOR = 0.8;
const COHERENCE_CEILING = 1.15;

/**
 * Fricção (ou pequeno bônus, pra pares consagrados) de formação×estilo. Nunca bloqueia
 * a combinação — só ajusta volume/qualidade de ataque do próprio time. 1.0 = neutro.
 */
export function formationStyleCoherence(formation: Formation, style: TacticStyle, intensity: TacticalIntensity): number {
  const raw = FORMATION_STYLE_FIT[formation]?.[style] ?? 1;
  return Math.min(COHERENCE_CEILING, Math.max(COHERENCE_FLOOR, scaled(raw, intensity)));
}

// --- 3) Confronto de estilos ---

interface MatchupModifier {
  volume?: number;
  quality?: number;
}

/**
 * Só os pares com uma razão tática real ganham entrada aqui — o resto fica neutro.
 * Meio pouco povoado de propósito: cada valor tem que se justificar, não é uma
 * matriz 7x7 preenchida por completude.
 */
const STYLE_MATCHUPS: Partial<Record<TacticStyle, Partial<Record<TacticStyle, MatchupModifier>>>> = {
  counter: {
    // Time adversário lançado pra frente = mais espaço nas costas da defesa dele.
    offensive: { quality: 1.2 },
    pressing: { quality: 1.14 },
    possession: { quality: 1.1 },
    // Time fechado atrás não deixa espaço nenhum pra explorar.
    defensive: { quality: 0.88 },
    counter: { quality: 0.94 },
  },
  pressing: {
    // Pressão sufoca a saída de bola de quem tenta jogar bonito por baixo.
    possession: { quality: 1.16, volume: 1.08 },
    // Bola longa do jogo direto passa por cima da linha de pressão.
    direct: { volume: 0.9 },
    // Empurrar a marcação lá na frente deixa espaço nas costas pro contra-ataque.
    counter: { quality: 0.88 },
  },
  possession: {
    defensive: { quality: 1.1 },
    pressing: { quality: 0.84 },
  },
  direct: {
    pressing: { volume: 1.12 },
    // Bloco baixo organizado defende cruzamento/bola aérea com tranquilidade.
    defensive: { quality: 0.9 },
  },
  offensive: {
    counter: { quality: 0.84 },
    defensive: { volume: 1.12 },
  },
};

export function styleMatchupModifier(
  myStyle: TacticStyle,
  opponentStyle: TacticStyle,
  intensity: TacticalIntensity,
): Required<MatchupModifier> {
  const raw = STYLE_MATCHUPS[myStyle]?.[opponentStyle] ?? {};
  return {
    volume: scaled(raw.volume ?? 1, intensity),
    quality: scaled(raw.quality ?? 1, intensity),
  };
}

// --- Combinação final ---

/** StyleModifiers base (config.ts) já ajustado pelo confronto de estilos e pela coerência formação×estilo. */
export function effectiveStyleModifiers(
  formation: Formation,
  style: TacticStyle,
  opponentStyle: TacticStyle,
  intensity: TacticalIntensity,
): StyleModifiers {
  const base = STYLE_MODIFIERS[style];
  const matchup = styleMatchupModifier(style, opponentStyle, intensity);
  const coherence = formationStyleCoherence(formation, style, intensity);
  return {
    attackVolume: base.attackVolume * matchup.volume * coherence,
    concedeVolume: base.concedeVolume,
    qualityMultiplier: base.qualityMultiplier * matchup.quality * coherence,
  };
}
