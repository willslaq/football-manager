// Tipos das mensagens trocadas entre a UI e o Worker do motor.
// A UI nunca muta o estado do motor diretamente — só troca mensagens tipadas.

import type { CareerState, ClubId, Lineup, MatchResult, Tactics } from '../engine/types';

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
  payload: { seed: number; trainerName: string; clubId: ClubId };
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

export type EngineRequest = ListClubsRequest | StartCareerRequest | AdvanceRoundRequest | SetCareerRequest;

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

export interface ErrorResponse {
  type: 'error';
  requestId: string;
  payload: { message: string };
}

export type EngineResponse = ClubsListResponse | CareerStateResponse | RoundResultResponse | ErrorResponse;
