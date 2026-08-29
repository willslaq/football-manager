// Tipos das mensagens trocadas entre a UI e o Worker do motor.
// A UI nunca muta o estado do motor diretamente — só troca mensagens tipadas.

import type {
  CareerState,
  ClubId,
  EngineTraceEntry,
  Fixture,
  Lineup,
  MatchEvent,
  MatchResult,
  PlayerId,
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

/** Pede pro motor encerrar a temporada atual (precisa estar 'finished') e começar a seguinte. */
export interface StartNewSeasonRequest {
  type: 'startNewSeason';
  requestId: string;
  payload: Record<string, never>;
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

/**
 * Confirma um lote de substituições (uma sessão de diálogo pode acumular mais de uma antes de
 * confirmar) no time do jogador, na partida ao vivo em andamento — o motor reroda a simulação
 * com a mesma seed a partir do minuto corrente (ver match.ts's `MatchSubstitution` e
 * engine.worker.ts). Só o lado do jogador é substituível nessa v1 (times de CPU não têm banco na UI).
 */
export interface RequestSubstitutionRequest {
  type: 'requestSubstitution';
  requestId: string;
  payload: { liveRequestId: string; substitutions: { playerOutId: PlayerId; playerInId: PlayerId }[] };
}

export type EngineRequest =
  | ListClubsRequest
  | StartCareerRequest
  | AdvanceRoundRequest
  | StartNewSeasonRequest
  | SetCareerRequest
  | SkipLiveMatchRequest
  | SetLiveMatchSpeedRequest
  | SetLiveMatchPausedRequest
  | SetTacticalIntensityRequest
  | RequestSubstitutionRequest;

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
  payload: { state: CareerState; playerMatch: MatchResult | null };
}

/** Disparado assim que a partida do jogador começa a ser transmitida ao vivo (antes do roundResult final). */
export interface LiveMatchStartedResponse {
  type: 'liveMatchStarted';
  requestId: string;
  payload: {
    homeTeamId: ClubId;
    awayTeamId: ClubId;
    /**
     * Os demais confrontos da rodada (já simulados internamente, mas enviados sem `result`) —
     * a UI mostra "a jogar" até cada um chegar via `liveMatchOtherResult`, revelado aos poucos
     * ao longo da transmissão pra parecer que estão acontecendo "ao mesmo tempo".
     */
    otherFixtures: { homeTeamId: ClubId; awayTeamId: ClubId }[];
  };
}

/** Um confronto da rodada (fora o do jogador) tendo seu resultado revelado durante a transmissão ao vivo. */
export interface LiveMatchOtherResultResponse {
  type: 'liveMatchOtherResult';
  requestId: string;
  payload: { fixture: Fixture };
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

/** Confirma que o lote de substituições pedido foi aplicado — o resto da partida a partir daqui já reflete o novo time. */
export interface LiveMatchSubstitutionAppliedResponse {
  type: 'liveMatchSubstitutionApplied';
  requestId: string;
  payload: {
    substitutions: { playerOutId: PlayerId; playerInId: PlayerId }[];
    /** Total de substituições já confirmadas nessa partida pro time do jogador (ver MAX_SUBSTITUTIONS_PER_TEAM). */
    subCount: number;
  };
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
  | LiveMatchOtherResultResponse
  | LiveMatchTickResponse
  | LiveMatchEventResponse
  | LiveMatchTraceResponse
  | LiveMatchSubstitutionAppliedResponse
  | SettingsUpdatedResponse
  | ErrorResponse;
