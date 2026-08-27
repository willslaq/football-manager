import type { Formation } from '../types/tactics';
import type { Player } from '../types/player';
import { positionSector } from './strength';

function sortByStrengthDesc(players: Player[]): Player[] {
  return [...players].sort((a, b) => b.strength - a.strength);
}

export function sectorSlotCounts(formation: Formation): { defense: number; midfield: number; attack: number } {
  const parts = formation.split('-').map(Number);
  return {
    defense: parts[0],
    attack: parts[parts.length - 1],
    midfield: parts.slice(1, -1).reduce((a, b) => a + b, 0),
  };
}

/**
 * Escalação automática simples: melhor goleiro disponível + melhores jogadores
 * por setor respeitando a formação. Usada para times sem escalação manual do
 * jogador (SRS M4) e para testar o motor de partida (M3).
 */
export function pickAutoLineup(squad: Player[], formation: Formation): Player[] {
  const goalkeeper = sortByStrengthDesc(squad.filter((p) => positionSector(p.position) === 'goalkeeper'))[0];
  const slots = sectorSlotCounts(formation);

  const defenders = sortByStrengthDesc(squad.filter((p) => positionSector(p.position) === 'defense'));
  const midfielders = sortByStrengthDesc(squad.filter((p) => positionSector(p.position) === 'midfield'));
  const attackers = sortByStrengthDesc(squad.filter((p) => positionSector(p.position) === 'attack'));

  const starters: Player[] = [];
  if (goalkeeper) starters.push(goalkeeper);
  starters.push(...defenders.slice(0, slots.defense));
  starters.push(...midfielders.slice(0, slots.midfield));
  starters.push(...attackers.slice(0, slots.attack));

  if (starters.length < 11) {
    const chosenIds = new Set(starters.map((p) => p.id));
    const remaining = sortByStrengthDesc(squad.filter((p) => !chosenIds.has(p.id)));
    starters.push(...remaining.slice(0, 11 - starters.length));
  }

  return starters.slice(0, 11);
}
