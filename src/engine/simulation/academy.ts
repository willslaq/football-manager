// Orquestra a categoria de base a cada virada de temporada (intake + liberação por idade) e a
// promoção manual de uma promessa ao elenco principal — ver `generation/academy.ts` pra como o
// lote de novas promessas é gerado e `Club.academySquad` (types/club.ts) pro modelo de dados.

import { generateAcademyIntake } from '../generation/academy';
import type { CareerState } from '../types/career';
import type { Club, ClubId } from '../types/club';
import type { Player, PlayerId } from '../types/player';
import { ACADEMY_RELEASE_AGE } from './config';

export interface AcademyTransition {
  /** Clubes com `academySquad` já podado (liberados removidos) e com o intake do próximo ano anexado. */
  clubs: Club[];
  /** Ids de promessas liberadas por idade nesse corte — remover de `world.players`. */
  releasedPlayerIds: Set<PlayerId>;
  /** Novas promessas geradas pra `nextYear` — anexar em `world.players`. */
  newPlayers: Player[];
}

/**
 * Chamado por `startNewSeason` ANTES de aplicar `age = nextYear - birthYear` no resto do mundo —
 * calcula a idade de liberação diretamente de `birthYear` (estável), então não depende de ordem
 * com o passe de envelhecimento dos jogadores do elenco principal.
 */
export function advanceAcademies(state: CareerState, nextYear: number): AcademyTransition {
  const playersById = new Map(state.world.players.map((p) => [p.id, p]));
  const clubs: Club[] = [];
  const releasedPlayerIds = new Set<PlayerId>();
  const newPlayers: Player[] = [];

  for (const club of state.world.clubs) {
    const kept: PlayerId[] = [];
    for (const id of club.academySquad ?? []) {
      const player = playersById.get(id);
      if (!player) continue;
      if (nextYear - player.birthYear >= ACADEMY_RELEASE_AGE) {
        releasedPlayerIds.add(id);
      } else {
        kept.push(id);
      }
    }

    const intake = generateAcademyIntake(state.seed, club, nextYear);
    newPlayers.push(...intake);
    clubs.push({ ...club, academySquad: [...kept, ...intake.map((p) => p.id)] });
  }

  return { clubs, releasedPlayerIds, newPlayers };
}

/** Move uma promessa de `academySquad` pra `squad` — sem teto de elenco (ver decisão registrada na memória do projeto). Estado inalterado se o clube ou a promessa não existir nele. */
export function promotePlayer(state: CareerState, clubId: ClubId, playerId: PlayerId): CareerState {
  let changed = false;
  const clubs = state.world.clubs.map((club) => {
    if (club.id !== clubId || !(club.academySquad ?? []).includes(playerId)) return club;
    changed = true;
    return {
      ...club,
      academySquad: (club.academySquad ?? []).filter((id) => id !== playerId),
      squad: [...club.squad, playerId],
    };
  });
  if (!changed) return state;
  return { ...state, world: { ...state.world, clubs } };
}
