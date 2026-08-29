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
  /** Só em eventos 'shot_saved': o goleiro adversário que fez a defesa. */
  goalkeeperId?: PlayerId;
  /** Em eventos 'goal'/'shot_saved'/'shot_missed' nascidos de uma falta: qual bola parada gerou a cobrança. */
  setPiece?: 'penalty' | 'free_kick';
  /** Só em eventos 'substitution': quem entrou (playerId acima é quem saiu). */
  playerInId?: PlayerId;
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
  fouls: TeamStat;
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
  /** Só presente na partida do jogador — gerado ao vivo e anexado ao fixture pra rever depois no "modo geek". */
  trace?: EngineTraceEntry[];
}

/**
 * Rastro técnico bruto do motor — os números reais por trás de cada rolagem.
 * Transmitido ao vivo pro "modo geek" da UI e, na partida do jogador, anexado
 * ao MatchResult (campo `trace`) pra rever depois de salvo.
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
    }
  | {
      kind: 'foul';
      minute: number;
      /** Time que cometeu a falta. */
      teamId: ClubId;
      foulerId?: PlayerId;
      victimId?: PlayerId;
      zone: 'own_box' | 'danger_zone' | 'midfield';
      card: 'none' | 'yellow' | 'second_yellow' | 'red';
    };
