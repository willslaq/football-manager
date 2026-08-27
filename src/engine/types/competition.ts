import type { ClubId } from './club';
import type { MatchResult } from './match';

export type CompetitionId = string;

export interface Fixture {
  round: number;
  homeTeamId: ClubId;
  awayTeamId: ClubId;
  /** Ausente até a rodada ser simulada. */
  result?: MatchResult;
}

export interface StandingEntry {
  clubId: ClubId;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

export interface Competition {
  id: CompetitionId;
  name: string;
  teams: ClubId[];
  /** fixtures[i] = confrontos da rodada i (turno e returno). */
  fixtures: Fixture[][];
  standings: StandingEntry[];
}
