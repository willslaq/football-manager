import { create } from 'zustand';
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
import { deleteCareer, listCareerSummaries, loadCareerRecord, saveCareer, type SavedCareerSummary } from '../persistence/db';
import { exportCareerToJSON, importCareerFromJSON } from '../persistence/serialize';
import EngineWorker from '../worker/engine.worker?worker';
import type { ClubSummary, EngineRequest, EngineResponse } from '../worker/protocol';

/** Estado da partida do jogador sendo transmitida ao vivo, minuto a minuto. */
export interface LiveMatchState {
  homeTeamId: ClubId;
  awayTeamId: ClubId;
  minute: number;
  homeGoals: number;
  awayGoals: number;
  events: MatchEvent[];
  /** Ritmo de reprodução: 1x = tempo padrão, 2x = duas vezes mais rápido. */
  speed: 1 | 2;
  paused: boolean;
}

interface CareerStore {
  clubs: ClubSummary[];
  career: CareerState | null;
  lineup: Lineup | null;
  tactics: Tactics;
  lastMatch: MatchResult | null;
  liveMatch: LiveMatchState | null;
  /** Rastro técnico bruto do motor pra partida ao vivo/mais recente — "modo geek" da UI. */
  engineLog: EngineTraceEntry[];
  loading: boolean;
  error: string | null;

  saves: SavedCareerSummary[];
  activeSaveId: number | null;

  listClubs: (seed: number) => void;
  startCareer: (seed: number, trainerName: string, clubId: string, tacticalIntensity?: TacticalIntensity) => void;
  setTacticalIntensity: (tacticalIntensity: TacticalIntensity) => void;
  advanceRound: () => void;
  skipLiveMatch: () => void;
  setLiveMatchSpeed: (speed: 1 | 2) => void;
  toggleLiveMatchPause: () => void;
  setLineup: (lineup: Lineup) => void;
  setTactics: (tactics: Tactics) => void;

  refreshSaves: () => Promise<void>;
  saveCurrentCareer: (slotName: string) => Promise<void>;
  loadSave: (id: number) => Promise<void>;
  deleteSave: (id: number) => Promise<void>;
  exportCurrentCareer: () => string | null;
  importCareerFile: (json: string) => void;
}

export const useCareerStore = create<CareerStore>((set, get) => {
  const worker = new EngineWorker();
  /** requestId da partida ao vivo em andamento (se houver) — usado só pra pedir o skip. */
  let liveMatchRequestId: string | null = null;

  worker.onmessage = (event: MessageEvent<EngineResponse>) => {
    const response = event.data;
    switch (response.type) {
      case 'clubsList':
        set({ clubs: response.payload.clubs, loading: false, error: null });
        break;
      case 'careerState':
        set({
          career: response.payload.state,
          lineup: response.payload.suggestedLineup,
          tactics: response.payload.suggestedTactics,
          lastMatch: null,
          liveMatch: null,
          loading: false,
          error: null,
        });
        break;
      case 'liveMatchStarted':
        set({
          liveMatch: {
            homeTeamId: response.payload.homeTeamId,
            awayTeamId: response.payload.awayTeamId,
            minute: 0,
            homeGoals: 0,
            awayGoals: 0,
            events: [],
            speed: 1,
            paused: false,
          },
          engineLog: [],
          loading: false,
        });
        break;
      case 'liveMatchTrace':
        set((state) => ({ engineLog: [...state.engineLog, response.payload.entry] }));
        break;
      case 'liveMatchTick':
        set((state) =>
          state.liveMatch
            ? {
                liveMatch: {
                  ...state.liveMatch,
                  minute: response.payload.minute,
                  homeGoals: response.payload.homeGoals,
                  awayGoals: response.payload.awayGoals,
                },
              }
            : {},
        );
        break;
      case 'liveMatchEvent':
        set((state) =>
          state.liveMatch
            ? {
                liveMatch: {
                  ...state.liveMatch,
                  events: [...state.liveMatch.events, response.payload.event],
                  homeGoals: response.payload.homeGoals,
                  awayGoals: response.payload.awayGoals,
                },
              }
            : {},
        );
        break;
      case 'roundResult':
        liveMatchRequestId = null;
        set({
          career: response.payload.state,
          lineup: response.payload.suggestedLineup,
          lastMatch: response.payload.playerMatch,
          liveMatch: null,
          loading: false,
          error: null,
        });
        break;
      case 'settingsUpdated':
        set({ career: response.payload.state });
        break;
      case 'error':
        liveMatchRequestId = null;
        set({ error: response.payload.message, loading: false, liveMatch: null });
        break;
    }
  };

  function send(request: EngineRequest): void {
    worker.postMessage(request);
  }

  return {
    clubs: [],
    career: null,
    lineup: null,
    tactics: { formation: '4-4-2', style: 'balanced' },
    lastMatch: null,
    liveMatch: null,
    engineLog: [],
    loading: false,
    error: null,

    saves: [],
    activeSaveId: null,

    listClubs: (seed) => {
      set({ loading: true, error: null });
      send({ type: 'listClubs', requestId: crypto.randomUUID(), payload: { seed } });
    },

    startCareer: (seed, trainerName, clubId, tacticalIntensity) => {
      set({ activeSaveId: null, loading: true, error: null });
      send({ type: 'startCareer', requestId: crypto.randomUUID(), payload: { seed, trainerName, clubId, tacticalIntensity } });
    },

    setTacticalIntensity: (tacticalIntensity) => {
      send({ type: 'setTacticalIntensity', requestId: crypto.randomUUID(), payload: { tacticalIntensity } });
    },

    advanceRound: () => {
      const { lineup, tactics } = get();
      if (!lineup) return;
      const requestId = crypto.randomUUID();
      liveMatchRequestId = requestId;
      set({ loading: true, error: null });
      send({ type: 'advanceRound', requestId, payload: { playerLineup: lineup, playerTactics: tactics } });
    },

    skipLiveMatch: () => {
      if (!liveMatchRequestId) return;
      send({ type: 'skipLiveMatch', requestId: crypto.randomUUID(), payload: { liveRequestId: liveMatchRequestId } });
    },

    setLiveMatchSpeed: (speed) => {
      const { liveMatch } = get();
      if (!liveMatchRequestId || !liveMatch) return;
      set({ liveMatch: { ...liveMatch, speed } });
      send({
        type: 'setLiveMatchSpeed',
        requestId: crypto.randomUUID(),
        payload: { liveRequestId: liveMatchRequestId, speed },
      });
    },

    toggleLiveMatchPause: () => {
      const { liveMatch } = get();
      if (!liveMatchRequestId || !liveMatch) return;
      const paused = !liveMatch.paused;
      set({ liveMatch: { ...liveMatch, paused } });
      send({
        type: 'setLiveMatchPaused',
        requestId: crypto.randomUUID(),
        payload: { liveRequestId: liveMatchRequestId, paused },
      });
    },

    setLineup: (lineup) => set({ lineup }),
    setTactics: (tactics) => set({ tactics }),

    refreshSaves: async () => {
      const saves = await listCareerSummaries();
      set({ saves });
    },

    saveCurrentCareer: async (slotName) => {
      const { career, activeSaveId } = get();
      if (!career) return;
      const id = await saveCareer(slotName, career, activeSaveId ?? undefined);
      set({ activeSaveId: id });
      await get().refreshSaves();
    },

    loadSave: async (id) => {
      const record = await loadCareerRecord(id);
      if (!record) {
        set({ error: `Save não encontrado (${id})` });
        return;
      }
      set({ activeSaveId: id, loading: true, error: null });
      send({ type: 'setCareer', requestId: crypto.randomUUID(), payload: { state: record.state } });
    },

    deleteSave: async (id) => {
      await deleteCareer(id);
      await get().refreshSaves();
      if (get().activeSaveId === id) set({ activeSaveId: null });
    },

    exportCurrentCareer: () => {
      const { career } = get();
      return career ? exportCareerToJSON(career) : null;
    },

    importCareerFile: (json) => {
      try {
        const state = importCareerFromJSON(json);
        set({ activeSaveId: null, loading: true, error: null });
        send({ type: 'setCareer', requestId: crypto.randomUUID(), payload: { state } });
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  };
});
