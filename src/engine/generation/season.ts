import type { ClubId } from '../types/club';
import type { CalendarEntry } from '../types/season';
import type { Season } from '../types/season';
import type { Competition, CompetitionId, Fixture, StandingEntry } from '../types/competition';
import { addDays, assignFixtureDates, nearestSaturdayOnOrAfter, shiftYear } from './calendar';
import type { RawCompetitionFile, RawFixturesFile, RawStandingsFile } from './rawData';
import competitionFileA from '../../data/brasileirao-2026/competition.json';
import fixturesFileA from '../../data/brasileirao-2026/fixtures.json';
import standingsFileA from '../../data/brasileirao-2026/standings-current.json';
import competitionFileB from '../../data/brasileirao-serie-b-2026/competition.json';
import fixturesFileB from '../../data/brasileirao-serie-b-2026/fixtures.json';
import standingsFileB from '../../data/brasileirao-serie-b-2026/standings-current.json';

interface DivisionData {
  competitionRaw: RawCompetitionFile;
  fixturesRaw: RawFixturesFile;
  standingsRaw: RawStandingsFile;
}

/**
 * As duas divisões do Brasileirão que o motor simula em paralelo (ver `startNewSeason` pra
 * como uma pode virar a outra ano a ano). Ordem importa só pra desempate estável em
 * `initialStandingsByClub` — a temporada em si trata as duas de forma simétrica.
 */
const DIVISIONS: DivisionData[] = [
  {
    competitionRaw: competitionFileA as RawCompetitionFile,
    fixturesRaw: fixturesFileA as RawFixturesFile,
    standingsRaw: standingsFileA as RawStandingsFile,
  },
  {
    competitionRaw: competitionFileB as RawCompetitionFile,
    fixturesRaw: fixturesFileB as RawFixturesFile,
    standingsRaw: standingsFileB as RawStandingsFile,
  },
];

const FIXTURES_BY_COMPETITION_ID: Record<CompetitionId, RawFixturesFile> = Object.fromEntries(
  DIVISIONS.map((d) => [d.competitionRaw.id, d.fixturesRaw]),
);

/** Ano da primeira temporada (snapshot real) — usado por `world.ts` pra semear a categoria de base inicial com o mesmo ano que `generateSeason` usaria. */
export const INITIAL_SEASON_YEAR = DIVISIONS[0].competitionRaw.season.year;

function buildFixtures(fixturesRaw: RawFixturesFile, dates: string[][]): Fixture[][] {
  return fixturesRaw.map((round, roundIndex) =>
    round.matches.map((match, matchIndex) => ({
      round: round.round,
      date: dates[roundIndex][matchIndex],
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
    })),
  );
}

function buildCalendar(fixturesRaw: RawFixturesFile, competitionId: string): CalendarEntry[] {
  return fixturesRaw.map((round) => ({ round: round.round, competitionId }));
}

/**
 * Posição inicial (1-indexada) de cada clube na SUA divisão, a partir do snapshot real de cada
 * uma — usado pelo `listClubs` do worker pra mostrar a posição real na tela de escolha de clube,
 * sem precisar montar uma `Season` inteira (que exige um `playerClubId` que ainda não existe
 * nesse ponto do fluxo).
 */
export function initialStandingsByClub(): Map<ClubId, { position: number; competitionId: CompetitionId; totalTeams: number }> {
  const map = new Map<ClubId, { position: number; competitionId: CompetitionId; totalTeams: number }>();
  for (const division of DIVISIONS) {
    const totalTeams = division.standingsRaw.standings.length;
    division.standingsRaw.standings.forEach((entry, index) => {
      map.set(entry.clubId, { position: index + 1, competitionId: division.competitionRaw.id, totalTeams });
    });
  }
  return map;
}

function buildCompetitionFromSnapshot(division: DivisionData): { competition: Competition; anchorSaturday: string } {
  const { competitionRaw, fixturesRaw, standingsRaw } = division;
  // Ancora a rodada atual (real, do snapshot) no sábado mais próximo — as demais rodadas ficam a
  // múltiplos de 7 dias de distância (uma rodada por semana, só sábado/domingo — ver calendar.ts).
  const anchorSaturday = nearestSaturdayOnOrAfter(standingsRaw.snapshotDate);
  const dates = assignFixtureDates(fixturesRaw, standingsRaw.currentRound, anchorSaturday);
  const fixtures = buildFixtures(fixturesRaw, dates);

  const standings: StandingEntry[] = standingsRaw.standings.map((entry) => ({
    clubId: entry.clubId,
    played: entry.played,
    won: entry.won,
    drawn: entry.drawn,
    lost: entry.lost,
    goalsFor: entry.goalsFor,
    goalsAgainst: entry.goalsAgainst,
    points: entry.points,
  }));

  const teams = standingsRaw.standings.map((entry) => entry.clubId);

  const competition: Competition = { id: competitionRaw.id, name: competitionRaw.name, teams, fixtures, standings };
  return { competition, anchorSaturday };
}

/**
 * Monta a temporada a partir dos dados reais das DUAS divisões (Série A e Série B): calendário
 * oficial completo de cada uma e a tabela real como ponto de partida (rodada atual em diante é
 * simulada pelo motor; rodadas anteriores entram apenas como saldo agregado em `standings`, sem
 * placar jogo a jogo). Usado só pra temporada 1 de uma carreira nova — pra temporadas seguintes
 * ver `generateNextSeason`, que não deve recair nesse snapshot real "no meio do campeonato".
 * `playerClubId` só decide o `currentRound` inicial exibido (rodada da divisão do clube
 * escolhido) — o resto é simétrico entre as duas competições.
 */
export function generateSeason(playerClubId: ClubId): Season {
  const built = DIVISIONS.map(buildCompetitionFromSnapshot);
  const earliestAnchor = built.reduce((min, b) => (b.anchorSaturday < min ? b.anchorSaturday : min), built[0].anchorSaturday);
  const calendar = DIVISIONS.flatMap((d, i) => buildCalendar(d.fixturesRaw, built[i].competition.id));

  const playerDivisionIndex = built.findIndex((b) => b.competition.teams.includes(playerClubId));
  const playerDivision = playerDivisionIndex === -1 ? DIVISIONS[0] : DIVISIONS[playerDivisionIndex];

  return {
    year: DIVISIONS[0].competitionRaw.season.year,
    calendar,
    competitions: built.map((b) => b.competition),
    state: 'in_progress',
    // O dia anterior ao sábado-âncora mais cedo entre as duas divisões — o avanço de tempo
    // (cursor = currentDate + 1) começa cedo o bastante pra alcançar a janela da rodada atual das duas.
    currentDate: addDays(earliestAnchor, -1),
    currentRound: playerDivision.standingsRaw.currentRound,
  };
}

/**
 * Monta a temporada seguinte a uma já encerrada (ver `seasonLifecycle.startNewSeason`):
 * reaproveita o mesmo calendário/confrontos de cada divisão (`fixtures.json` de cada uma — Série A
 * usa o calendário real da CBF, Série B usa um turno-returno sintético, ver
 * `brasileirao-serie-b-2026/competition.json`'s sourceNotes) com os times de `teamsByCompetitionId`
 * (já com acesso/rebaixamento aplicado — ver `startNewSeason`), mas com tabela zerada e a partir
 * da 1ª rodada.
 */
export function generateNextSeason(previousYear: number, teamsByCompetitionId: Record<CompetitionId, ClubId[]>): Season {
  const nextYear = previousYear + 1;

  const competitions: Competition[] = DIVISIONS.map((division) => {
    const teams = teamsByCompetitionId[division.competitionRaw.id] ?? division.standingsRaw.standings.map((e) => e.clubId);
    const standings: StandingEntry[] = teams.map((clubId) => ({
      clubId,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
    }));
    return { id: division.competitionRaw.id, name: division.competitionRaw.name, teams, fixtures: [], standings };
  });

  // Sem snapshot pra ancorar (temporada nova começa do zero, rodada 1) — reaproveita o início real
  // da temporada original de cada divisão (competition.json), deslocado pelos anos que se passaram,
  // pra não precisar de uma nova data "de verdade" hardcoded a cada temporada. As duas divisões
  // começam juntas no ano-calendário mais cedo entre as duas (na prática, a mesma janela).
  const anchors = DIVISIONS.map((division) => {
    const yearsElapsed = nextYear - division.competitionRaw.season.year;
    return nearestSaturdayOnOrAfter(shiftYear(division.competitionRaw.season.startDate, yearsElapsed));
  });
  const earliestAnchor = anchors.reduce((min, a) => (a < min ? a : min), anchors[0]);

  const calendar: CalendarEntry[] = [];
  DIVISIONS.forEach((division, i) => {
    const dates = assignFixtureDates(division.fixturesRaw, 1, anchors[i]);
    competitions[i].fixtures = buildFixtures(division.fixturesRaw, dates);
    calendar.push(...buildCalendar(division.fixturesRaw, competitions[i].id));
  });

  return {
    year: nextYear,
    calendar,
    competitions,
    state: 'in_progress',
    currentDate: addDays(earliestAnchor, -1),
    currentRound: 1,
  };
}

/**
 * Preenche `date`/`currentDate` num `Season` salvo antes do calendário real existir (ver
 * `engine.worker.ts`'s normalização de `setCareer`). Sem o snapshot original pra reancorar, usa a
 * rodada já salva (`competition.fixtures`' índice) e a data real de hoje como âncora — zipa as
 * datas geradas posicionalmente contra o `fixtures.json` DA COMPETIÇÃO CORRESPONDENTE (por id —
 * cada divisão tem o seu, as fixtures nunca são reordenadas depois de criadas, então o índice de
 * rodada/partida do save ainda bate com o arquivo real daquela competição). Só afeta saves de
 * antes do calendário real existir — por definição, saves assim têm sempre uma única competição
 * (Série A), de antes da Série B existir, então `season.currentRound` serve como âncora pra ela.
 */
export function backfillFixtureDates(season: Season, todayIso: string): Season {
  const anchorSaturday = nearestSaturdayOnOrAfter(todayIso);

  return {
    ...season,
    currentDate: addDays(anchorSaturday, -1),
    competitions: season.competitions.map((competition) => {
      const fixturesRaw = FIXTURES_BY_COMPETITION_ID[competition.id] ?? FIXTURES_BY_COMPETITION_ID[DIVISIONS[0].competitionRaw.id];
      const dates = assignFixtureDates(fixturesRaw, season.currentRound, anchorSaturday);
      return {
        ...competition,
        fixtures: competition.fixtures.map((round, roundIndex) =>
          round.map((fixture, matchIndex) => ({ ...fixture, date: dates[roundIndex]?.[matchIndex] ?? todayIso })),
        ),
      };
    }),
  };
}
