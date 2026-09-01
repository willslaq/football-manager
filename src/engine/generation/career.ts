import type { CareerState, Trainer } from '../types/career';
import type { ClubId } from '../types/club';
import type { TacticalIntensity } from '../types/tactics';
import { generateWorld } from './world';
import { generateSeason } from './season';

export function createBrasileiraoCareer(
  seed: number,
  trainer: Trainer,
  playerClubId: ClubId,
  tacticalIntensity: TacticalIntensity = 'subtle',
): CareerState {
  return {
    seed,
    trainer,
    playerClubId,
    world: generateWorld(seed),
    season: generateSeason(playerClubId),
    history: [],
    settings: { tacticalIntensity },
  };
}

/** Muda o quanto o motor pesa formação/estilo na simulação — configuração do save, ajustável a qualquer momento. */
export function setTacticalIntensity(state: CareerState, tacticalIntensity: TacticalIntensity): CareerState {
  return { ...state, settings: { ...state.settings, tacticalIntensity } };
}
