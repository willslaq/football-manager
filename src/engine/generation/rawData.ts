import type { Position } from '../types/player';

/** Formato dos arquivos brutos coletados em src/data/brasileirao-2026/*.json. */
export interface RawSquadPlayer {
  name: string;
  shirtNumber: number | null;
  position: Position;
  secondaryPositions: Position[];
  nationality: string;
  birthYear: number | null;
  age: number;
  notes: string;
}

export interface RawClubFile {
  club: {
    id: string;
    name: string;
    shortName: string;
    city: string;
    state: string;
    founded: number;
    stadium: string;
    stadiumCapacity: number;
    colors: { primary: string; secondary: string };
  };
  squad: RawSquadPlayer[];
  sourceNotes: string;
}

export interface RawStandingEntry {
  clubId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

export interface RawStandingsFile {
  snapshotDate: string;
  currentRound: number;
  totalRounds: number;
  standings: RawStandingEntry[];
}

export interface RawFixtureMatch {
  homeTeamId: string;
  awayTeamId: string;
}

export interface RawFixtureRound {
  round: number;
  matches: RawFixtureMatch[];
}

export type RawFixturesFile = RawFixtureRound[];

export interface RawCompetitionFile {
  id: string;
  name: string;
  season: { year: number };
}
