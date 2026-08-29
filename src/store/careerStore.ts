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
import { defaultSlotName } from '../persistence/slotName';
import { loadAutoSavePreference, saveAutoSavePreference } from '../ui/autoSavePreference';
import EngineWorker from '../worker/engine.worker?worker';
import type { ClubSummary, EngineRequest, EngineResponse } from '../worker/protocol';

/** Tempo de debounce do autosave após uma mudança de escalação/tática — evita gravar a cada clique. */
const AUTO_SAVE_DEBOUNCE_MS = 1000;

/** Estado da partida do jogador sendo transmitida ao vivo, minuto a minuto. */
export interface LiveMatchState {
  homeTeamId: ClubId;
  awayTeamId: ClubId;
  minute: number;
  homeGoals: number;
  awayGoals: number;
  events: MatchEvent[];
  /** Posse do mandante no minuto corrente, 0-100 — atualizada a cada liveMatchTick. */
  possessionHome: number;
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
  /** Se ativo, toda mudança de escalação/tática é salva automaticamente (com debounce). */
  autoSaveEnabled: boolean;

  listClubs: (seed: number) => void;
  startCareer: (seed: number, trainerName: string, clubId: string, tacticalIntensity?: TacticalIntensity) => void;
  setTacticalIntensity: (tacticalIntensity: TacticalIntensity) => void;
  advanceRound: () => void;
  skipLiveMatch: () => void;
  setLiveMatchSpeed: (speed: 1 | 2) => void;
  toggleLiveMatchPause: () => void;
  setLineup: (lineup: Lineup) => void;
  setTactics: (tactics: Tactics) => void;
  setAutoSaveEnabled: (enabled: boolean) => void;

  refreshSaves: () => Promise<void>;
  /** Salva a carreira atual. Sem slotName, reaproveita o nome do save ativo (ou um padrão). */
  saveCurrentCareer: (slotName?: string) => Promise<void>;
  loadSave: (id: number) => Promise<void>;
  deleteSave: (id: number) => Promise<void>;
  exportCurrentCareer: () => string | null;
  importCareerFile: (json: string) => void;
}

export const useCareerStore = create<CareerStore>((set, get) => {
  const worker = new EngineWorker();
  /** requestId da partida ao vivo em andamento (se houver) — usado só pra pedir o skip. */
  let liveMatchRequestId: string | null = null;
  /** Escalação/tática de um save carregado, aguardando a resposta 'careerState' do worker pra
   *  sobrescrever a sugestão padrão que o motor calcula (ver setCareer no worker). */
  let pendingLoadedSelection: { lineup: Lineup; tactics: Tactics } | null = null;
  let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleAutoSave(): void {
    if (!get().autoSaveEnabled || !get().career) return;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null;
      void get().saveCurrentCareer();
    }, AUTO_SAVE_DEBOUNCE_MS);
  }

  worker.onmessage = (event: MessageEvent<EngineResponse>) => {
    const response = event.data;
    switch (response.type) {
      case 'clubsList':
        set({ clubs: response.payload.clubs, loading: false, error: null });
        break;
      case 'careerState': {
        const loaded = pendingLoadedSelection;
        pendingLoadedSelection = null;
        set({
          career: response.payload.state,
          lineup: loaded?.lineup ?? response.payload.suggestedLineup,
          tactics: loaded?.tactics ?? response.payload.suggestedTactics,
          lastMatch: null,
          liveMatch: null,
          loading: false,
          error: null,
        });
        break;
      }
      case 'liveMatchStarted':
        set({
          liveMatch: {
            homeTeamId: response.payload.homeTeamId,
            awayTeamId: response.payload.awayTeamId,
            minute: 0,
            homeGoals: 0,
            awayGoals: 0,
            events: [],
            possessionHome: 50,
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
                  possessionHome: response.payload.possessionHome,
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
          lastMatch: response.payload.playerMatch,
          liveMatch: null,
          loading: false,
          error: null,
        });
        scheduleAutoSave();
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
    autoSaveEnabled: loadAutoSavePreference(),

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

    setLineup: (lineup) => {
      set({ lineup });
      scheduleAutoSave();
    },
    setTactics: (tactics) => {
      set({ tactics });
      scheduleAutoSave();
    },
    setAutoSaveEnabled: (enabled) => {
      set({ autoSaveEnabled: enabled });
      saveAutoSavePreference(enabled);
      if (enabled) scheduleAutoSave();
    },

    refreshSaves: async () => {
      const saves = await listCareerSummaries();
      set({ saves });
    },

    saveCurrentCareer: async (slotName) => {
      const { career, activeSaveId, saves, lineup, tactics } = get();
      if (!career) return;
      const resolvedName =
        slotName?.trim() || saves.find((s) => s.id === activeSaveId)?.slotName || defaultSlotName(career);
      const id = await saveCareer(resolvedName, career, lineup, tactics, activeSaveId ?? undefined);
      set({ activeSaveId: id });
      await get().refreshSaves();
    },

    loadSave: async (id) => {
      const record = await loadCareerRecord(id);
      if (!record) {
        set({ error: `Save não encontrado (${id})` });
        return;
      }
      pendingLoadedSelection = record.lineup && record.tactics ? { lineup: record.lineup, tactics: record.tactics } : null;
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
