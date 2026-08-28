import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCareerStore } from '../../store/careerStore';
import { POSITION_GROUP, resolveSquad, type PositionGroup } from '../utils';
import { Card } from '../components';
import type { Player } from '../../engine/types';
import './Squad.css';

type Filter = PositionGroup | 'ALL';
type SortField = 'name' | 'position' | 'age' | 'strength' | 'condition' | 'morale';
type SortDirection = 'asc' | 'desc';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'ALL', label: 'Todos' },
  { id: 'GOL', label: 'Goleiros' },
  { id: 'DEF', label: 'Defesa' },
  { id: 'MEI', label: 'Meio' },
  { id: 'ATA', label: 'Ataque' },
];

const COLUMNS: { field: SortField; label: string; defaultDirection: SortDirection }[] = [
  { field: 'name', label: 'Nome', defaultDirection: 'asc' },
  { field: 'position', label: 'Pos', defaultDirection: 'asc' },
  { field: 'age', label: 'Idade', defaultDirection: 'asc' },
  { field: 'strength', label: 'Força', defaultDirection: 'desc' },
  { field: 'condition', label: 'Condição', defaultDirection: 'desc' },
  { field: 'morale', label: 'Moral', defaultDirection: 'desc' },
];

function compareBy(field: SortField, a: Player, b: Player): number {
  switch (field) {
    case 'name':
      return a.name.localeCompare(b.name, 'pt-BR');
    case 'position':
      return a.position.localeCompare(b.position);
    case 'age':
      return a.age - b.age;
    case 'strength':
      return a.strength - b.strength;
    case 'condition':
      return a.condition - b.condition;
    case 'morale':
      return a.morale - b.morale;
  }
}

function statClass(value: number): string {
  if (value >= 80) return 'squad__stat squad__stat--high';
  if (value < 50) return 'squad__stat squad__stat--low';
  return 'squad__stat';
}

function formatPhysical(player: Player): string {
  if (!player.height && !player.weight) return '—';
  const h = player.height ? `${player.height}cm` : '—';
  const w = player.weight ? `${player.weight}kg` : '—';
  return `${h} / ${w}`;
}

function formatFoot(player: Player): string {
  if (!player.preferredFoot) return '—';
  const foot = player.preferredFoot === 'right' ? 'D' : 'E';
  const stars = player.weakFoot ? '★'.repeat(player.weakFoot) + '☆'.repeat(5 - player.weakFoot) : '';
  return stars ? `${foot} ${stars}` : foot;
}

export function Squad() {
  const career = useCareerStore((s) => s.career);
  const parentRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [sort, setSort] = useState<{ field: SortField; direction: SortDirection }>({
    field: 'strength',
    direction: 'desc',
  });

  const fullSquad = useMemo(
    () => (career ? resolveSquad(career, career.playerClubId) : []),
    [career],
  );

  const squad = useMemo(() => {
    const filtered =
      filter === 'ALL' ? fullSquad : fullSquad.filter((p) => POSITION_GROUP[p.position] === filter);
    const sorted = [...filtered].sort((a, b) => compareBy(sort.field, a, b));
    if (sort.direction === 'desc') sorted.reverse();
    return sorted;
  }, [fullSquad, filter, sort]);

  const virtualizer = useVirtualizer({
    count: squad.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 8,
  });

  if (!career) return null;

  function toggleSort(field: SortField) {
    setSort((current) => {
      if (current.field !== field) {
        const column = COLUMNS.find((c) => c.field === field)!;
        return { field, direction: column.defaultDirection };
      }
      return { field, direction: current.direction === 'asc' ? 'desc' : 'asc' };
    });
  }

  return (
    <div className="squad">
      <div className="squad__header">
        <span className="eyebrow">{fullSquad.length} jogadores federados no profissional</span>
        <div className="squad__filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`squad__filter${filter === f.id ? ' squad__filter--active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <Card className="squad__card">
        <div className="squad__table">
          <div className="squad__row squad__row--head">
            {COLUMNS.map((col) => (
              <button
                key={col.field}
                type="button"
                className={`squad__sort${sort.field === col.field ? ' squad__sort--active' : ''}`}
                onClick={() => toggleSort(col.field)}
              >
                {col.label}
                {sort.field === col.field && <span className="squad__sort-arrow">{sort.direction === 'asc' ? '▲' : '▼'}</span>}
              </button>
            ))}
            <span className="squad__sort squad__sort--static">Físico</span>
            <span className="squad__sort squad__sort--static">Pé</span>
          </div>

          <div ref={parentRef} className="squad__scroll">
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((row) => {
                const player = squad[row.index];
                return (
                  <div
                    key={player.id}
                    className="squad__row"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: row.size,
                      transform: `translateY(${row.start}px)`,
                    }}
                  >
                    <span className="squad__name" title={player.name}>
                      {player.name}
                    </span>
                    <span className="squad__pos">{player.position}</span>
                    <span className="numeric squad__stat">{player.age}</span>
                    <span className={`numeric ${statClass(player.strength)}`}>{player.strength}</span>
                    <span className={`numeric ${statClass(player.condition)}`}>{player.condition}</span>
                    <span className={`numeric ${statClass(player.morale)}`}>{player.morale}</span>
                    <span className="numeric squad__stat squad__stat--muted">{formatPhysical(player)}</span>
                    <span className="numeric squad__stat squad__stat--muted">{formatFoot(player)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
