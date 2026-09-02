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
  /** Divisão do clube nessa temporada — Série A ou Série B (ver `initialStandingsByClub` em generation/season.ts). */
  division: 'A' | 'B';
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

/** Ajusta o preço do ingresso (EUR) do clube do jogador — clamped à faixa da própria divisão, ver `ticketPriceRange` em simulation/finance.ts. */
export interface SetTicketPriceRequest {
  type: 'setTicketPrice';
  requestId: string;
  payload: { ticketPrice: number };
}

/**
 * Avança só o CALENDÁRIO até a data do próximo jogo do time do jogador (ver `advanceCalendar` em
 * simulation/season.ts) — não pula direto pra "próxima rodada" nem já inicia a partida: caminha
 * data a data, comitando qualquer jogo que não seja do jogador conforme sua data é alcançada, e
 * PARA assim que chega no dia do próximo jogo do jogador (sem simulá-lo ainda). Uma vez que
 * `career.season.currentDate` bate com a data desse jogo, a UI troca pro botão "Iniciar Partida"
 * (ver `StartMatchRequest`) — são duas ações distintas de propósito, não uma sequência automática.
 */
export interface AdvanceTimeRequest {
  type: 'advanceTime';
  requestId: string;
  payload: { playerLineup: Lineup; playerTactics: Tactics };
}

/**
 * Simula e transmite ao vivo o jogo do time do jogador na data ATUAL do calendário (ver
 * `startMatchDay` em simulation/season.ts) — só deve ser enviado quando `career.season.currentDate`
 * já é a data desse jogo (chegada lá via `AdvanceTimeRequest`).
 */
export interface StartMatchRequest {
  type: 'startMatch';
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

/** Pede pro motor pular direto pro fim da partida ao vivo em andamento (o requestId do `startMatch` que a originou). */
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

/** Promove uma promessa da categoria de base (`Club.academySquad`) pro elenco principal (`Club.squad`) — ver `promotePlayer` em simulation/academy.ts. */
export interface PromotePlayerRequest {
  type: 'promotePlayer';
  requestId: string;
  payload: { clubId: ClubId; playerId: PlayerId };
}

export type EngineRequest =
  | ListClubsRequest
  | StartCareerRequest
  | AdvanceTimeRequest
  | StartMatchRequest
  | StartNewSeasonRequest
  | SetCareerRequest
  | SkipLiveMatchRequest
  | SetLiveMatchSpeedRequest
  | SetLiveMatchPausedRequest
  | SetTacticalIntensityRequest
  | SetTicketPriceRequest
  | RequestSubstitutionRequest
  | PromotePlayerRequest;

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
  payload: {
    state: CareerState;
    playerMatch: MatchResult | null;
    /** true quando o avanço de tempo esgotou a temporada sem achar mais nenhuma partida do jogador. */
    seasonFinished: boolean;
  };
}

/**
 * Confrontos (de qualquer clube menos o do jogador) resolvidos em datas ANTES da parada do
 * avanço de tempo — "enquanto isso": já definitivos, sem revelação ao vivo (ver `AdvanceTimeRequest`
 * e `simulatedAlongTheWay` em simulation/season.ts). Chega antes de `liveMatchStarted`/`roundResult`.
 */
export interface PassedFixturesResponse {
  type: 'passedFixtures';
  requestId: string;
  payload: { fixtures: Fixture[] };
}

/** Disparado assim que a partida do jogador começa a ser transmitida ao vivo (antes do roundResult final). */
export interface LiveMatchStartedResponse {
  type: 'liveMatchStarted';
  requestId: string;
  payload: {
    homeTeamId: ClubId;
    awayTeamId: ClubId;
    /**
     * Os demais confrontos da rodada (já simulados internamente, placar 0-0 até o primeiro gol) —
     * a UI atualiza o placar gol a gol via `liveMatchOtherResult`, no mesmo minuto em que aconteceu
     * na simulação de cada um, pra parecer que estão acontecendo "ao mesmo tempo".
     */
    otherFixtures: { homeTeamId: ClubId; awayTeamId: ClubId }[];
  };
}

/** O placar de outro confronto da rodada (fora o do jogador) mudando ao vivo, gol a gol. */
export interface LiveMatchOtherResultResponse {
  type: 'liveMatchOtherResult';
  requestId: string;
  payload: {
    fixture: Fixture;
    homeGoals: number;
    awayGoals: number;
    /** true no minuto 90 (tempo cheio) — placar passa a ser definitivo. */
    finished: boolean;
  };
}

/** Batida de relógio periódica pra UI animar o minuto corrente mesmo sem evento novo. */
export interface LiveMatchTickResponse {
  type: 'liveMatchTick';
  requestId: string;
  payload: {
    minute: number;
    homeGoals: number;
    awayGoals: number;
    /** possessionHome: posse do mandante no minuto corrente, 0-100 (mesma convenção de MatchStats.possession). */
    possessionHome: number;
    /** Energia em partida corrente (0-100) de quem está em campo no time do jogador, por PlayerId. */
    energyByPlayerId: Record<PlayerId, number>;
  };
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

/** CareerState mudou por uma ação simples (ex.: tacticalIntensity, ticketPrice) — só atualiza `career`, não mexe em lineup/partida em exibição. */
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

/** Confirma a promoção de uma promessa — só atualiza `career`, mesmo padrão de `SettingsUpdatedResponse`. */
export interface PlayerPromotedResponse {
  type: 'playerPromoted';
  requestId: string;
  payload: { state: CareerState };
}

export type EngineResponse =
  | ClubsListResponse
  | CareerStateResponse
  | RoundResultResponse
  | PassedFixturesResponse
  | LiveMatchStartedResponse
  | LiveMatchOtherResultResponse
  | LiveMatchTickResponse
  | LiveMatchEventResponse
  | LiveMatchTraceResponse
  | LiveMatchSubstitutionAppliedResponse
  | SettingsUpdatedResponse
  | PlayerPromotedResponse
  | ErrorResponse;
