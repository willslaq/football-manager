// Tipos das mensagens trocadas entre a UI e o Worker do motor.
// A UI nunca muta o estado do motor diretamente — só troca mensagens tipadas.

import type {
  CareerState,
  ClubId,
  EngineTraceEntry,
  Lineup,
  MatchEvent,
  MatchResult,
  TacticalIntensity,
  Tactics,
} from '../engine/types';

export interface ClubSummary {
  id: ClubId;
  name: string;
  shortName: string;
  reputation: number;
  colors: { primary: string; secondary: string };
  /** Posição real na tabela do Brasileirão 2026 no momento da coleta dos dados (1 = líder). */
  tablePosition: number;
}

export interface ListClubsRequest {
  type: 'listClubs';
  requestId: string;
  payload: { seed: number };
}

export interface StartCareerRequest {
  type: 'startCareer';
  requestId: string;
  payload: { seed: number; trainerName: string; clubId: ClubId; tacticalIntensity?: TacticalIntensity };
}

/** Muda CareerState.settings.tacticalIntensity a qualquer momento da carreira. */
export interface SetTacticalIntensityRequest {
  type: 'setTacticalIntensity';
  requestId: string;
  payload: { tacticalIntensity: TacticalIntensity };
}

export interface AdvanceRoundRequest {
  type: 'advanceRound';
  requestId: string;
  payload: { playerLineup: Lineup; playerTactics: Tactics };
}

/** Adota um CareerState vindo de fora (carregado do Dexie ou importado de um JSON) como carreira ativa. */
export interface SetCareerRequest {
  type: 'setCareer';
  requestId: string;
  payload: { state: CareerState };
}

/** Pede pro motor pular direto pro fim da partida ao vivo em andamento (o requestId do `advanceRound` que a originou). */
export interface SkipLiveMatchRequest {
  type: 'skipLiveMatch';
  requestId: string;
  payload: { liveRequestId: string };
}

/** Muda o ritmo (1x/2x) da partida ao vivo em andamento. */
export interface SetLiveMatchSpeedRequest {
  type: 'setLiveMatchSpeed';
  requestId: string;
  payload: { liveRequestId: string; speed: 1 | 2 };
}

/** Pausa/retoma o relógio da partida ao vivo em andamento. */
export interface SetLiveMatchPausedRequest {
  type: 'setLiveMatchPaused';
  requestId: string;
  payload: { liveRequestId: string; paused: boolean };
}

export type EngineRequest =
  | ListClubsRequest
  | StartCareerRequest
  | AdvanceRoundRequest
  | SetCareerRequest
  | SkipLiveMatchRequest
  | SetLiveMatchSpeedRequest
  | SetLiveMatchPausedRequest
  | SetTacticalIntensityRequest;

export interface ClubsListResponse {
  type: 'clubsList';
  requestId: string;
  payload: { clubs: ClubSummary[] };
}

export interface CareerStateResponse {
  type: 'careerState';
  requestId: string;
  payload: { state: CareerState; suggestedLineup: Lineup; suggestedTactics: Tactics };
}

export interface RoundResultResponse {
  type: 'roundResult';
  requestId: string;
  payload: { state: CareerState; playerMatch: MatchResult | null; suggestedLineup: Lineup };
}

/** Disparado assim que a partida do jogador começa a ser transmitida ao vivo (antes do roundResult final). */
export interface LiveMatchStartedResponse {
  type: 'liveMatchStarted';
  requestId: string;
  payload: { homeTeamId: ClubId; awayTeamId: ClubId };
}

/** Batida de relógio periódica pra UI animar o minuto corrente mesmo sem evento novo. */
export interface LiveMatchTickResponse {
  type: 'liveMatchTick';
  requestId: string;
  /** possessionHome: posse do mandante no minuto corrente, 0-100 (mesma convenção de MatchStats.possession). */
  payload: { minute: number; homeGoals: number; awayGoals: number; possessionHome: number };
}

/** Um evento da partida (gol, chute defendido, chute pra fora) chegando em tempo real. */
export interface LiveMatchEventResponse {
  type: 'liveMatchEvent';
  requestId: string;
  payload: { event: MatchEvent; homeGoals: number; awayGoals: number };
}

/** Uma entrada do rastro técnico bruto do motor (força por setor, probabilidades de cada chance) — "modo geek". */
export interface LiveMatchTraceResponse {
  type: 'liveMatchTrace';
  requestId: string;
  payload: { entry: EngineTraceEntry };
}

/** CareerState.settings mudou (ex.: tacticalIntensity) — só atualiza `career`, não mexe em lineup/partida em exibição. */
export interface SettingsUpdatedResponse {
  type: 'settingsUpdated';
  requestId: string;
  payload: { state: CareerState };
}

export interface ErrorResponse {
  type: 'error';
  requestId: string;
  payload: { message: string };
}

export type EngineResponse =
  | ClubsListResponse
  | CareerStateResponse
  | RoundResultResponse
  | LiveMatchStartedResponse
  | LiveMatchTickResponse
  | LiveMatchEventResponse
  | LiveMatchTraceResponse
  | SettingsUpdatedResponse
  | ErrorResponse;
