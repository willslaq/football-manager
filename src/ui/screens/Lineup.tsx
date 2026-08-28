import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { FORMATIONS, TACTIC_STYLE_LABELS, TACTIC_STYLES } from '../../engine/types';
import type { Formation, Player, Position, TacticStyle } from '../../engine/types';
import { useCareerStore } from '../../store/careerStore';
import { resolveSquad } from '../utils';
import { positionFit, effectiveOverall } from '../positionFit';
import { Button, Card } from '../components';
import './Lineup.css';

interface Slot {
  id: string;
  sectorLabel: string;
  preferred: Position[];
  /** Posição exata que essa vaga representa na formação, pra validar encaixe. */
  canonical: Position;
}

/** Ordem de cima (ataque) para baixo (goleiro), como visto olhando pro campo. */
const RENDER_ORDER = ['att', 'amid', 'mid', 'dmid', 'def', 'gk'];

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
function buildSlots(formation: Formation): Slot[] {
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

  return RENDER_ORDER.flatMap((key) => {
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
function assignToSlots(slots: Slot[], starters: Player[]): Record<string, string | null> {
  const assignments: Record<string, string | null> = {};
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
 * overall efetivo naquela posição exata (natural > parecida > ruim).
 * Guloso por par (vaga, jogador) de maior score global, repetido até
 * preencher as 11 vagas — assim o goleiro nato sempre fica com o gol
 * (jogador de linha ali cairia muito no score) e as demais vagas ficam
 * com quem realmente rende mais ali, não só com quem tem maior força bruta.
 */
function autoAssign(slots: Slot[], squad: Player[]): Record<string, string | null> {
  const assignments: Record<string, string | null> = {};
  for (const slot of slots) assignments[slot.id] = null;

  const remainingSlots = [...slots];
  const remainingPlayers = [...squad];

  while (remainingSlots.length > 0 && remainingPlayers.length > 0) {
    let bestSlotIndex = -1;
    let bestPlayerIndex = -1;
    let bestScore = -Infinity;

    remainingSlots.forEach((slot, si) => {
      remainingPlayers.forEach((player, pi) => {
        const score = effectiveOverall(player.strength, positionFit(player.position, slot.canonical));
        if (score > bestScore) {
          bestScore = score;
          bestSlotIndex = si;
          bestPlayerIndex = pi;
        }
      });
    });

    if (bestSlotIndex === -1) break;
    assignments[remainingSlots[bestSlotIndex].id] = remainingPlayers[bestPlayerIndex].id;
    remainingSlots.splice(bestSlotIndex, 1);
    remainingPlayers.splice(bestPlayerIndex, 1);
  }

  return assignments;
}

export function Lineup() {
  const career = useCareerStore((s) => s.career);
  const lineup = useCareerStore((s) => s.lineup);
  const tactics = useCareerStore((s) => s.tactics);
  const setLineup = useCareerStore((s) => s.setLineup);
  const setTactics = useCareerStore((s) => s.setTactics);
  const autoSaveEnabled = useCareerStore((s) => s.autoSaveEnabled);
  const saveCurrentCareer = useCareerStore((s) => s.saveCurrentCareer);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const squad = useMemo(
    () => (career ? resolveSquad(career, career.playerClubId).sort((a, b) => b.strength - a.strength) : []),
    [career],
  );
  const playersById = useMemo(() => new Map(squad.map((p) => [p.id, p])), [squad]);

  const [assignments, setAssignments] = useState<Record<string, string | null>>(() => {
    const startersNow = (lineup?.starters ?? []).map((id) => playersById.get(id)).filter((p): p is Player => !!p);
    return assignToSlots(buildSlots(tactics.formation), startersNow);
  });
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);
  const skipNextFormationReshape = useRef(true);

  const slots = useMemo(() => buildSlots(tactics.formation), [tactics.formation]);

  useEffect(() => {
    if (skipNextFormationReshape.current) {
      skipNextFormationReshape.current = false;
      return;
    }
    setAssignments((prev) => {
      const current = Object.values(prev)
        .filter((id): id is string => !!id)
        .map((id) => playersById.get(id))
        .filter((p): p is Player => !!p)
        .sort((a, b) => b.strength - a.strength);
      return assignToSlots(slots, current);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tactics.formation]);

  useEffect(() => {
    if (!lineup) return;
    const ids = Object.values(assignments).filter((id): id is string => !!id);
    const assigned = ids.map((id) => playersById.get(id)).filter((p): p is Player => !!p);
    const bestFinisher = [...assigned].sort((a, b) => b.attributes.finishing - a.attributes.finishing)[0];
    setLineup({
      starters: ids,
      formation: tactics.formation,
      captain: ids[0] ?? '',
      penaltyTaker: bestFinisher?.id ?? ids[0] ?? '',
      freeKickTaker: bestFinisher?.id ?? ids[0] ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments]);

  if (!career || !lineup) return null;

  const assignedIds = new Set(Object.values(assignments).filter((id): id is string => !!id));
  const assignedPlayers = [...assignedIds].map((id) => playersById.get(id)).filter((p): p is Player => !!p);
  const hasGoalkeeper = assignedPlayers.some((p) => p.position === 'GOL');
  const isValid = assignedIds.size === 11 && hasGoalkeeper;

  function assignPlayerToSlot(playerId: string, targetSlotId: string) {
    setAssignments((prev) => {
      if (prev[targetSlotId] === playerId) return prev;
      const sourceSlotId = Object.keys(prev).find((k) => prev[k] === playerId);
      const displaced = prev[targetSlotId] ?? null;
      const next = { ...prev, [targetSlotId]: playerId };
      if (sourceSlotId && sourceSlotId !== targetSlotId) {
        next[sourceSlotId] = displaced;
      }
      return next;
    });
  }

  function clearSlot(slotId: string) {
    setAssignments((prev) => ({ ...prev, [slotId]: null }));
  }

  function handleSidebarClick(player: Player) {
    const currentSlotId = Object.keys(assignments).find((k) => assignments[k] === player.id);
    if (currentSlotId) {
      clearSlot(currentSlotId);
      return;
    }
    const emptySlots = slots.filter((s) => !assignments[s.id]);
    if (emptySlots.length === 0) return;
    const bestFit = emptySlots.find((s) => s.preferred.includes(player.position)) ?? emptySlots[0];
    assignPlayerToSlot(player.id, bestFit.id);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, slotId: string) {
    e.preventDefault();
    setDragOverSlot(null);
    const playerId = e.dataTransfer.getData('text/plain');
    if (playerId) assignPlayerToSlot(playerId, slotId);
  }

  function setFormation(formation: Formation) {
    setTactics({ ...tactics, formation });
  }

  function handleAutoAssign() {
    setAssignments(autoAssign(slots, squad));
  }

  async function handleSaveFormation() {
    await saveCurrentCareer();
    setSavedMessage('Formação salva.');
    setTimeout(() => setSavedMessage(null), 2000);
  }

  return (
    <div className="lineup">
      <div className="lineup__controls">
        <div className="lineup__field field">
          <label className="field__label" htmlFor="formation">
            Formação
          </label>
          <select
            id="formation"
            className="field__input"
            value={tactics.formation}
            onChange={(e) => setFormation(e.target.value as Formation)}
          >
            {FORMATIONS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        <div className="lineup__field field">
          <label className="field__label" htmlFor="style">
            Estilo
          </label>
          <select
            id="style"
            className="field__input"
            value={tactics.style}
            onChange={(e) => setTactics({ ...tactics, style: e.target.value as TacticStyle })}
          >
            {TACTIC_STYLES.map((s) => (
              <option key={s} value={s}>
                {TACTIC_STYLE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <Button className="lineup__auto" variant="secondary" onClick={handleAutoAssign}>
          Auto-escalação
        </Button>
      </div>

      <div className="lineup__status">
        <span className="numeric">{assignedIds.size}/11 escalados</span>
        {!hasGoalkeeper && <span className="lineup__status--invalid">sem goleiro</span>}
        <span className={isValid ? 'lineup__status--valid' : 'lineup__status--invalid'}>
          {isValid ? 'Escalação válida' : 'Escalação incompleta'}
        </span>
        {!autoSaveEnabled && (
          <span className="lineup__save">
            <Button type="button" size="sm" variant="secondary" onClick={handleSaveFormation}>
              Salvar formação
            </Button>
            {savedMessage && <span className="lineup__save-message">{savedMessage}</span>}
          </span>
        )}
      </div>

      <div className="lineup__layout">
        <div className="lineup__sidebar">
          <span className="eyebrow">Elenco disponível · arraste pro campo</span>

          <Card className="lineup__card">
            <div className="lineup__row lineup__row--head">
              <span />
              <span>Nome</span>
              <span>Pos</span>
              <span className="numeric">For</span>
            </div>
            <div className="lineup__row-scroll">
              {squad.map((player) => {
                const selected = assignedIds.has(player.id);
                return (
                  <div
                    key={player.id}
                    className={`lineup__row${selected ? ' lineup__row--selected' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', player.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={() => handleSidebarClick(player)}
                  >
                    <span className={`lineup__dot${selected ? ' lineup__dot--on' : ''}`} />
                    <span className="lineup__name" title={player.name}>
                      {player.name}
                    </span>
                    <span className="lineup__pos">{player.position}</span>
                    <span className="numeric">{player.strength}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="lineup__pitch-col">
          <div className="pitch">
            {RENDER_ORDER.map((sectorKey) => {
              const rowSlots = slots.filter((s) => s.id.startsWith(`${sectorKey}-`));
              if (rowSlots.length === 0) return null;
              return (
                <div className="pitch__row" key={sectorKey}>
                  {rowSlots.map((slot) => {
                    const player = assignments[slot.id] ? playersById.get(assignments[slot.id]!) : undefined;
                    const fit = player ? positionFit(player.position, slot.canonical) : null;
                    const adjustedOverall = player && fit ? effectiveOverall(player.strength, fit) : null;
                    const outOfPosition = fit !== null && fit !== 'natural';
                    const fitTitle = !player
                      ? undefined
                      : fit === 'similar'
                        ? `${player.name} — natural de ${player.position}, atuando em ${slot.canonical}. Leve queda de overall: ${adjustedOverall} (base ${player.strength}).`
                        : fit === 'poor'
                          ? `${player.name} — natural de ${player.position}, atuando em ${slot.canonical}. Grande queda de overall: ${adjustedOverall} (base ${player.strength}).`
                          : `Remover ${player.name} da escalação`;
                    return (
                      <div
                        key={slot.id}
                        className={`pitch-slot${dragOverSlot === slot.id ? ' pitch-slot--over' : ''}`}
                        onDragOver={(e) => e.preventDefault()}
                        onDragEnter={() => setDragOverSlot(slot.id)}
                        onDragLeave={() => setDragOverSlot((s) => (s === slot.id ? null : s))}
                        onDrop={(e) => handleDrop(e, slot.id)}
                      >
                        {player ? (
                          <button
                            type="button"
                            className={`chip${outOfPosition ? ` chip--${fit}` : ''}`}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData('text/plain', player.id);
                              e.dataTransfer.effectAllowed = 'move';
                            }}
                            onClick={() => clearSlot(slot.id)}
                            title={fitTitle}
                          >
                            <span className="chip__badge-wrap">
                              <span className="chip__badge">{slot.canonical}</span>
                              {outOfPosition && (
                                <span className={`chip__natural chip__natural--${fit}`}>{player.position}</span>
                              )}
                            </span>
                            <span className="chip__name">{player.name}</span>
                            <span className={`chip__overall chip__overall--${fit}`}>{adjustedOverall}</span>
                          </button>
                        ) : (
                          <div className="chip chip--empty" title={slot.sectorLabel}>
                            <span className="chip__badge chip__badge--empty">+</span>
                            <span className="chip__name chip__name--empty">{slot.sectorLabel}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
