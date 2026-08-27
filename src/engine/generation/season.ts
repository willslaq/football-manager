import type { CalendarEntry } from '../types/season';
import type { Season } from '../types/season';
import type { Competition, Fixture, StandingEntry } from '../types/competition';
import type { RawCompetitionFile, RawFixturesFile, RawStandingsFile } from './rawData';
import competitionFile from '../../data/brasileirao-2026/competition.json';
import fixturesFile from '../../data/brasileirao-2026/fixtures.json';
import standingsFile from '../../data/brasileirao-2026/standings-current.json';

/**
 * Monta a temporada a partir dos dados reais: calendário oficial completo
 * (38 rodadas, CBF) e a tabela real como ponto de partida (rodada atual em
 * diante é simulada pelo motor; rodadas anteriores entram apenas como saldo
 * agregado em `standings`, sem placar jogo a jogo).
 */
export function generateSeason(): Season {
  const competitionRaw = competitionFile as RawCompetitionFile;
  const fixturesRaw = fixturesFile as RawFixturesFile;
  const standingsRaw = standingsFile as RawStandingsFile;

  const fixtures: Fixture[][] = fixturesRaw.map((round) =>
    round.matches.map((match) => ({
      round: round.round,
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
    })),
  );

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

  const calendar: CalendarEntry[] = fixturesRaw.map((round) => ({
    round: round.round,
    competitionId: competition.id,
  }));

  return {
    year: competitionRaw.season.year,
    calendar,
    competitions: [competition],
    state: 'in_progress',
    currentRound: standingsRaw.currentRound,
  };
}
