import { create } from 'zustand';
import type { CareerState, Lineup, MatchResult, Tactics } from '../engine/types';
import { deleteCareer, listCareerSummaries, loadCareerRecord, saveCareer, type SavedCareerSummary } from '../persistence/db';
import { exportCareerToJSON, importCareerFromJSON } from '../persistence/serialize';
import EngineWorker from '../worker/engine.worker?worker';
import type { ClubSummary, EngineRequest, EngineResponse } from '../worker/protocol';

interface CareerStore {
  clubs: ClubSummary[];
  career: CareerState | null;
  lineup: Lineup | null;
  tactics: Tactics;
  lastMatch: MatchResult | null;
  loading: boolean;
  error: string | null;

  saves: SavedCareerSummary[];
  activeSaveId: number | null;

  listClubs: (seed: number) => void;
  startCareer: (seed: number, trainerName: string, clubId: string) => void;
  advanceRound: () => void;
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
          loading: false,
          error: null,
        });
        break;
      case 'roundResult':
        set({
          career: response.payload.state,
          lineup: response.payload.suggestedLineup,
          lastMatch: response.payload.playerMatch,
          loading: false,
          error: null,
        });
        break;
      case 'error':
        set({ error: response.payload.message, loading: false });
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
    loading: false,
    error: null,

    saves: [],
    activeSaveId: null,

    listClubs: (seed) => {
      set({ loading: true, error: null });
      send({ type: 'listClubs', requestId: crypto.randomUUID(), payload: { seed } });
    },

    startCareer: (seed, trainerName, clubId) => {
      set({ activeSaveId: null, loading: true, error: null });
      send({ type: 'startCareer', requestId: crypto.randomUUID(), payload: { seed, trainerName, clubId } });
    },

    advanceRound: () => {
      const { lineup, tactics } = get();
      if (!lineup) return;
      set({ loading: true, error: null });
      send({ type: 'advanceRound', requestId: crypto.randomUUID(), payload: { playerLineup: lineup, playerTactics: tactics } });
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
