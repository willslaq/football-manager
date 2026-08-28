import type { Formation, Player, PlayerId, Position } from '../types';
import { effectiveOverall } from './positionFit';

export interface Slot {
  id: string;
  sectorLabel: string;
  preferred: Position[];
  /** Posição exata que essa vaga representa na formação, pra validar encaixe. */
  canonical: Position;
}

/** Linha de defesa: 3 zagueiros puros, 4 com laterais, 5 com alas avançados. */
function defCanonical(count: number): Position[] {
  if (count === 4) return ['LE', 'ZAG', 'ZAG', 'LD'];
  if (count === 5) return ['ALE', 'ZAG', 'ZAG', 'ZAG', 'ALD'];
  return Array.from({ length: count }, () => 'ZAG' as Position);
}

/**
 * Linha única de meio-campo (sem split volante/ofensivo). Com 5 jogadores,
 * o formato depende da defesa: time de 3 zagueiros usa alas (3-5-2), time
 * de 4 usa pontas tradicionais (4-5-1).
 */
function midCanonical(count: number, def: number): Position[] {
  if (count === 2) return ['VOL', 'VOL'];
  if (count === 3) return ['VOL', 'MC', 'MC'];
  if (count === 4) return ['ME', 'VOL', 'MC', 'MD'];
  if (count === 5) return def === 3 ? ['ALE', 'VOL', 'MC', 'MC', 'ALD'] : ['ME', 'VOL', 'MC', 'MC', 'MD'];
  return Array.from({ length: count }, () => 'MC' as Position);
}

/** Trinca ofensiva atrás do centroavante (ex.: 4-2-3-1). */
function amidCanonical(count: number): Position[] {
  if (count === 3) return ['ME', 'MEA', 'MD'];
  return Array.from({ length: count }, () => 'MEA' as Position);
}

function attCanonical(count: number): Position[] {
  if (count === 1) return ['CA'];
  if (count === 2) return ['SA', 'CA'];
  if (count === 3) return ['PE', 'CA', 'PD'];
  return Array.from({ length: count }, () => 'CA' as Position);
}

/** Vagas fixas da formação — sempre as mesmas 11, ocupadas ou não. */
export function buildSlots(formation: Formation): Slot[] {
  const parts = formation.split('-').map(Number);
  const def = parts[0];
  const att = parts[parts.length - 1];
  const midParts = parts.slice(1, -1);

  const sectors: { key: string; label: string; count: number; preferred: Position[]; canonical: Position[] }[] = [
    { key: 'gk', label: 'Goleiro', count: 1, preferred: ['GOL'], canonical: ['GOL'] },
    {
      key: 'def',
      label: 'Zagueiro/Lateral',
      count: def,
      preferred: ['ZAG', 'LD', 'LE', 'ALD', 'ALE'],
      canonical: defCanonical(def),
    },
  ];

  if (midParts.length === 2) {
    sectors.push({
      key: 'dmid',
      label: 'Volante',
      count: midParts[0],
      preferred: ['VOL', 'MC'],
      canonical: midCanonical(midParts[0], def),
    });
    sectors.push({
      key: 'amid',
      label: 'Meia-ofensivo',
      count: midParts[1],
      preferred: ['MEA', 'MC', 'MD', 'ME'],
      canonical: amidCanonical(midParts[1]),
    });
  } else {
    sectors.push({
      key: 'mid',
      label: 'Meio-campo',
      count: midParts[0] ?? 0,
      preferred: ['VOL', 'MC', 'MD', 'ME', 'MEA'],
      canonical: midCanonical(midParts[0] ?? 0, def),
    });
  }

  sectors.push({
    key: 'att',
    label: 'Atacante',
    count: att,
    preferred: ['CA', 'SA', 'PD', 'PE'],
    canonical: attCanonical(att),
  });

  const renderOrder = ['att', 'amid', 'mid', 'dmid', 'def', 'gk'];
  return renderOrder.flatMap((key) => {
    const sector = sectors.find((s) => s.key === key);
    if (!sector) return [];
    return Array.from({ length: sector.count }, (_, i) => ({
      id: `${sector.key}-${i}`,
      sectorLabel: sector.label,
      preferred: sector.preferred,
      canonical: sector.canonical[i] ?? sector.preferred[0],
    }));
  });
}

/**
 * Encaixe inicial/reencaixe ao trocar de formação: de trás pra frente (gol →
 * defesa → meio → ataque), cada setor pega, por força, quem já joga ali;
 * quem sobra (a formação tem menos vagas naquele setor do que jogadores
 * daquele tipo) avança pro setor seguinte, mais ofensivo.
 */
export function assignToSlots(slots: Slot[], starters: Player[]): Record<string, PlayerId | null> {
  const assignments: Record<string, PlayerId | null> = {};
  for (const slot of slots) assignments[slot.id] = null;

  const bySectorOrder = ['gk', 'def', 'dmid', 'mid', 'amid', 'att'];
  const slotsBySector = bySectorOrder
    .map((key) => slots.filter((s) => s.id.startsWith(`${key}-`)))
    .filter((group) => group.length > 0);

  let pool = [...starters];
  slotsBySector.forEach((group, index) => {
    const preferred = group[0].preferred;
    const isLast = index === slotsBySector.length - 1;
    const ownMatches = pool.filter((p) => preferred.includes(p.position));
    const rest = pool.filter((p) => !preferred.includes(p.position));

    if (isLast) {
      const combined = [...ownMatches, ...rest];
      group.forEach((slot, i) => {
        assignments[slot.id] = combined[i]?.id ?? null;
      });
      pool = [];
    } else {
      const taken = ownMatches.slice(0, group.length);
      const borrowed = rest.slice(0, group.length - taken.length);
      const combined = [...taken, ...borrowed];
      group.forEach((slot, i) => {
        assignments[slot.id] = combined[i]?.id ?? null;
      });
      pool = [...ownMatches.slice(taken.length), ...rest.slice(borrowed.length)];
    }
  });

  return assignments;
}

/**
 * Auto-escalação: pra cada vaga, escolhe o jogador disponível com maior
 * overall efetivo naquela posição exata (principal > secundária > parecida
 * > ruim). Guloso por par (vaga, jogador) de maior score global, repetido
 * até preencher as 11 vagas — assim o goleiro nato sempre fica com o gol
 * (jogador de linha ali cairia muito no score) e as demais vagas ficam com
 * quem realmente rende mais ali, não só com quem tem maior força bruta.
 *
 * A matriz de scores (vaga × jogador) é calculada uma única vez e reduzida
 * a cada escolha — recalcular `effectiveOverall` a cada uma das 11
 * iterações custava O(vagas² × elenco), caro o bastante pra estourar o
 * orçamento de `advanceRound` (RNF-001) agora que os ~19 times de CPU
 * também passam por aqui a cada rodada, não só a escalação manual do
 * jogador.
 */
export function autoAssign(slots: Slot[], squad: Player[]): Record<string, PlayerId | null> {
  const assignments: Record<string, PlayerId | null> = {};
  for (const slot of slots) assignments[slot.id] = null;

  const remainingSlots = [...slots];
  const remainingPlayers = [...squad];
  const scores = remainingSlots.map((slot) => remainingPlayers.map((player) => effectiveOverall(player, slot.canonical)));

  while (remainingSlots.length > 0 && remainingPlayers.length > 0) {
    let bestSlotIndex = -1;
    let bestPlayerIndex = -1;
    let bestScore = -Infinity;

    for (let si = 0; si < remainingSlots.length; si++) {
      const row = scores[si];
      for (let pi = 0; pi < remainingPlayers.length; pi++) {
        if (row[pi] > bestScore) {
          bestScore = row[pi];
          bestSlotIndex = si;
          bestPlayerIndex = pi;
        }
      }
    }

    if (bestSlotIndex === -1) break;
    assignments[remainingSlots[bestSlotIndex].id] = remainingPlayers[bestPlayerIndex].id;
    remainingSlots.splice(bestSlotIndex, 1);
    remainingPlayers.splice(bestPlayerIndex, 1);
    scores.splice(bestSlotIndex, 1);
    for (const row of scores) row.splice(bestPlayerIndex, 1);
  }

  return assignments;
}

/** Converte um mapeamento vaga→jogador na posição canônica de cada jogador, pra alimentar o motor de partida. */
export function slotPositionsByPlayer(
  slots: Slot[],
  assignments: Record<string, PlayerId | null>,
): Record<PlayerId, Position> {
  const result: Record<PlayerId, Position> = {};
  for (const slot of slots) {
    const playerId = assignments[slot.id];
    if (playerId) result[playerId] = slot.canonical;
  }
  return result;
}
