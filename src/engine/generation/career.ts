import type { CareerState, Trainer } from '../types/career';
import type { ClubId } from '../types/club';
import { generateWorld } from './world';
import { generateSeason } from './season';

export function createBrasileiraoCareer(
  seed: number,
  trainer: Trainer,
  playerClubId: ClubId,
): CareerState {
  return {
    seed,
    trainer,
    playerClubId,
    world: generateWorld(seed),
    season: generateSeason(),
    history: [],
  };
}
