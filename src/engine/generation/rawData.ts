import type { Position } from '../types/player';
import type { Formation, TacticStyle } from '../types/tactics';

/**
 * Atributos FIFA (0-99) extraídos do squad file do EA FC 26 via engenharia
 * reversa do formato FBCHUNKS/T3DB. Presentes só nos jogadores que
 * conseguimos casar com o mod real (ver memória do projeto / TODO.md).
 */
export interface RawFifaAttributes {
  acceleration?: number;
  sprintspeed?: number;
  agility?: number;
  balance?: number;
  reactions?: number;
  jumping?: number;
  stamina?: number;
  strength?: number;
  aggression?: number;
  positioning?: number;
  ballcontrol?: number;
  dribbling?: number;
  crossing?: number;
  finishing?: number;
  headingaccuracy?: number;
  shortpassing?: number;
  volleys?: number;
  curve?: number;
  freekickaccuracy?: number;
  longpassing?: number;
  longshots?: number;
  shotpower?: number;
  vision?: number;
  penalties?: number;
  composure?: number;
  interceptions?: number;
  standingtackle?: number;
  slidingtackle?: number;
  defensiveawareness?: number;
  gkdiving?: number;
  gkhandling?: number;
  gkkicking?: number;
  gkpositioning?: number;
  gkreflexes?: number;
}

/** Formato dos arquivos brutos coletados em src/data/brasileirao-2026/*.json. */
export interface RawSquadPlayer {
  name: string;
  shirtNumber: number | null;
  position: Position;
  secondaryPositions: Position[];
  nationality: string;
  birthYear: number | null;
  age: number;
  /** Valor de mercado em EUR (Transfermarkt), quando conhecido — null/ausente = não informado. */
  marketValue?: number | null;
  notes: string;
  /** Overall real (EA FC 26), quando casado com o mod. Ausente = geração procedural. */
  overall?: number;
  potential?: number;
  height?: number;
  weight?: number;
  preferredFoot?: 'right' | 'left';
  weakFoot?: number;
  attributes?: RawFifaAttributes;
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
    /** Formação/estilo real do time no último jogo disputado, quando pesquisado (ver sourceNotes) — ausente = usa DEFAULT_AUTO_TACTICS em season.ts. */
    formation?: Formation;
    style?: TacticStyle;
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
  season: { year: number; startDate: string; endDate: string };
}
