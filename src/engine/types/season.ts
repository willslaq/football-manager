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
   * Próxima rodada a ser simulada (1-indexada). Necessário como campo
   * explícito — e não derivado de `fixtures[].result` — porque uma carreira
   * pode começar em andamento (importada de uma situação real, com rodadas
   * anteriores já disputadas mas sem placar jogo a jogo conhecido).
   */
  currentRound: number;
}
