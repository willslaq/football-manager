import type { ClubId } from '../types/club';
import type { CalendarEntry } from '../types/season';
import type { Season } from '../types/season';
import type { Competition, Fixture, StandingEntry } from '../types/competition';
import type { RawCompetitionFile, RawFixturesFile, RawStandingsFile } from './rawData';
import competitionFile from '../../data/brasileirao-2026/competition.json';
import fixturesFile from '../../data/brasileirao-2026/fixtures.json';
import standingsFile from '../../data/brasileirao-2026/standings-current.json';

function buildFixtures(fixturesRaw: RawFixturesFile): Fixture[][] {
  return fixturesRaw.map((round) =>
    round.matches.map((match) => ({
      round: round.round,
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

  const fixtures = buildFixtures(fixturesRaw);

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

  const fixtures = buildFixtures(fixturesRaw);
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
    year: previousYear + 1,
    calendar: buildCalendar(fixturesRaw, competition.id),
    competitions: [competition],
    state: 'in_progress',
    currentRound: 1,
  };
}
