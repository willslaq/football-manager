import type { CareerState, Club, ClubId, Player, Position, StandingEntry, TacticalIntensity } from '../engine/types';

export const TACTICAL_INTENSITY_COPY: Record<TacticalIntensity, { label: string; hint: string }> = {
  subtle: {
    label: 'Simples',
    hint: 'Formação e estilo pesam pouco — a qualidade do elenco decide a maior parte dos jogos.',
  },
  strong: {
    label: 'Tática',
    hint: 'Formação e estilo pesam mais — a escolha tática pode decidir jogos parelhos, mesmo contra elenco melhor.',
  },
};

export type PositionGroup = 'GOL' | 'DEF' | 'MEI' | 'ATA';

/** Setor de cada posição — usado pra filtrar/agrupar na UI (Elenco, Escalação). */
export const POSITION_GROUP: Record<Position, PositionGroup> = {
  GOL: 'GOL',
  ZAG: 'DEF',
  LD: 'DEF',
  LE: 'DEF',
  ALD: 'DEF',
  ALE: 'DEF',
  VOL: 'MEI',
  MC: 'MEI',
  MD: 'MEI',
  ME: 'MEI',
  MEA: 'MEI',
  PD: 'ATA',
  PE: 'ATA',
  SA: 'ATA',
  CA: 'ATA',
};

export function findClub(career: CareerState, clubId: ClubId): Club | undefined {
  return career.world.clubs.find((c) => c.id === clubId);
}

export function playersById(career: CareerState): Map<string, Player> {
  return new Map(career.world.players.map((p) => [p.id, p]));
}

export function resolveSquad(career: CareerState, clubId: ClubId): Player[] {
  const club = findClub(career, clubId);
  if (!club) return [];
  const byId = playersById(career);
  return club.squad.map((id) => byId.get(id)).filter((p): p is Player => p !== undefined);
}

/** Pontos → vitórias → saldo de gols → gols pró (ver limitações em engine/simulation/standings.ts). */
export function sortStandingsForDisplay(standings: StandingEntry[]): StandingEntry[] {
  return [...standings].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.won !== a.won) return b.won - a.won;
    const gdA = a.goalsFor - a.goalsAgainst;
    const gdB = b.goalsFor - b.goalsAgainst;
    if (gdB !== gdA) return gdB - gdA;
    return b.goalsFor - a.goalsFor;
  });
}

/** Posição de um clube na tabela (1 = líder), ou null se ele não estiver nela. */
export function standingPosition(standings: StandingEntry[], clubId: ClubId): number | null {
  const index = sortStandingsForDisplay(standings).findIndex((entry) => entry.clubId === clubId);
  return index === -1 ? null : index + 1;
}
