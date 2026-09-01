// Categorias de base: geração procedural de jovens promessas (15-18 anos) por clube — ver
// `Club.academySquad` (types/club.ts) pra como elas ficam fora do elenco principal, e
// `simulation/academy.ts` pra como intake/crescimento/liberação são orquestrados a cada temporada.

import { mulberry32, roll, pick, deriveSeed } from '../rng';
import type { Club } from '../types/club';
import type { Player } from '../types/player';
import { POSITIONS } from '../types/player';
import { ACADEMY_MAX_AGE, ACADEMY_MAX_INTAKE, ACADEMY_MIN_AGE, ACADEMY_MIN_INTAKE } from '../simulation/config';
import { generatePlayerDerived, playerSeed } from './attributes';
import { randomAcademyPlayerName } from './academyNames';

/**
 * Gera o lote de novas promessas de UM clube pra UM ano — usado tanto na criação do mundo
 * (`world.ts`, ano inicial, pra categoria de base não começar vazia) quanto a cada virada de
 * temporada (`simulation/academy.ts`, chamado por `startNewSeason`). Mesma seed global da
 * carreira + `playerSeed` por id: determinístico, mesma carreira sempre gera o mesmo lote pro
 * mesmo clube/ano. Posição sorteada uniformemente (uma base não escolhe quem aparece) e
 * atributos/potencial vêm do mesmo `generatePlayerDerived` usado pros jogadores reais sem dado
 * EA FC (reputação do clube como teto, folga de potencial maior quanto mais novo).
 */
export function generateAcademyIntake(seed: number, club: Pick<Club, 'id' | 'reputation'>, year: number): Player[] {
  const intakeRng = mulberry32(deriveSeed(seed, `${club.id}-academy-intake-${year}`));
  const count = roll(intakeRng, ACADEMY_MIN_INTAKE, ACADEMY_MAX_INTAKE);

  const players: Player[] = [];
  for (let i = 0; i < count; i++) {
    const id = `${club.id}-academy-${year}-${i + 1}`;
    const rng = mulberry32(playerSeed(seed, id));
    const age = roll(rng, ACADEMY_MIN_AGE, ACADEMY_MAX_AGE);
    const position = pick(rng, POSITIONS);
    const derived = generatePlayerDerived(rng, position, age, club.reputation);

    players.push({
      id,
      name: randomAcademyPlayerName(rng),
      age,
      birthYear: year - age,
      marketValue: 0,
      nationality: 'Brasil',
      position,
      secondaryPositions: [],
      strength: derived.strength,
      attributes: derived.attributes,
      condition: derived.condition,
      morale: derived.morale,
      potential: derived.potential,
      seasonStats: { appearances: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0, saves: 0, minutesPlayed: 0 },
      pendingYellowCards: 0,
      suspendedMatches: 0,
    });
  }
  return players;
}
