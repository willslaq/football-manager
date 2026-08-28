// Lembra a última intensidade tática escolhida pelo usuário (Simples/Tática), fora do
// escopo de um save específico — pré-preenche a Nova Carreira e sobrevive a sessões.
// CareerState.settings.tacticalIntensity continua sendo a fonte de verdade pra cada
// carreira já criada; isso aqui é só a preferência lembrada pra próxima vez.

import type { TacticalIntensity } from '../engine/types';

const STORAGE_KEY = 'footmanager:tacticalIntensity';

export function loadTacticalIntensityPreference(): TacticalIntensity {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'strong' ? 'strong' : 'subtle';
  } catch {
    return 'subtle';
  }
}

export function saveTacticalIntensityPreference(value: TacticalIntensity): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // localStorage indisponível (aba privada, etc.) — a escolha só não é lembrada da próxima vez.
  }
}
