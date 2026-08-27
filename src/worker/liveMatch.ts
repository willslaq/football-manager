// Transmite uma MatchResult já calculada como uma sequência de eventos pausados em tempo real.
// O motor de simulação (engine/simulation/match.ts) continua puro e síncrono — só a entrega é ao vivo.

import type { EngineTraceEntry, MatchEvent, MatchResult } from '../engine/types';

/** Duração real de um minuto de jogo em 1x. 90 min de jogo ≈ 45s reais. */
const REAL_MS_PER_GAME_MINUTE = 500;
/** Frequência das batidas de relógio (liveMatchTick) enviadas mesmo sem evento novo. */
const TICK_INTERVAL_MS = 200;
const FULL_TIME_MINUTE = 90;

export type LiveMatchSpeed = 1 | 2;

export type ChanceTraceEntry = Extract<EngineTraceEntry, { kind: 'chance' }>;

export interface LiveMatchHandlers {
  onEvent: (event: MatchEvent, homeGoals: number, awayGoals: number) => void;
  /** Uma entrada do rastro técnico bruto do motor (uma por chance), pro "modo geek". */
  onTrace: (entry: ChanceTraceEntry) => void;
  onTick: (minute: number, homeGoals: number, awayGoals: number) => void;
}

export interface LiveMatchController {
  /** Cancela a espera e entrega todos os eventos restantes imediatamente. */
  skip: () => void;
  /** Muda o ritmo de reprodução (1x = tempo padrão, 2x = duas vezes mais rápido). */
  setSpeed: (speed: LiveMatchSpeed) => void;
  /** Congela/retoma o avanço do relógio sem perder o que já foi transmitido. */
  setPaused: (paused: boolean) => void;
  /** Resolve quando a transmissão termina (naturalmente ou via skip). */
  done: Promise<void>;
}

export function runLiveMatch(
  result: MatchResult,
  chanceTrace: ChanceTraceEntry[],
  handlers: LiveMatchHandlers,
): LiveMatchController {
  const remainingEvents = [...result.events].sort((a, b) => a.minute - b.minute);
  const remainingTrace = [...chanceTrace].sort((a, b) => a.minute - b.minute);
  let homeGoals = 0;
  let awayGoals = 0;
  let elapsedMs = 0;
  let speed: LiveMatchSpeed = 1;
  let paused = false;
  let finished = false;
  let intervalId: ReturnType<typeof setInterval> | undefined;

  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  function emitNext(): void {
    const event = remainingEvents.shift()!;
    if (event.type === 'goal') {
      if (event.teamId === result.homeTeamId) homeGoals++;
      else awayGoals++;
    }
    handlers.onEvent(event, homeGoals, awayGoals);
  }

  function finish(): void {
    if (finished) return;
    finished = true;
    if (intervalId !== undefined) clearInterval(intervalId);
    resolveDone();
  }

  function skip(): void {
    if (finished) return;
    while (remainingEvents.length > 0) emitNext();
    while (remainingTrace.length > 0) handlers.onTrace(remainingTrace.shift()!);
    handlers.onTick(FULL_TIME_MINUTE, homeGoals, awayGoals);
    finish();
  }

  function setSpeed(next: LiveMatchSpeed): void {
    speed = next;
  }

  function setPaused(next: boolean): void {
    paused = next;
  }

  intervalId = setInterval(() => {
    if (finished || paused) return;
    elapsedMs += TICK_INTERVAL_MS * speed;
    const minute = Math.min(FULL_TIME_MINUTE, Math.floor(elapsedMs / REAL_MS_PER_GAME_MINUTE));
    while (remainingEvents.length > 0 && remainingEvents[0].minute <= minute) emitNext();
    while (remainingTrace.length > 0 && remainingTrace[0].minute <= minute) handlers.onTrace(remainingTrace.shift()!);
    handlers.onTick(minute, homeGoals, awayGoals);
    if (minute >= FULL_TIME_MINUTE) finish();
  }, TICK_INTERVAL_MS);

  return { skip, setSpeed, setPaused, done };
}
