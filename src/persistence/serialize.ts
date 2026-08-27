import { validateCareerState } from '../engine/validateCareerState';
import type { CareerState } from '../engine/types';

export function exportCareerToJSON(state: CareerState): string {
  return JSON.stringify(state, null, 2);
}

/** Faz o parse e valida a estrutura — lança erro descritivo se o arquivo não for um save válido. */
export function importCareerFromJSON(json: string): CareerState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Arquivo não é um JSON válido.');
  }

  // Saves de antes do modo tático (settings.tacticalIntensity) não têm o campo — completa com o padrão.
  const state = parsed as CareerState;
  if (!state.settings) {
    state.settings = { tacticalIntensity: 'subtle' };
  }

  const result = validateCareerState(state);
  if (!result.valid) {
    throw new Error(`Save inválido: ${result.errors.slice(0, 5).join('; ')}`);
  }
  return state;
}
