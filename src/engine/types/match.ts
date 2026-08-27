import type { ClubId } from './club';
import type { PlayerId } from './player';

export const MATCH_EVENT_TYPES = [
  'goal',
  'own_goal',
  'yellow_card',
  'red_card',
  'substitution',
] as const;

export type MatchEventType = (typeof MATCH_EVENT_TYPES)[number];

export interface MatchEvent {
  minute: number;
  type: MatchEventType;
  teamId: ClubId;
  playerId: PlayerId;
}

export interface TeamStat {
  home: number;
  away: number;
}

export interface MatchStats {
  /** Percentual; home + away deve somar 100. */
  possession: TeamStat;
  shots: TeamStat;
  shotsOnTarget: TeamStat;
}

/** O "porquê" do resultado — diferencial do produto (SRS §49). */
export interface Reason {
  factor: string;
  /** Sinalizado; magnitude indica o quanto pesou no resultado. */
  impact: number;
  /** Texto legível em pt-BR para a UI. */
  note: string;
}

export interface MatchResult {
  homeTeamId: ClubId;
  awayTeamId: ClubId;
  homeGoals: number;
  awayGoals: number;
  events: MatchEvent[];
  stats: MatchStats;
  manOfTheMatch: PlayerId;
  explanation: Reason[];
}
