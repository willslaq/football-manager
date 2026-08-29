import type { ClubId } from '../types/club';
import type { CalendarEntry } from '../types/season';
import type { Season } from '../types/season';
import type { Competition, Fixture, StandingEntry } from '../types/competition';
import { addDays, assignFixtureDates, nearestSaturdayOnOrAfter, shiftYear } from './calendar';
import type { RawCompetitionFile, RawFixturesFile, RawStandingsFile } from './rawData';
import competitionFile from '../../data/brasileirao-2026/competition.json';
import fixturesFile from '../../data/brasileirao-2026/fixtures.json';
import standingsFile from '../../data/brasileirao-2026/standings-current.json';

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
 * Monta a temporada a partir dos dados reais: calendário oficial completo
 * (38 rodadas, CBF) e a tabela real como ponto de partida (rodada atual em
 * diante é simulada pelo motor; rodadas anteriores entram apenas como saldo
 * agregado em `standings`, sem placar jogo a jogo). Usado só pra temporada 1
 * de uma carreira nova — pra temporadas seguintes ver `generateNextSeason`,
 * que não deve recair nesse snapshot real "no meio do campeonato".
 */
export function generateSeason(): Season {
  const competitionRaw = competitionFile as RawCompetitionFile;
  const fixturesRaw = fixturesFile as RawFixturesFile;
  const standingsRaw = standingsFile as RawStandingsFile;

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

  const competition: Competition = {
    id: competitionRaw.id,
    name: competitionRaw.name,
    teams,
    fixtures,
    standings,
  };

  return {
    year: competitionRaw.season.year,
    calendar: buildCalendar(fixturesRaw, competition.id),
    competitions: [competition],
    state: 'in_progress',
    // O dia anterior ao sábado-âncora — o avanço de tempo (cursor = currentDate + 1) começa
    // exatamente na janela da rodada atual.
    currentDate: addDays(anchorSaturday, -1),
    currentRound: standingsRaw.currentRound,
  };
}

/**
 * Monta a temporada seguinte a uma já encerrada (ver `seasonLifecycle.startNewSeason`):
 * reaproveita o mesmo calendário/confrontos (`fixtures.json` — não temos um gerador de
 * turno/returno à parte, e o calendário real já é um round-robin duplo válido) e os
 * mesmos clubes (rebaixamento é só informativo — sem dados da Série B pra promover
 * substitutos, ver TODO.md), mas com tabela zerada e a partir da 1ª rodada.
 */
export function generateNextSeason(previousYear: number, teams: ClubId[]): Season {
  const competitionRaw = competitionFile as RawCompetitionFile;
  const fixturesRaw = fixturesFile as RawFixturesFile;

  // Sem snapshot pra ancorar (temporada nova começa do zero, rodada 1) — reaproveita o início
  // real da temporada original (competition.json), deslocado pelos anos que se passaram, pra não
  // precisar de uma nova data "de verdade" hardcoded a cada temporada.
  const nextYear = previousYear + 1;
  const yearsElapsed = nextYear - competitionRaw.season.year;
  const anchorSaturday = nearestSaturdayOnOrAfter(shiftYear(competitionRaw.season.startDate, yearsElapsed));
  const dates = assignFixtureDates(fixturesRaw, 1, anchorSaturday);
  const fixtures = buildFixtures(fixturesRaw, dates);
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

  const competition: Competition = {
    id: competitionRaw.id,
    name: competitionRaw.name,
    teams,
    fixtures,
    standings,
  };

  return {
    year: nextYear,
    calendar: buildCalendar(fixturesRaw, competition.id),
    competitions: [competition],
    state: 'in_progress',
    currentDate: addDays(anchorSaturday, -1),
    currentRound: 1,
  };
}

/**
 * Preenche `date`/`currentDate` num `Season` salvo antes do calendário real existir (ver
 * `engine.worker.ts`'s normalização de `setCareer`). Sem o snapshot original pra reancorar,
 * usa a rodada já salva (`season.currentRound`) e a data real de hoje como âncora — zipa as
 * datas geradas posicionalmente contra `fixtures.json` (as fixtures nunca são reordenadas
 * depois de criadas, então o índice de rodada/partida do save ainda bate com o arquivo real).
 */
export function backfillFixtureDates(season: Season, todayIso: string): Season {
  const fixturesRaw = fixturesFile as RawFixturesFile;
  const anchorSaturday = nearestSaturdayOnOrAfter(todayIso);
  const dates = assignFixtureDates(fixturesRaw, season.currentRound, anchorSaturday);

  return {
    ...season,
    currentDate: addDays(anchorSaturday, -1),
    competitions: season.competitions.map((competition) => ({
      ...competition,
      fixtures: competition.fixtures.map((round, roundIndex) =>
        round.map((fixture, matchIndex) => ({ ...fixture, date: dates[roundIndex]?.[matchIndex] ?? todayIso })),
      ),
    })),
  };
}
