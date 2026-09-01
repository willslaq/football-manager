import type { CareerState, Lineup, Tactics } from '../engine/types';
import { getCloudSession, signOutOfCloud } from './cloudAuth';

export interface CloudSaveSummary {
  id: string;
  slotName: string;
  updatedAt: number;
  createdAt: number;
  trainerName: string;
  /** Ausente em saves gravados antes desse campo existir — trate como opcional (crest cai no fallback de iniciais). */
  clubId?: string;
  clubName: string;
  clubColor: string;
  currentRound: number;
  totalRounds: number;
  seasonState: CareerState['season']['state'];
  /** Ausentes em saves antigos (mesmo motivo de `clubId`) — trate 'Série A'/'Série B'/null como o conjunto completo. */
  division?: string | null;
  tablePosition?: number | null;
}

export interface CloudSaveRecord {
  id: string;
  slotName: string;
  state: CareerState;
  lineup: Lineup | null;
  tactics: Tactics | null;
  updatedAt: number;
}

async function cloudFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const session = getCloudSession();
  if (!session) throw new Error('Faça login para usar o save na nuvem.');
  const res = await fetch(input, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${session.token}` },
  });
  if (res.status === 401) {
    signOutOfCloud();
    throw new Error('Sessão expirada — faça login novamente.');
  }
  return res;
}

export async function listCloudSaves(): Promise<CloudSaveSummary[]> {
  const res = await cloudFetch('/api/cloud-saves');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Falha ao listar saves da nuvem.');
  return data;
}

export async function loadCloudSave(id: string): Promise<CloudSaveRecord> {
  const res = await cloudFetch(`/api/cloud-saves?id=${encodeURIComponent(id)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Falha ao carregar save da nuvem.');
  return data;
}

export async function saveCareerToCloud(
  slotName: string,
  state: CareerState,
  lineup: Lineup | null,
  tactics: Tactics | null,
  existingId?: string,
): Promise<string> {
  const res = await cloudFetch('/api/cloud-saves', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: existingId, slotName, state, lineup, tactics }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Falha ao salvar na nuvem.');
  return data.id;
}

export async function deleteCloudSave(id: string): Promise<void> {
  const res = await cloudFetch(`/api/cloud-saves?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'Falha ao excluir save da nuvem.');
  }
}
