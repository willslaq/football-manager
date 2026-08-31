import type { Player } from '../engine/types';

export interface LineupStatus {
  assignedIds: string[];
  hasGoalkeeper: boolean;
  isValid: boolean;
}

/** Mesma regra usada pela Escalação (carreira) e pelo Amistoso: 11 titulares com pelo menos um goleiro. */
export function computeLineupStatus(
  assignments: Record<string, string | null>,
  playersById: Map<string, Player>,
): LineupStatus {
  const assignedIds = [...new Set(Object.values(assignments).filter((id): id is string => !!id))];
  const assignedPlayers = assignedIds.map((id) => playersById.get(id)).filter((p): p is Player => !!p);
  const hasGoalkeeper = assignedPlayers.some((p) => p.position === 'GOL');
  return { assignedIds, hasGoalkeeper, isValid: assignedIds.length === 11 && hasGoalkeeper };
}
