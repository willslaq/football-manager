import type { CompetitionId } from './competition';
import type { Competition } from './competition';

export const SEASON_STATES = ['not_started', 'in_progress', 'finished'] as const;

/** Máquina de estados da temporada (SRS §46), reduzida ao necessário para o MVP. */
export type SeasonState = (typeof SEASON_STATES)[number];

export interface CalendarEntry {
  round: number;
  competitionId: CompetitionId;
}

export interface Season {
  year: number;
  /** Ordem em que as rodadas das competições devem ser jogadas. */
  calendar: CalendarEntry[];
  competitions: Competition[];
  state: SeasonState;
  /**
   * Data "de hoje" no mundo do jogo (ISO 'YYYY-MM-DD') — cursor de onde o avanço de tempo
   * (`advanceToNextEvent` em simulation/season.ts) parou. Fonte da verdade da progressão da
   * temporada; `currentRound` abaixo é só informativo, derivado a partir daqui.
   */
  currentDate: string;
  /**
   * Rodada "atual" pra exibição (1-indexada) — informativo/derivado (ver `deriveCurrentRound`
   * em simulation/season.ts), não mutado independentemente. Continua existindo como campo
   * explícito (e não só uma função pura) porque uma carreira pode começar em andamento
   * (importada de uma situação real, com rodadas anteriores já disputadas mas sem placar
   * jogo a jogo conhecido) — ver `deriveCurrentRound`'s uso de `date` em vez de `result`.
   */
  currentRound: number;
}
