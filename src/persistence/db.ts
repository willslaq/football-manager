import Dexie, { type Table } from 'dexie';
import type { CareerState, Lineup, Tactics } from '../engine/types';

export interface SavedCareer {
  id?: number;
  /** Nome do slot escolhido pelo jogador — permite várias carreiras salvas (RF-019/020). */
  slotName: string;
  createdAt: number;
  updatedAt: number;
  state: CareerState;
  /** Escalação/tática do jogador no momento do save — fora do CareerState (não faz parte do motor). */
  lineup: Lineup | null;
  tactics: Tactics | null;
}

/** Metadados de um save, sem o CareerState completo — leve o suficiente para listar. */
export interface SavedCareerSummary {
  id: number;
  slotName: string;
  updatedAt: number;
  trainerName: string;
  clubName: string;
  clubColor: string;
  currentRound: number;
  totalRounds: number;
  seasonState: CareerState['season']['state'];
}

class FootManagerDB extends Dexie {
  careers!: Table<SavedCareer, number>;

  constructor() {
    super('footmanager');
    this.version(1).stores({
      careers: '++id, slotName, updatedAt',
    });
  }
}

export const db = new FootManagerDB();

export async function saveCareer(
  slotName: string,
  state: CareerState,
  lineup: Lineup | null,
  tactics: Tactics | null,
  existingId?: number,
): Promise<number> {
  const now = Date.now();
  if (existingId != null) {
    await db.careers.update(existingId, { slotName, state, lineup, tactics, updatedAt: now });
    return existingId;
  }
  return db.careers.add({ slotName, state, lineup, tactics, createdAt: now, updatedAt: now });
}

export async function listCareerSummaries(): Promise<SavedCareerSummary[]> {
  const all = await db.careers.orderBy('updatedAt').reverse().toArray();
  return all.map((saved) => {
    const club = saved.state.world.clubs.find((c) => c.id === saved.state.playerClubId);
    const competition = saved.state.season.competitions.find((c) => c.teams.includes(saved.state.playerClubId)) ??
      saved.state.season.competitions[0];
    return {
      id: saved.id!,
      slotName: saved.slotName,
      updatedAt: saved.updatedAt,
      trainerName: saved.state.trainer.name,
      clubName: club?.name ?? saved.state.playerClubId,
      clubColor: club?.colors.primary ?? '#8b98a5',
      currentRound: saved.state.season.currentRound,
      totalRounds: competition?.fixtures.length ?? 0,
      seasonState: saved.state.season.state,
    };
  });
}

export async function loadCareerRecord(id: number): Promise<SavedCareer | undefined> {
  return db.careers.get(id);
}

export async function deleteCareer(id: number): Promise<void> {
  await db.careers.delete(id);
}
