import type { ClubId, Club } from './club';
import type { Player } from './player';
import type { Season } from './season';
import type { CompetitionId } from './competition';

export interface World {
  clubs: Club[];
  players: Player[];
}

export interface Trainer {
  id: string;
  name: string;
}

export interface CareerHistoryEntry {
  year: number;
  competitionId: CompetitionId;
  champion: ClubId;
}

/** Raiz serializável da carreira — este objeto inteiro é o save. */
export interface CareerState {
  seed: number;
  trainer: Trainer;
  playerClubId: ClubId;
  world: World;
  season: Season;
  history: CareerHistoryEntry[];
}
