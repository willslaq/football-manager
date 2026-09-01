import { LIBERTADORES_CUTOFF_POSITION, PROMOTION_CUTOFF_POSITION, RELEGATION_CUTOFF_POSITION } from '../engine/simulation/config';
import type { CareerState, Club, ClubId, Competition, Fixture, Player, Position, StandingEntry, TacticalIntensity } from '../engine/types';

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

/** Nome completo de cada posição (pt-BR) — ver tabela de siglas em engine/types/player.ts. */
export const POSITION_LABEL: Record<Position, string> = {
  GOL: 'Goleiro',
  ZAG: 'Zagueiro',
  LD: 'Lateral Direito',
  LE: 'Lateral Esquerdo',
  ALD: 'Ala Direito',
  ALE: 'Ala Esquerdo',
  VOL: 'Volante',
  MC: 'Meia Central',
  MD: 'Meia Direita',
  ME: 'Meia Esquerda',
  MEA: 'Meia-Atacante',
  PD: 'Ponta Direita',
  PE: 'Ponta Esquerda',
  SA: 'Segundo Atacante',
  CA: 'Centroavante',
};

export type PlayerListFilter = PositionGroup | 'ALL';

/** Filtro de setor — mesmo conjunto usado no Elenco e na Escalação. */
export const POSITION_FILTERS: { id: PlayerListFilter; label: string }[] = [
  { id: 'ALL', label: 'Todos' },
  { id: 'GOL', label: 'Goleiros' },
  { id: 'DEF', label: 'Defesa' },
  { id: 'MEI', label: 'Meio' },
  { id: 'ATA', label: 'Ataque' },
];

/**
 * Câmbio fixo EUR→R$ só pra exibição — `Player.marketValue` continua guardado em EUR (fonte
 * Transfermarkt), nunca convertido/persistido em R$. Sem cotação em tempo real no MVP; ajustar
 * aqui se quiser refletir uma taxa diferente.
 */
const EUR_TO_BRL_RATE = 6;

/** `Player.marketValue` (EUR) formatado como R$ compacto (mil/mi) pra caber em coluna de tabela. */
export function formatMarketValueBRL(marketValueEur: number): string {
  if (!marketValueEur) return '—';
  const brl = marketValueEur * EUR_TO_BRL_RATE;
  if (brl >= 1_000_000) return `R$ ${(brl / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (brl >= 1_000) return `R$ ${Math.round(brl / 1_000).toLocaleString('pt-BR')} mil`;
  return `R$ ${brl.toLocaleString('pt-BR')}`;
}

export function findClub(career: CareerState, clubId: ClubId): Club | undefined {
  return career.world.clubs.find((c) => c.id === clubId);
}

/**
 * A competição do clube do jogador — Série A ou Série B, dependendo de onde ele está NESSA
 * temporada (acesso/rebaixamento pode mudar isso ano a ano, ver `startNewSeason`). Toda tela que
 * antes assumia `season.competitions[0]` (só existia uma competição) deve usar isso no lugar.
 */
export function findPlayerCompetition(career: CareerState): Competition {
  return career.season.competitions.find((c) => c.teams.includes(career.playerClubId)) ?? career.season.competitions[0];
}

/** true quando a competição em questão é a Série B (pela ordem fixa: índice 1, ou id contendo "serie-b"). */
export function isSeriesB(competition: Competition): boolean {
  return competition.id.includes('serie-b');
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

/** Promessas da categoria de base de um clube (ver `Club.academySquad`) — nunca inclui o elenco principal. */
export function resolveAcademySquad(career: CareerState, clubId: ClubId): Player[] {
  const club = findClub(career, clubId);
  if (!club) return [];
  const byId = playersById(career);
  return (club.academySquad ?? []).map((id) => byId.get(id)).filter((p): p is Player => p !== undefined);
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

export type StandingsZone = 'libertadores' | 'libertadores-pre' | 'sula' | 'relegation' | 'promotion' | null;

/**
 * Zona de classificação/rebaixamento de uma posição final NA SÉRIE A — usada tanto pela Tabela
 * (zebra de cores) quanto pelo resumo de fim de temporada (Home). Os cortes
 * (`LIBERTADORES_CUTOFF_POSITION`/`RELEGATION_CUTOFF_POSITION`) vêm do motor pra não divergir do
 * que `buildSeasonSummary` calcula. Pra Série B ver `standingsZoneSeriesB`.
 */
export function standingsZone(position: number): StandingsZone {
  if (position < LIBERTADORES_CUTOFF_POSITION) return 'libertadores';
  if (position === LIBERTADORES_CUTOFF_POSITION) return 'libertadores-pre';
  if (position <= 11) return 'sula';
  if (position >= RELEGATION_CUTOFF_POSITION) return 'relegation';
  return null;
}

/**
 * Zona de acesso/rebaixamento de uma posição final NA SÉRIE B: 1-4 sobem pra Série A
 * (`PROMOTION_CUTOFF_POSITION`), 17-20 é zona de rebaixamento informativa (sem dados de Série C —
 * ver `PROMOTION_CUTOFF_POSITION`'s comentário em config.ts).
 */
export function standingsZoneSeriesB(position: number): StandingsZone {
  if (position <= PROMOTION_CUTOFF_POSITION) return 'promotion';
  if (position >= RELEGATION_CUTOFF_POSITION) return 'relegation';
  return null;
}

export type Outcome = 'win' | 'draw' | 'loss';

/** Mesmas cores usadas no restante da UI (zonas da Tabela, resultado no MatchResult) — Histórico e Calendário compartilham. */
export const OUTCOME_VAR: Record<Outcome, string> = {
  win: 'var(--pitch)',
  draw: 'var(--floodlight)',
  loss: 'var(--danger)',
};

export const OUTCOME_LABEL: Record<Outcome, string> = { win: 'Vitória', draw: 'Empate', loss: 'Derrota' };

/** Resultado de um fixture já resolvido do ponto de vista de `playerClubId` — null se não jogado ou se não é dele. */
export function outcomeFor(fixture: Fixture, playerClubId: ClubId): Outcome | null {
  const result = fixture.result;
  if (!result) return null;
  const isHome = fixture.homeTeamId === playerClubId;
  if (!isHome && fixture.awayTeamId !== playerClubId) return null;
  const mine = isHome ? result.homeGoals : result.awayGoals;
  const theirs = isHome ? result.awayGoals : result.homeGoals;
  return mine > theirs ? 'win' : mine < theirs ? 'loss' : 'draw';
}
