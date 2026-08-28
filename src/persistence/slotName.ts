import type { CareerState } from '../engine/types';

/** Nome de slot padrão sugerido pra um save novo, quando o jogador ainda não escolheu um. */
export function defaultSlotName(career: CareerState): string {
  const club = career.world.clubs.find((c) => c.id === career.playerClubId);
  return `${club?.name ?? career.playerClubId} - ${career.trainer.name}`;
}
