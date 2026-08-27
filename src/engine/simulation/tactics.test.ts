import { describe, expect, it } from 'vitest';
import {
  applyFormationShape,
  effectiveStyleModifiers,
  formationStyleCoherence,
  styleMatchupModifier,
} from './tactics';

const NEUTRAL_STRENGTHS = { defense: 60, midfield: 60, attack: 60 };

describe('applyFormationShape', () => {
  it('4-4-2 é a referência neutra: não altera as forças de setor', () => {
    expect(applyFormationShape(NEUTRAL_STRENGTHS, '4-4-2', 'strong')).toEqual(NEUTRAL_STRENGTHS);
  });

  it('5-3-2 reforça a defesa em relação à referência (mais um zagueiro que o 4-4-2)', () => {
    const shaped = applyFormationShape(NEUTRAL_STRENGTHS, '5-3-2', 'strong');
    expect(shaped.defense).toBeGreaterThan(NEUTRAL_STRENGTHS.defense);
  });

  it('4-5-1 enfraquece o ataque em relação à referência (só 1 centroavante de vaga)', () => {
    const shaped = applyFormationShape(NEUTRAL_STRENGTHS, '4-5-1', 'strong');
    expect(shaped.attack).toBeLessThan(NEUTRAL_STRENGTHS.attack);
  });

  it('3-4-3 reforça o ataque e enfraquece a defesa, em relação à referência', () => {
    const shaped = applyFormationShape(NEUTRAL_STRENGTHS, '3-4-3', 'strong');
    expect(shaped.attack).toBeGreaterThan(NEUTRAL_STRENGTHS.attack);
    expect(shaped.defense).toBeLessThan(NEUTRAL_STRENGTHS.defense);
  });

  it('intensidade subtle atenua o efeito em relação a strong', () => {
    const strong = applyFormationShape(NEUTRAL_STRENGTHS, '5-3-2', 'strong');
    const subtle = applyFormationShape(NEUTRAL_STRENGTHS, '5-3-2', 'subtle');
    const strongDelta = strong.defense - NEUTRAL_STRENGTHS.defense;
    const subtleDelta = subtle.defense - NEUTRAL_STRENGTHS.defense;
    expect(subtleDelta).toBeGreaterThan(0);
    expect(subtleDelta).toBeLessThan(strongDelta);
  });
});

describe('formationStyleCoherence', () => {
  it('nunca ultrapassa 1.0 (só fricção, nunca bônus)', () => {
    expect(formationStyleCoherence('4-4-2', 'balanced', 'strong')).toBeLessThanOrEqual(1);
    expect(formationStyleCoherence('3-4-3', 'offensive', 'strong')).toBeLessThanOrEqual(1);
  });

  it('formação e estilo bem alinhados (4-4-2 + equilibrado) não tem fricção', () => {
    expect(formationStyleCoherence('4-4-2', 'balanced', 'strong')).toBeCloseTo(1);
  });

  it('5-3-2 (defensivo) + ofensivo gera fricção real', () => {
    const coherence = formationStyleCoherence('5-3-2', 'offensive', 'strong');
    expect(coherence).toBeLessThan(1);
  });

  it('nunca bloqueia a combinação — sempre fica acima do piso', () => {
    const coherence = formationStyleCoherence('5-3-2', 'offensive', 'strong');
    expect(coherence).toBeGreaterThan(0.5);
  });

  it('intensidade subtle atenua a fricção em relação a strong', () => {
    const strong = formationStyleCoherence('5-3-2', 'offensive', 'strong');
    const subtle = formationStyleCoherence('5-3-2', 'offensive', 'subtle');
    expect(subtle).toBeGreaterThan(strong);
    expect(subtle).toBeLessThan(1);
  });
});

describe('styleMatchupModifier', () => {
  it('pares sem razão tática conhecida ficam neutros', () => {
    expect(styleMatchupModifier('balanced', 'balanced', 'strong')).toEqual({ volume: 1, quality: 1 });
  });

  it('contra-ataque leva vantagem contra um adversário ofensivo', () => {
    const mod = styleMatchupModifier('counter', 'offensive', 'strong');
    expect(mod.quality).toBeGreaterThan(1);
  });

  it('contra-ataque rende menos contra um adversário defensivo (sem espaço pra explorar)', () => {
    const mod = styleMatchupModifier('counter', 'defensive', 'strong');
    expect(mod.quality).toBeLessThan(1);
  });

  it('jogo direto passa por cima da pressão alta', () => {
    const mod = styleMatchupModifier('direct', 'pressing', 'strong');
    expect(mod.volume).toBeGreaterThan(1);
  });

  it('intensidade subtle atenua o confronto de estilos em relação a strong', () => {
    const strong = styleMatchupModifier('counter', 'offensive', 'strong').quality;
    const subtle = styleMatchupModifier('counter', 'offensive', 'subtle').quality;
    expect(subtle).toBeGreaterThan(1);
    expect(subtle).toBeLessThan(strong);
  });
});

describe('effectiveStyleModifiers', () => {
  it('combina base + confronto + coerência multiplicativamente', () => {
    const mods = effectiveStyleModifiers('4-4-2', 'counter', 'offensive', 'strong');
    // 4-4-2 é neutro em coerência com qualquer estilo (diff pequeno), então o ganho
    // vem quase todo do confronto contra-ataque vs ofensivo.
    expect(mods.qualityMultiplier).toBeGreaterThan(1);
  });

  it('concedeVolume não é afetado por confronto/coerência — só pela base do estilo', () => {
    const mods = effectiveStyleModifiers('5-3-2', 'offensive', 'defensive', 'strong');
    expect(mods.concedeVolume).toBeCloseTo(1.2);
  });
});
