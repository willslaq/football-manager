import type { ClubId } from './club';
import type { PlayerId } from './player';

export const MATCH_EVENT_TYPES = [
  'goal',
  /** Chute no alvo que o goleiro defendeu. */
  'shot_saved',
  /** Chute que foi pra fora/por cima. */
  'shot_missed',
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

/**
 * Rastro técnico bruto do motor — os números reais por trás de cada rolagem.
 * Não faz parte do MatchResult (não é persistido no estado de carreira);
 * existe só pra transmitir ao vivo pro "modo geek" da UI, sob demanda.
 */
export type EngineTraceEntry =
  | {
      kind: 'setup';
      home: { clubId: ClubId; attack: number; defense: number; midfield: number };
      away: { clubId: ClubId; attack: number; defense: number; midfield: number };
      possessionHome: number;
      homeChanceCount: number;
      awayChanceCount: number;
    }
  | {
      kind: 'chance';
      minute: number;
      teamId: ClubId;
      shooterId?: PlayerId;
      attackStrength: number;
      defenseStrength: number;
      quality: number;
      goalProbability: number;
      isOnTarget: boolean;
      isGoal: boolean;
    }
  | {
      kind: 'possession';
      minute: number;
      /** Fração 0..1 (não percentual) da posse do mandante naquele minuto. */
      possessionHome: number;
    };
