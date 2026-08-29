import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { FORMATIONS, TACTIC_STYLE_LABELS, TACTIC_STYLES } from '../../engine/types';
import type { Formation, Player, TacticStyle } from '../../engine/types';
import { formationStyleCoherence } from '../../engine';
import { assignToSlots, autoAssign, buildSlots } from '../../engine/simulation/formation';
import { positionAtCoord } from '../../engine/simulation/pitchZones';
import { useCareerStore } from '../../store/careerStore';
import { POSITION_FILTERS, POSITION_GROUP, resolveSquad, type PlayerListFilter } from '../utils';
import { positionFit, effectiveOverall } from '../positionFit';
import { Button, Card, EnergyBar, IconCardStack, TextField } from '../components';
import './Lineup.css';

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

export function Lineup() {
  const career = useCareerStore((s) => s.career);
  const lineup = useCareerStore((s) => s.lineup);
  const tactics = useCareerStore((s) => s.tactics);
  const setLineup = useCareerStore((s) => s.setLineup);
  const setTactics = useCareerStore((s) => s.setTactics);
  const autoSaveEnabled = useCareerStore((s) => s.autoSaveEnabled);
  const saveCurrentCareer = useCareerStore((s) => s.saveCurrentCareer);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [nameFilter, setNameFilter] = useState('');
  const [positionFilter, setPositionFilter] = useState<PlayerListFilter>('ALL');
  const [sidebarSort, setSidebarSort] = useState<{ field: SidebarSortField; direction: SortDirection }>({
    field: 'strength',
    direction: 'desc',
  });

  const squad = useMemo(
    () => (career ? resolveSquad(career, career.playerClubId).sort((a, b) => b.strength - a.strength) : []),
    [career],
  );
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

  const [assignments, setAssignments] = useState<Record<string, string | null>>(() => {
    const slots = buildSlots(tactics.formation);
    // Fonte da verdade: mapeamento exato vaga→jogador salvo da última vez. Só
    // cai pra heurística (assignToSlots) se não existir (save antigo/lineup
    // sugerido inicial) ou se a formação salva for outra (vagas não batem) —
    // sem isso, trocar de aba e voltar reconstruía a escalação por
    // aproximação e podia embaralhar quem estava em qual vaga.
    if (lineup?.slotAssignments && lineup.formation === tactics.formation) {
      const validSlotIds = new Set(slots.map((s) => s.id));
      const restored: Record<string, string | null> = {};
      for (const slot of slots) {
        const playerId = lineup.slotAssignments[slot.id];
        // Defesa extra: o careerStore já limpa titular suspenso do lineup assim que a
        // suspensão é decretada (ver removeSuspendedStarters), mas um save antigo
        // carregado só agora pode não ter passado por isso.
        restored[slot.id] =
          playerId && playersById.get(playerId)?.suspendedMatches === 0 ? playerId : null;
      }
      const allSlotsKnown = Object.keys(lineup.slotAssignments).every((id) => validSlotIds.has(id));
      if (allSlotsKnown) return restored;
    }
    const startersNow = (lineup?.starters ?? []).map((id) => playersById.get(id)).filter((p): p is Player => !!p);
    return assignToSlots(slots, startersNow);
  });
  const [dragOverSlot, setDragOverSlot] = useState<string | null>(null);
  /**
   * Formação vista da última vez que o efeito abaixo reagiu de verdade —
   * não um contador de "primeira execução". Um ref de "pula a primeira
   * chamada" quebra sob o StrictMode do React 18: no mount, o efeito
   * dispara duas vezes de propósito (pra achar efeitos impuros) e a
   * segunda chamada já via a flag zerada pela primeira, então o reencaixe
   * rodava de novo em TODO mount — não só quando a formação realmente
   * mudava — embaralhando uma escalação que a inicialização já tinha
   * restaurado corretamente. Comparar o valor evita isso: reexecuções com
   * a mesma formação (StrictMode ou não) são sempre no-op.
   */
  const lastReshapedFormation = useRef(tactics.formation);

  const slots = useMemo(() => buildSlots(tactics.formation), [tactics.formation]);

  useEffect(() => {
    if (lastReshapedFormation.current === tactics.formation) return;
    lastReshapedFormation.current = tactics.formation;
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
      slotAssignments: assignments,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments]);

  if (!career || !lineup) return null;

  const tacticCoherence = formationStyleCoherence(tactics.formation, tactics.style, career.settings.tacticalIntensity);
  const tacticWarning =
    tacticCoherence < COHERENCE_WARNING_THRESHOLD
      ? `Formação ${tactics.formation} não combina bem com o estilo ${TACTIC_STYLE_LABELS[tactics.style]} — tira eficiência do ataque.`
      : null;

  const assignedIds = new Set(Object.values(assignments).filter((id): id is string => !!id));
  const assignedPlayers = [...assignedIds].map((id) => playersById.get(id)).filter((p): p is Player => !!p);
  const hasGoalkeeper = assignedPlayers.some((p) => p.position === 'GOL');
  const isValid = assignedIds.size === 11 && hasGoalkeeper;

  function assignPlayerToSlot(playerId: string, targetSlotId: string) {
    // Jogador suspenso não pode ser escalado — nem por clique, nem por arrastar (handleDrop
    // e handleSidebarClick passam por aqui, então a checagem aqui cobre os dois).
    if ((playersById.get(playerId)?.suspendedMatches ?? 0) > 0) return;
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

  function setFormation(formation: Formation) {
    setTactics({ ...tactics, formation });
  }

  function handleAutoAssign() {
    setAssignments(autoAssign(slots, squad.filter((p) => p.suspendedMatches === 0)));
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

      {tacticWarning && <p className="lineup__tactic-warning">{tacticWarning}</p>}

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
