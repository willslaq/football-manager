import { create } from 'zustand';
import { MAX_SUBSTITUTIONS_PER_TEAM } from '../engine';
import { assignToSlots, buildSlots } from '../engine/simulation/formation';
import type {
  CareerState,
  ClubId,
  EngineTraceEntry,
  Fixture,
  Lineup,
  MatchEvent,
  MatchResult,
  Player,
  PlayerId,
  Position,
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

/**
 * Remove da escalação salva qualquer titular que ficou suspenso nessa rodada (cartão
 * acumulado ou expulsão — ver season.ts `updatePlayerStats`) — sem isso o jogador
 * suspenso continuaria "escalado" até o usuário notar manualmente. Devolve a mesma
 * referência de `lineup` quando nada muda, pra não disparar re-render à toa.
 */
export function removeSuspendedStarters(lineup: Lineup, players: Player[]): Lineup {
  const suspendedIds = new Set(players.filter((p) => p.suspendedMatches > 0).map((p) => p.id));
  if (!lineup.starters.some((id) => suspendedIds.has(id))) return lineup;

  const starters = lineup.starters.filter((id) => !suspendedIds.has(id));
  const slotAssignments = lineup.slotAssignments
    ? Object.fromEntries(
        Object.entries(lineup.slotAssignments).map(([slotId, playerId]) => [
          slotId,
          playerId && suspendedIds.has(playerId) ? null : playerId,
        ]),
      )
    : undefined;

  return {
    ...lineup,
    starters,
    slotAssignments,
    captain: suspendedIds.has(lineup.captain) ? (starters[0] ?? '') : lineup.captain,
    penaltyTaker: suspendedIds.has(lineup.penaltyTaker) ? (starters[0] ?? '') : lineup.penaltyTaker,
    freeKickTaker: suspendedIds.has(lineup.freeKickTaker) ? (starters[0] ?? '') : lineup.freeKickTaker,
  };
}

/**
 * Um confronto da rodada fora o do jogador — placar começa em 0-0 (todos os jogos da rodada
 * "começam" junto) e cresce gol a gol conforme `liveMatchOtherResult` chega, na mesma linha do
 * tempo da partida do jogador. `finished` vira `true` no tempo cheio (minuto 90).
 */
export interface OtherMatchState {
  homeTeamId: ClubId;
  awayTeamId: ClubId;
  homeGoals: number;
  awayGoals: number;
  finished: boolean;
}

/** Um titular do time do jogador em campo, na vaga exata da escalação — fonte pra substituição ao vivo. */
export interface PitchRosterEntry {
  slotId: string;
  playerId: PlayerId;
  canonicalPosition: Position;
}

/** Uma troca ainda não confirmada, montada na sessão corrente do diálogo de substituição. */
export interface PendingSwap {
  slotId: string;
  playerOutId: PlayerId;
  playerInId: PlayerId;
}

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
  /** Energia em partida corrente (0-100) de quem está em campo no time do jogador, por PlayerId — atualizada a cada liveMatchTick. */
  energyByPlayerId: Record<PlayerId, number>;
  /** Ritmo de reprodução: 1x = tempo padrão, 2x = duas vezes mais rápido. */
  speed: 1 | 2;
  paused: boolean;
  /** Os demais confrontos da rodada, revelados aos poucos (ver worker/liveMatch.ts). */
  otherMatches: OtherMatchState[];
  /**
   * XI do time do jogador realmente em campo NESSA partida — só CONFIRMADO (ver
   * `pendingSwaps` pra troca ainda não confirmada). Some um titular quando ele é expulso (sem
   * reposição, ver `liveMatchEvent`); vira o suplente na mesma vaga quando uma substituição é
   * confirmada (ver `liveMatchSubstitutionApplied`). Só o time do jogador tem banco na UI — CPU não é substituível.
   */
  pitchRoster: PitchRosterEntry[];
  /** Reservas disponíveis do time do jogador (elenco menos titulares menos suspensos), confirmados. */
  benchIds: PlayerId[];
  /** Substituições já confirmadas nessa partida (ver MAX_SUBSTITUTIONS_PER_TEAM). */
  subCount: number;
  substitutionDialogOpen: boolean;
  /** Vaga do titular "elevado"/selecionado no diálogo — null = nada selecionado. */
  selectedPitchSlotId: string | null;
  /** Trocas montadas nessa sessão do diálogo, ainda não enviadas — some ao fechar sem confirmar. */
  pendingSwaps: PendingSwap[];
}

/**
 * Deriva a escalação/banco do time do jogador a partir da `Lineup` salva (mesma fonte da tela
 * de Escalação) — sem `slotAssignments` (saves antigos/sugestão inicial), reconstrói via
 * `assignToSlots`, igual a Lineup.tsx sempre fez.
 */
function buildPitchRoster(lineup: Lineup | null, career: CareerState | null): PitchRosterEntry[] {
  if (!lineup || !career) return [];
  const playersById = new Map(career.world.players.map((p) => [p.id, p]));
  const slots = buildSlots(lineup.formation);
  const assignments =
    lineup.slotAssignments ??
    assignToSlots(
      slots,
      lineup.starters.map((id) => playersById.get(id)).filter((p): p is Player => !!p),
    );
  return slots
    .map((slot) => {
      const playerId = assignments[slot.id];
      return playerId ? { slotId: slot.id, playerId, canonicalPosition: slot.canonical } : null;
    })
    .filter((entry): entry is PitchRosterEntry => entry !== null);
}

/** Elenco do time do jogador menos titulares menos suspensos — mesmo critério de disponibilidade da Escalação. */
function buildBenchIds(lineup: Lineup | null, career: CareerState | null): PlayerId[] {
  if (!lineup || !career) return [];
  const club = career.world.clubs.find((c) => c.id === career.playerClubId);
  if (!club) return [];
  const playersById = new Map(career.world.players.map((p) => [p.id, p]));
  const starterSet = new Set(lineup.starters);
  return club.squad.filter((id) => {
    if (starterSet.has(id)) return false;
    const player = playersById.get(id);
    return !!player && player.suspendedMatches === 0;
  });
}

/**
 * Aplica uma lista de trocas (pendentes ou recém-confirmadas) sobre um par escalação/banco —
 * pura, usada tanto pra derivar o "preview" do diálogo (aplicada por cima do estado confirmado,
 * sem persistir) quanto, com só as trocas confirmadas, pra atualizar o estado confirmado de fato
 * (ver `liveMatchSubstitutionApplied`). Trocas encadeadas na mesma vaga na mesma sessão (ex.:
 * A sai/B entra, depois B sai/C entra) resolvem corretamente aplicando em ordem.
 */
export function applyPendingSwaps(
  pitchRoster: PitchRosterEntry[],
  benchIds: PlayerId[],
  swaps: PendingSwap[],
): { pitchRoster: PitchRosterEntry[]; benchIds: PlayerId[] } {
  let pitch = pitchRoster;
  let bench = benchIds;
  for (const swap of swaps) {
    pitch = pitch.map((entry) => (entry.slotId === swap.slotId ? { ...entry, playerId: swap.playerInId } : entry));
    bench = [...bench.filter((id) => id !== swap.playerInId), swap.playerOutId];
  }
  return { pitchRoster: pitch, benchIds: bench };
}

interface CareerStore {
  clubs: ClubSummary[];
  career: CareerState | null;
  lineup: Lineup | null;
  tactics: Tactics;
  lastMatch: MatchResult | null;
  liveMatch: LiveMatchState | null;
  /**
   * Jogos (de qualquer clube menos o do jogador) que o avanço de tempo simulou "pelo caminho",
   * em datas antes da parada atual — recapitulação estática, sem revelação ao vivo (ver
   * `advanceTime`/`passedFixtures`). Limpo no próximo `advanceTime`/início de partida ao vivo.
   */
  passedResults: Fixture[];
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
  /**
   * Avança só o CALENDÁRIO, dia a dia, até a data do próximo jogo do time do jogador — comita
   * qualquer outro jogo alcançado pelo caminho, mas NUNCA inicia a partida do jogador sozinho,
   * mesmo ao chegar exatamente nessa data (ver `startMatch`, uma ação separada).
   */
  advanceTime: () => void;
  /** Simula e transmite ao vivo o jogo do time do jogador — só deve ser chamada quando `career.season.currentDate` já é a data desse jogo (ver `advanceTime`). */
  startMatch: () => void;
  /** Encerra a temporada atual (precisa estar 'finished') e começa a seguinte. */
  startNewSeason: () => void;
  skipLiveMatch: () => void;
  setLiveMatchSpeed: (speed: 1 | 2) => void;
  toggleLiveMatchPause: () => void;
  /** Abre o diálogo de substituição e pausa a partida ao vivo (ver LiveMatchState.pitchRoster). */
  openSubstitutionDialog: () => void;
  /** Fecha o diálogo sem confirmar — descarta as trocas ainda pendentes; não retoma a partida sozinho. */
  closeSubstitutionDialog: () => void;
  /** Seleciona (ou desmarca, com null) o titular "elevado" no diálogo — próximo clique num reserva monta a troca. */
  selectPitchSlot: (slotId: string | null) => void;
  /** Monta uma troca com o reserva clicado e a vaga selecionada — só na sessão local, ver `confirmSubstitutions`. */
  queueSwap: (benchPlayerId: string) => void;
  /** Remove uma troca ainda não confirmada da sessão local do diálogo. */
  removePendingSwap: (index: number) => void;
  /** Envia todas as trocas pendentes da sessão de uma vez ao motor; a partida retoma quando o motor confirmar. */
  confirmSubstitutions: () => void;
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
  /** Aplica um save vindo da nuvem (já buscado via cloudSync) — não tem id local, não referencia Dexie. */
  loadCareerFromCloud: (record: { state: CareerState; lineup: Lineup | null; tactics: Tactics | null }) => void;
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
          passedResults: [],
          loading: false,
          error: null,
        });
        break;
      }
      case 'passedFixtures':
        set({ passedResults: response.payload.fixtures });
        break;
      case 'liveMatchStarted': {
        const { lineup, career: currentCareer } = get();
        set({
          liveMatch: {
            homeTeamId: response.payload.homeTeamId,
            awayTeamId: response.payload.awayTeamId,
            minute: 0,
            homeGoals: 0,
            awayGoals: 0,
            events: [],
            possessionHome: 50,
            energyByPlayerId: {},
            speed: 1,
            paused: false,
            otherMatches: response.payload.otherFixtures.map((f) => ({
              homeTeamId: f.homeTeamId,
              awayTeamId: f.awayTeamId,
              homeGoals: 0,
              awayGoals: 0,
              finished: false,
            })),
            pitchRoster: buildPitchRoster(lineup, currentCareer),
            benchIds: buildBenchIds(lineup, currentCareer),
            subCount: 0,
            substitutionDialogOpen: false,
            selectedPitchSlotId: null,
            pendingSwaps: [],
          },
          engineLog: [],
          loading: false,
        });
        break;
      }
      case 'liveMatchOtherResult':
        set((state) =>
          state.liveMatch
            ? {
                liveMatch: {
                  ...state.liveMatch,
                  otherMatches: state.liveMatch.otherMatches.map((m) =>
                    m.homeTeamId === response.payload.fixture.homeTeamId && m.awayTeamId === response.payload.fixture.awayTeamId
                      ? {
                          ...m,
                          homeGoals: response.payload.homeGoals,
                          awayGoals: response.payload.awayGoals,
                          finished: response.payload.finished,
                        }
                      : m,
                  ),
                },
              }
            : {},
        );
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
                  energyByPlayerId: response.payload.energyByPlayerId,
                },
              }
            : {},
        );
        break;
      case 'liveMatchEvent':
        set((state) => {
          if (!state.liveMatch) return {};
          const event = response.payload.event;
          // Expulsão tira o titular de campo sem repor — mesma regra do motor (sendOff, match.ts):
          // sem substituição possível pra quem já saiu assim (ver applySubstitution's no-op).
          const pitchRoster =
            event.type === 'red_card'
              ? state.liveMatch.pitchRoster.filter((entry) => entry.playerId !== event.playerId)
              : state.liveMatch.pitchRoster;
          return {
            liveMatch: {
              ...state.liveMatch,
              events: [...state.liveMatch.events, event],
              homeGoals: response.payload.homeGoals,
              awayGoals: response.payload.awayGoals,
              pitchRoster,
            },
          };
        });
        break;
      case 'liveMatchSubstitutionApplied': {
        set((state) => {
          if (!state.liveMatch) return {};
          const appliedKeys = new Set(response.payload.substitutions.map((s) => `${s.playerOutId}→${s.playerInId}`));
          const confirmed = state.liveMatch.pendingSwaps.filter((s) => appliedKeys.has(`${s.playerOutId}→${s.playerInId}`));
          const { pitchRoster, benchIds } = applyPendingSwaps(state.liveMatch.pitchRoster, state.liveMatch.benchIds, confirmed);
          return {
            liveMatch: {
              ...state.liveMatch,
              pitchRoster,
              benchIds,
              subCount: response.payload.subCount,
              pendingSwaps: [],
              selectedPitchSlotId: null,
              substitutionDialogOpen: false,
              paused: false,
            },
          };
        });
        if (liveMatchRequestId) {
          send({
            type: 'setLiveMatchPaused',
            requestId: crypto.randomUUID(),
            payload: { liveRequestId: liveMatchRequestId, paused: false },
          });
        }
        break;
      }
      case 'roundResult': {
        liveMatchRequestId = null;
        const state = response.payload.state;
        const currentLineup = get().lineup;
        set({
          career: state,
          lineup: currentLineup ? removeSuspendedStarters(currentLineup, state.world.players) : currentLineup,
          lastMatch: response.payload.playerMatch,
          liveMatch: null,
          loading: false,
          error: null,
        });
        scheduleAutoSave();
        break;
      }
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
    passedResults: [],
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

    advanceTime: () => {
      const { lineup, tactics } = get();
      if (!lineup) return;
      // Não seta liveMatchRequestId aqui — essa ação nunca inicia uma partida ao vivo sozinha
      // (ver startMatch), então não há sessão pra pausar/pular/substituir ainda.
      set({ loading: true, error: null, passedResults: [] });
      send({ type: 'advanceTime', requestId: crypto.randomUUID(), payload: { playerLineup: lineup, playerTactics: tactics } });
    },

    startMatch: () => {
      const { lineup, tactics } = get();
      if (!lineup) return;
      const requestId = crypto.randomUUID();
      liveMatchRequestId = requestId;
      set({ loading: true, error: null });
      send({ type: 'startMatch', requestId, payload: { playerLineup: lineup, playerTactics: tactics } });
    },

    startNewSeason: () => {
      // Mantém activeSaveId — é a mesma carreira/save continuando, não uma nova (diferente de startCareer).
      set({ loading: true, error: null });
      send({ type: 'startNewSeason', requestId: crypto.randomUUID(), payload: {} });
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

    openSubstitutionDialog: () => {
      const { liveMatch } = get();
      if (!liveMatchRequestId || !liveMatch || liveMatch.pitchRoster.length === 0) return;
      set({ liveMatch: { ...liveMatch, paused: true, substitutionDialogOpen: true } });
      send({
        type: 'setLiveMatchPaused',
        requestId: crypto.randomUUID(),
        payload: { liveRequestId: liveMatchRequestId, paused: true },
      });
    },

    closeSubstitutionDialog: () => {
      const { liveMatch } = get();
      if (!liveMatch) return;
      set({
        liveMatch: { ...liveMatch, substitutionDialogOpen: false, selectedPitchSlotId: null, pendingSwaps: [] },
      });
    },

    selectPitchSlot: (slotId) => {
      const { liveMatch } = get();
      if (!liveMatch) return;
      set({ liveMatch: { ...liveMatch, selectedPitchSlotId: slotId } });
    },

    queueSwap: (benchPlayerId) => {
      const { liveMatch } = get();
      if (!liveMatch || !liveMatch.selectedPitchSlotId) return;
      if (liveMatch.subCount + liveMatch.pendingSwaps.length >= MAX_SUBSTITUTIONS_PER_TEAM) return;

      const { pitchRoster: effectivePitch, benchIds: effectiveBench } = applyPendingSwaps(
        liveMatch.pitchRoster,
        liveMatch.benchIds,
        liveMatch.pendingSwaps,
      );
      if (!effectiveBench.includes(benchPlayerId)) return;
      const slot = effectivePitch.find((entry) => entry.slotId === liveMatch.selectedPitchSlotId);
      if (!slot) return;

      set({
        liveMatch: {
          ...liveMatch,
          pendingSwaps: [...liveMatch.pendingSwaps, { slotId: slot.slotId, playerOutId: slot.playerId, playerInId: benchPlayerId }],
          selectedPitchSlotId: null,
        },
      });
    },

    removePendingSwap: (index) => {
      const { liveMatch } = get();
      if (!liveMatch) return;
      set({ liveMatch: { ...liveMatch, pendingSwaps: liveMatch.pendingSwaps.filter((_, i) => i !== index) } });
    },

    confirmSubstitutions: () => {
      const { liveMatch } = get();
      if (!liveMatchRequestId || !liveMatch || liveMatch.pendingSwaps.length === 0) return;
      send({
        type: 'requestSubstitution',
        requestId: crypto.randomUUID(),
        payload: {
          liveRequestId: liveMatchRequestId,
          substitutions: liveMatch.pendingSwaps.map((s) => ({ playerOutId: s.playerOutId, playerInId: s.playerInId })),
        },
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
      const resolvedName = slotName?.trim() || saves.find((s) => s.id === activeSaveId)?.slotName || defaultSlotName(career);
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

    loadCareerFromCloud: ({ state, lineup, tactics }) => {
      pendingLoadedSelection = lineup && tactics ? { lineup, tactics } : null;
      set({ activeSaveId: null, loading: true, error: null });
      send({ type: 'setCareer', requestId: crypto.randomUUID(), payload: { state } });
    },
  };
});
