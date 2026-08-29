// Transmite uma MatchResult já calculada como uma sequência de eventos pausados em tempo real.
// O motor de simulação (engine/simulation/match.ts) continua puro e síncrono — só a entrega é ao vivo.

import type { ClubId, EngineTraceEntry, Fixture, MatchEvent, MatchResult, PlayerId } from '../engine/types';

/** Duração real de um minuto de jogo em 1x. 90 min de jogo ≈ 45s reais. */
const REAL_MS_PER_GAME_MINUTE = 500;
/** Frequência das batidas de relógio (liveMatchTick) enviadas mesmo sem evento novo. */
const TICK_INTERVAL_MS = 200;
const FULL_TIME_MINUTE = 90;

export type LiveMatchSpeed = 1 | 2;

export type ChanceTraceEntry = Extract<EngineTraceEntry, { kind: 'chance' }>;
export type PossessionTraceEntry = Extract<EngineTraceEntry, { kind: 'possession' }>;
export type EnergyTraceEntry = Extract<EngineTraceEntry, { kind: 'energy' }>;

/** Rastros brutos do motor usados pra transmitir a partida ao vivo. */
export interface LiveMatchTraces {
  chances: ChanceTraceEntry[];
  possession: PossessionTraceEntry[];
  /** Energia em partida por jogador, um snapshot por minuto (ver match.ts's `matchEnergy`). */
  energy: EnergyTraceEntry[];
}

export interface LiveMatchHandlers {
  onEvent: (event: MatchEvent, homeGoals: number, awayGoals: number) => void;
  /** Uma entrada do rastro técnico bruto do motor (uma por chance), pro "modo geek". */
  onTrace: (entry: ChanceTraceEntry) => void;
  /**
   * possessionHome: posse do mandante no minuto corrente, 0-100 (já arredondado pra UI).
   * energyByPlayerId: energia em partida corrente de quem está em campo (ver LiveMatchTraces.energy).
   */
  onTick: (
    minute: number,
    homeGoals: number,
    awayGoals: number,
    possessionHome: number,
    energyByPlayerId: Record<PlayerId, number>,
  ) => void;
  /**
   * Placar de outro confronto da rodada (já simulado internamente) mudando ao vivo — gol a gol,
   * no mesmo minuto em que aconteceu na simulação dele (mesma linha do tempo da partida do
   * jogador, já que todos os jogos da rodada "acontecem" ao mesmo tempo). `finished` vira `true`
   * no minuto 90, quando o placar passa a ser definitivo.
   */
  onOtherResult?: (fixture: Fixture, homeGoals: number, awayGoals: number, finished: boolean) => void;
}

/** Um confronto da rodada (fora o do jogador), já com resultado final conhecido internamente. */
export interface OtherRoundResult {
  fixture: Fixture;
}

/** Estado de acompanhamento de um confronto "de fundo" — placar cresce gol a gol junto do relógio da partida do jogador. */
interface OtherFixtureState {
  fixture: Fixture;
  /** Gols do confronto, minuto a minuto (só eventos 'goal'), já ordenados. */
  goalEvents: { minute: number; teamId: ClubId }[];
  nextGoalIndex: number;
  homeGoals: number;
  awayGoals: number;
  finished: boolean;
}

export interface LiveMatchController {
  /** Cancela a espera e entrega todos os eventos restantes imediatamente. */
  skip: () => void;
  /** Muda o ritmo de reprodução (1x = tempo padrão, 2x = duas vezes mais rápido). */
  setSpeed: (speed: LiveMatchSpeed) => void;
  /** Congela/retoma o avanço do relógio sem perder o que já foi transmitido. */
  setPaused: (paused: boolean) => void;
  /**
   * Troca o resultado ainda por vir por um recém-recalculado (substituição confirmada): tudo até
   * `fromMinute` já foi transmitido e é preservado (o motor garante prefixo idêntico pra mesma
   * seed — ver match.ts), só o que vem depois de `fromMinute` é substituído.
   */
  applyNewResult: (newResult: MatchResult, newTraces: LiveMatchTraces, fromMinute: number) => void;
  /** Resolve quando a transmissão termina (naturalmente ou via skip). */
  done: Promise<void>;
}

function buildOtherFixtureStates(otherResults: OtherRoundResult[]): OtherFixtureState[] {
  return otherResults.map(({ fixture }) => ({
    fixture,
    goalEvents: (fixture.result?.events ?? [])
      .filter((e) => e.type === 'goal')
      .map((e) => ({ minute: e.minute, teamId: e.teamId }))
      .sort((a, b) => a.minute - b.minute),
    nextGoalIndex: 0,
    homeGoals: 0,
    awayGoals: 0,
    finished: false,
  }));
}

export function runLiveMatch(
  initialResult: MatchResult,
  traces: LiveMatchTraces,
  handlers: LiveMatchHandlers,
  otherResults: OtherRoundResult[] = [],
): LiveMatchController {
  let result = initialResult;
  const remainingEvents = [...result.events].sort((a, b) => a.minute - b.minute);
  const remainingTrace = [...traces.chances].sort((a, b) => a.minute - b.minute);
  const remainingPossession = [...traces.possession].sort((a, b) => a.minute - b.minute);
  const remainingEnergy = [...traces.energy].sort((a, b) => a.minute - b.minute);
  const otherFixtureStates = buildOtherFixtureStates(otherResults);
  let homeGoals = 0;
  let awayGoals = 0;
  /** Posse do mandante corrente, 0-100 — atualizada conforme o relógio passa por cada minuto simulado. */
  let possessionHome = 50;
  /** Energia em partida corrente de quem está em campo — atualizada conforme o relógio passa por cada minuto simulado. */
  let energyByPlayerId: Record<PlayerId, number> = {};
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

  /** Avança o placar "de fundo" dos outros confrontos até `minute` — gol a gol, e definitivo em tempo cheio. */
  function updateOtherFixtures(minute: number): void {
    for (const state of otherFixtureStates) {
      if (state.finished) continue;
      let changed = false;
      while (state.nextGoalIndex < state.goalEvents.length && state.goalEvents[state.nextGoalIndex].minute <= minute) {
        const goal = state.goalEvents[state.nextGoalIndex];
        if (goal.teamId === state.fixture.homeTeamId) state.homeGoals++;
        else state.awayGoals++;
        state.nextGoalIndex++;
        changed = true;
      }
      const nowFinished = minute >= FULL_TIME_MINUTE;
      if (changed || nowFinished) {
        if (nowFinished) state.finished = true;
        handlers.onOtherResult?.(state.fixture, state.homeGoals, state.awayGoals, state.finished);
      }
    }
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
    remainingPossession.length = 0;
    if (remainingEnergy.length > 0) energyByPlayerId = remainingEnergy[remainingEnergy.length - 1].energyByPlayerId;
    remainingEnergy.length = 0;
    updateOtherFixtures(FULL_TIME_MINUTE);
    handlers.onTick(FULL_TIME_MINUTE, homeGoals, awayGoals, result.stats.possession.home, energyByPlayerId);
    finish();
  }

  function setSpeed(next: LiveMatchSpeed): void {
    speed = next;
  }

  function setPaused(next: boolean): void {
    paused = next;
  }

  function applyNewResult(newResult: MatchResult, newTraces: LiveMatchTraces, fromMinute: number): void {
    if (finished) return;
    result = newResult;
    remainingEvents.length = 0;
    remainingEvents.push(...newResult.events.filter((e) => e.minute > fromMinute).sort((a, b) => a.minute - b.minute));
    remainingTrace.length = 0;
    remainingTrace.push(...newTraces.chances.filter((e) => e.minute > fromMinute).sort((a, b) => a.minute - b.minute));
    remainingPossession.length = 0;
    remainingPossession.push(...newTraces.possession.filter((e) => e.minute > fromMinute).sort((a, b) => a.minute - b.minute));
    remainingEnergy.length = 0;
    remainingEnergy.push(...newTraces.energy.filter((e) => e.minute > fromMinute).sort((a, b) => a.minute - b.minute));
  }

  intervalId = setInterval(() => {
    if (finished || paused) return;
    elapsedMs += TICK_INTERVAL_MS * speed;
    const minute = Math.min(FULL_TIME_MINUTE, Math.floor(elapsedMs / REAL_MS_PER_GAME_MINUTE));
    while (remainingEvents.length > 0 && remainingEvents[0].minute <= minute) emitNext();
    while (remainingTrace.length > 0 && remainingTrace[0].minute <= minute) handlers.onTrace(remainingTrace.shift()!);
    while (remainingPossession.length > 0 && remainingPossession[0].minute <= minute) {
      possessionHome = Math.round(remainingPossession.shift()!.possessionHome * 100);
    }
    while (remainingEnergy.length > 0 && remainingEnergy[0].minute <= minute) {
      energyByPlayerId = remainingEnergy.shift()!.energyByPlayerId;
    }
    updateOtherFixtures(minute);
    handlers.onTick(minute, homeGoals, awayGoals, possessionHome, energyByPlayerId);
    if (minute >= FULL_TIME_MINUTE) finish();
  }, TICK_INTERVAL_MS);

  return { skip, setSpeed, setPaused, applyNewResult, done };
}
