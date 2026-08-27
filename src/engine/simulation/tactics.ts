// Como formação e estilo pesam na simulação, além da qualidade dos jogadores:
// 1) forma da formação — mais corpos num setor rendem solidez/ímpeto ali, mesmo com a
//    mesma qualidade média de elenco (ex.: 5 zagueiros seguram mais que 3, mesmo iguais);
// 2) confronto de estilos — alguns pares têm vantagem real (contra-ataque explora time
//    ofensivo; pressão sufoca posse de bola; jogo direto passa por cima da pressão);
// 3) coerência formação×estilo — uma formação de 5 zagueiros jogando ofensivo é
//    fisicamente possível (não bloqueamos), mas gera fricção tática real.
// Tudo escalado por CareerState.settings.tacticalIntensity: 'subtle' ainda deixa a
// qualidade dos jogadores dominar; 'strong' deixa a tática decidir jogos parelhos.

import type { Formation, TacticalIntensity, TacticStyle } from '../types/tactics';
import { sectorSlotCounts } from './autoLineup';
import { STYLE_MODIFIERS, type StyleModifiers } from './config';
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

// --- 2) Coerência formação × estilo ---

/**
 * Intenção ofensiva "de bolso" da formação, de -1 (muito defensiva) a +1 (muito
 * ofensiva). Não dá pra derivar só da contagem zagueiro/meia/atacante: um 4-2-3-1 tem
 * só 1 centroavante de vaga, mas o trio por trás dele é puramente ofensivo; um 3-5-2/
 * 3-4-3 depende de quanto os alas sobem. Por isso é uma tabela, não uma fórmula.
 */
const FORMATION_INTENT: Record<Formation, number> = {
  '5-3-2': -1,
  '4-5-1': -0.6,
  '3-5-2': 0,
  '4-4-2': 0,
  '4-2-3-1': 0.4,
  '4-3-3': 0.6,
  '3-4-3': 1,
};

/** Mesma escala de -1..+1, derivada do volume de ataque que o estilo já define em STYLE_MODIFIERS. */
function styleIntent(style: TacticStyle): number {
  return (STYLE_MODIFIERS[style].attackVolume - 1) / 0.25;
}

const COHERENCE_WEIGHT = 0.15;
const COHERENCE_FLOOR = 0.8;

/**
 * Fricção quando formação e estilo puxam pra direções opostas (ex.: 5-3-2 ofensivo).
 * Nunca bloqueia a combinação — só reduz volume/qualidade de ataque do próprio time.
 * 1.0 = sem fricção; nunca passa de 1.0 (não existe "bônus" de coerência, só o piso).
 */
export function formationStyleCoherence(formation: Formation, style: TacticStyle, intensity: TacticalIntensity): number {
  const diff = Math.abs(FORMATION_INTENT[formation] - styleIntent(style));
  const raw = Math.max(COHERENCE_FLOOR, 1 - COHERENCE_WEIGHT * diff);
  return scaled(raw, intensity);
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
