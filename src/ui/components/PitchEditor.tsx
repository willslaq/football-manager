import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { FORMATIONS, TACTIC_STYLE_LABELS, TACTIC_STYLES } from '../../engine/types';
import type { Formation, Player, TacticalIntensity, TacticStyle } from '../../engine/types';
import { formationStyleCoherence } from '../../engine';
import { assignToSlots, autoAssign, buildSlots } from '../../engine/simulation/formation';
import { positionAtCoord } from '../../engine/simulation/pitchZones';
import { POSITION_FILTERS, POSITION_GROUP, type PlayerListFilter } from '../utils';
import { positionFit, effectiveOverall } from '../positionFit';
import { Button } from './Button';
import { Card } from './Card';
import { EnergyBar } from './EnergyBar';
import { IconCardStack } from './Icons';
import { TextField } from './TextField';
import './PitchEditor.css';

/** Mesmas faixas de `EnergyBar`/`energyTier` — cor do número de condição na lista lateral e no chip do campo. */
function conditionClass(value: number): string {
  if (value >= 70) return 'lineup__stat lineup__stat--high';
  if (value >= 40) return 'lineup__stat lineup__stat--mid';
  return 'lineup__stat lineup__stat--low';
}

/** Cartão acumulado só suspende com 3 (regra CBF/Brasileirão) — 1 ou 2 pendentes só mostram o(s) ícone(s). */
function pendingCardCount(player: Player): 1 | 2 | null {
  if (player.pendingYellowCards === 1) return 1;
  if (player.pendingYellowCards === 2) return 2;
  return null;
}

/**
 * Converte a coordenada da vaga (mesmo sistema de `pitchZones.ts`: `side`
 * -1..1, `line` 0..5) num ponto percentual dentro do `.pitch`, com uma
 * margem pra ficha nunca encostar na borda do campo.
 */
function toLeftPercent(side: number): number {
  return 8 + ((side + 1) / 2) * 84;
}
function toTopPercent(line: number): number {
  return 8 + ((5 - line) / 5) * 84;
}

/** Mesmo limiar usado em match.ts (COHERENCE_NOTE_LOW_THRESHOLD) pra decidir se a fricção formação×estilo é grande o bastante pra valer um aviso. */
const COHERENCE_WARNING_THRESHOLD = 0.95;

type SidebarSortField = 'name' | 'position' | 'strength' | 'condition';
type SortDirection = 'asc' | 'desc';

/** Mesmo padrão de colunas ordenáveis da tela de Elenco, restrito às colunas visíveis na barra lateral. */
const SIDEBAR_COLUMNS: { field: SidebarSortField; label: string; defaultDirection: SortDirection }[] = [
  { field: 'name', label: 'Nome', defaultDirection: 'asc' },
  { field: 'position', label: 'Pos', defaultDirection: 'asc' },
  { field: 'strength', label: 'For', defaultDirection: 'desc' },
  { field: 'condition', label: 'Cond', defaultDirection: 'desc' },
];

function compareSidebar(field: SidebarSortField, a: Player, b: Player): number {
  switch (field) {
    case 'name':
      return a.name.localeCompare(b.name, 'pt-BR');
    case 'position':
      return a.position.localeCompare(b.position);
    case 'strength':
      return a.strength - b.strength;
    case 'condition':
      return a.condition - b.condition;
  }
}

export interface PitchEditorProps {
  /** Prefixo dos `id`/`htmlFor` dos selects — evita ids duplicados quando duas instâncias renderizam ao mesmo tempo (Amistoso). */
  idPrefix: string;
  formation: Formation;
  style: TacticStyle;
  onFormationChange: (formation: Formation) => void;
  onStyleChange: (style: TacticStyle) => void;
  tacticalIntensity: TacticalIntensity;
  /** Elenco candidato completo desse lado. */
  squad: Player[];
  assignments: Record<string, string | null>;
  onAssignmentsChange: (next: Record<string, string | null>) => void;
  /** Layout enxuto pra caber lado a lado (ver Amistoso) — sidebar empilhada acima do campo, campo mais baixo. */
  compact?: boolean;
}

/**
 * Editor de escalação (campo + barra lateral) reutilizado pela Escalação de carreira (`Lineup.tsx`,
 * que mantém a persistência) e pelo Amistoso (sem persistência nenhuma) — só lê/escreve as props,
 * nunca a store de carreira.
 */
export function PitchEditor({
  idPrefix,
  formation,
  style,
  onFormationChange,
  onStyleChange,
  tacticalIntensity,
  squad,
  assignments,
  onAssignmentsChange,
  compact,
}: PitchEditorProps) {
  const [nameFilter, setNameFilter] = useState('');
  const [positionFilter, setPositionFilter] = useState<PlayerListFilter>('ALL');
  const [sidebarSort, setSidebarSort] = useState<{ field: SidebarSortField; direction: SortDirection }>({
    field: 'strength',
    direction: 'desc',
  });
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);

  const playersById = useMemo(() => new Map(squad.map((p) => [p.id, p])), [squad]);
  const visibleSquad = useMemo(() => {
    const query = nameFilter.trim().toLowerCase();
    const byPosition =
      positionFilter === 'ALL' ? squad : squad.filter((p) => POSITION_GROUP[p.position] === positionFilter);
    const byName = query ? byPosition.filter((p) => p.name.toLowerCase().includes(query)) : byPosition;
    const sorted = [...byName].sort((a, b) => compareSidebar(sidebarSort.field, a, b));
    if (sidebarSort.direction === 'desc') sorted.reverse();
    return sorted;
  }, [squad, nameFilter, positionFilter, sidebarSort]);

  function toggleSidebarSort(field: SidebarSortField) {
    setSidebarSort((current) => {
      if (current.field !== field) {
        const column = SIDEBAR_COLUMNS.find((c) => c.field === field)!;
        return { field, direction: column.defaultDirection };
      }
      return { field, direction: current.direction === 'asc' ? 'desc' : 'asc' };
    });
  }

  const slots = useMemo(() => buildSlots(formation), [formation]);
  const lastReshapedFormation = useRef(formation);

  useEffect(() => {
    if (lastReshapedFormation.current === formation) return;
    lastReshapedFormation.current = formation;
    const current = Object.values(assignments)
      .filter((id): id is string => !!id)
      .map((id) => playersById.get(id))
      .filter((p): p is Player => !!p)
      .sort((a, b) => b.strength - a.strength);
    onAssignmentsChange(assignToSlots(slots, current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formation]);

  const tacticCoherence = formationStyleCoherence(formation, style, tacticalIntensity);
  const tacticWarning =
    tacticCoherence < COHERENCE_WARNING_THRESHOLD
      ? `Formação ${formation} não combina bem com o estilo ${TACTIC_STYLE_LABELS[style]} — tira eficiência do ataque.`
      : null;

  const assignedIds = new Set(Object.values(assignments).filter((id): id is string => !!id));

  function assignPlayerToSlot(playerId: string, targetSlotId: string) {
    // Jogador suspenso não pode ser escalado — nem por clique, nem por arrastar (handleDrop
    // e handleSidebarClick passam por aqui, então a checagem aqui cobre os dois).
    if ((playersById.get(playerId)?.suspendedMatches ?? 0) > 0) return;
    const prev = assignments;
    if (prev[targetSlotId] === playerId) return;
    const sourceSlotId = Object.keys(prev).find((k) => prev[k] === playerId);
    const displaced = prev[targetSlotId] ?? null;
    const next = { ...prev, [targetSlotId]: playerId };
    if (sourceSlotId && sourceSlotId !== targetSlotId) {
      next[sourceSlotId] = displaced;
    }
    onAssignmentsChange(next);
  }

  function clearSlot(slotId: string) {
    onAssignmentsChange({ ...assignments, [slotId]: null });
  }

  function handleSidebarClick(player: Player) {
    if (player.suspendedMatches > 0) return;
    const currentSlotId = Object.keys(assignments).find((k) => assignments[k] === player.id);
    if (currentSlotId) {
      clearSlot(currentSlotId);
      return;
    }
    const emptySlots = slots.filter((s) => !assignments[s.id]);
    if (emptySlots.length === 0) return;
    const bestFit = [...emptySlots].sort(
      (a, b) => effectiveOverall(player, b.canonical) - effectiveOverall(player, a.canonical),
    )[0];
    assignPlayerToSlot(player.id, bestFit.id);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, slotId: string) {
    e.preventDefault();
    setDragOverSlot(null);
    const playerId = e.dataTransfer.getData('text/plain');
    if (playerId) assignPlayerToSlot(playerId, slotId);
  }

  function handleAutoAssign() {
    onAssignmentsChange(autoAssign(slots, squad.filter((p) => p.suspendedMatches === 0)));
  }

  const formationId = `${idPrefix}-formation`;
  const styleId = `${idPrefix}-style`;

  return (
    <div className={`pitch-editor${compact ? ' pitch-editor--compact' : ''}`}>
      <div className="lineup__controls">
        <div className="lineup__field field">
          <label className="field__label" htmlFor={formationId}>
            Formação
          </label>
          <select
            id={formationId}
            className="field__input"
            value={formation}
            onChange={(e) => onFormationChange(e.target.value as Formation)}
          >
            {FORMATIONS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>

        <div className="lineup__field field">
          <label className="field__label" htmlFor={styleId}>
            Estilo
          </label>
          <select
            id={styleId}
            className="field__input"
            value={style}
            onChange={(e) => onStyleChange(e.target.value as TacticStyle)}
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

      {tacticWarning && <p className="lineup__tactic-warning">{tacticWarning}</p>}

      <div className="lineup__layout">
        <div className="lineup__sidebar">
          <span className="eyebrow">Elenco disponível · arraste pro campo</span>

          <div className="lineup__filters">
            {POSITION_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`lineup__filter${positionFilter === f.id ? ' lineup__filter--active' : ''}`}
                onClick={() => setPositionFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <TextField
            type="text"
            className="lineup__search"
            placeholder="Buscar jogador..."
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
          />

          <Card className="lineup__card">
            <div className="lineup__row lineup__row--head">
              <span />
              {SIDEBAR_COLUMNS.map((col) => (
                <button
                  key={col.field}
                  type="button"
                  className={`lineup__sort${sidebarSort.field === col.field ? ' lineup__sort--active' : ''}`}
                  onClick={() => toggleSidebarSort(col.field)}
                >
                  {col.label}
                  {sidebarSort.field === col.field && (
                    <span className="lineup__sort-arrow">{sidebarSort.direction === 'asc' ? '▲' : '▼'}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="lineup__row-scroll">
              {visibleSquad.length === 0 && <p className="lineup__search-empty">Nenhum jogador encontrado.</p>}
              {visibleSquad.map((player) => {
                const selected = assignedIds.has(player.id);
                const suspended = player.suspendedMatches > 0;
                const cardCount = pendingCardCount(player);
                return (
                  <div
                    key={player.id}
                    className={`lineup__row${selected ? ' lineup__row--selected' : ''}${suspended ? ' lineup__row--suspended' : ''}`}
                    draggable={!suspended}
                    onDragStart={(e) => {
                      if (suspended) return;
                      e.dataTransfer.setData('text/plain', player.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={() => handleSidebarClick(player)}
                    title={suspended ? `${player.name} está suspenso — cumpre ${player.suspendedMatches} jogo(s)` : undefined}
                  >
                    <span className={`lineup__dot${selected ? ' lineup__dot--on' : ''}`} />
                    <span className="lineup__name">
                      <span className="lineup__name-text" title={player.name}>
                        {player.name}
                      </span>
                      {suspended ? (
                        <span className="lineup__suspended-label">Suspenso</span>
                      ) : (
                        cardCount && <IconCardStack count={cardCount} className="lineup__card-icon" />
                      )}
                    </span>
                    <span className="lineup__pos">{player.position}</span>
                    <span className="numeric">{player.strength}</span>
                    <span className={`numeric ${conditionClass(player.condition)}`}>{player.condition}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="lineup__pitch-col">
          <div className="pitch">
            {slots.map((slot) => {
              const player = assignments[slot.id] ? playersById.get(assignments[slot.id]!) : undefined;
              const role = positionAtCoord(slot.coord);
              const fit = player ? positionFit(player, slot.canonical) : null;
              const adjustedOverall = player ? effectiveOverall(player, slot.canonical) : null;
              const outOfPosition = fit !== null && fit !== 'primary' && fit !== 'secondary';
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
                  style={{ left: `${toLeftPercent(slot.coord.side)}%`, top: `${toTopPercent(slot.coord.line)}%` }}
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
                        <span className="chip__badge">{role}</span>
                        {outOfPosition && (
                          <span className={`chip__natural chip__natural--${fit}`}>{player.position}</span>
                        )}
                      </span>
                      <span className="chip__name">{player.name}</span>
                      <span className="chip__meta">
                        <span className={`chip__overall chip__overall--${fit}`}>{adjustedOverall}</span>
                        <EnergyBar value={player.condition} className="chip__condition" />
                      </span>
                      {pendingCardCount(player) && (
                        <IconCardStack count={pendingCardCount(player)!} className="chip__cards" />
                      )}
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
        </div>
      </div>
    </div>
  );
}
