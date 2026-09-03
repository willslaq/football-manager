import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCareerStore } from '../../store/careerStore';
import {
  formatMarketValueBRL,
  POSITION_FILTERS,
  POSITION_GROUP,
  POSITION_LABEL,
  resolveSquad,
  type PlayerListFilter,
} from '../utils';
import { Card, IconCard, ProgressBar } from '../components';
import { useTabIndicator } from '../hooks/useTabIndicator';
import type { Player, PlayerAttributes } from '../../engine/types';
import './Squad.css';

type Filter = PlayerListFilter;
type SortField = 'name' | 'position' | 'age' | 'strength' | 'condition' | 'morale' | 'marketValue';
type SortDirection = 'asc' | 'desc';

/** Duração da transição de saída do painel (Squad.css) — o desmonte espera esse tempo pra não cortar a animação. */
const DETAIL_CLOSE_MS = 200;

/** Ordem de exibição dos 10 atributos no painel de detalhe — sem relação com PlayerAttributes (ordem alfabética de declaração). */
const ATTRIBUTE_ORDER: (keyof PlayerAttributes)[] = [
  'finishing',
  'heading',
  'dribbling',
  'passing',
  'speed',
  'positioning',
  'marking',
  'tackling',
  'reflexes',
  'aggression',
];

const ATTRIBUTE_LABEL: Record<keyof PlayerAttributes, string> = {
  finishing: 'Finalização',
  speed: 'Velocidade',
  dribbling: 'Drible',
  passing: 'Passe',
  heading: 'Cabeceio',
  marking: 'Marcação',
  tackling: 'Desarme',
  positioning: 'Posicionamento',
  reflexes: 'Reflexos',
  aggression: 'Agressividade',
};

const COLUMNS: { field: SortField; label: string; defaultDirection: SortDirection }[] = [
  { field: 'name', label: 'Nome', defaultDirection: 'asc' },
  { field: 'position', label: 'Pos', defaultDirection: 'asc' },
  { field: 'age', label: 'Idade', defaultDirection: 'asc' },
  { field: 'strength', label: 'Força', defaultDirection: 'desc' },
  { field: 'condition', label: 'Condição', defaultDirection: 'desc' },
  { field: 'morale', label: 'Moral', defaultDirection: 'desc' },
  { field: 'marketValue', label: 'Valor', defaultDirection: 'desc' },
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
    case 'marketValue':
      return a.marketValue - b.marketValue;
  }
}

function statClass(value: number): string {
  if (value >= 70) return 'squad__stat squad__stat--high';
  if (value >= 40) return 'squad__stat squad__stat--mid';
  return 'squad__stat squad__stat--low';
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

function preferredFootLabel(player: Player): string {
  if (!player.preferredFoot) return '—';
  return player.preferredFoot === 'right' ? 'Destro' : 'Canhoto';
}

function weakFootStars(player: Player): string {
  if (!player.weakFoot) return '—';
  return '★'.repeat(player.weakFoot) + '☆'.repeat(5 - player.weakFoot);
}

export function Squad() {
  const career = useCareerStore((s) => s.career);
  const parentRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const { trackRef: filtersRef, registerItem: registerFilter, indicator: filterIndicator } = useTabIndicator<Filter>(filter);
  const [sort, setSort] = useState<{ field: SortField; direction: SortDirection }>({
    field: 'strength',
    direction: 'desc',
  });
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  /** Jogador exibido no painel — some só depois da transição de saída terminar, não junto com a seleção. */
  const [panelPlayer, setPanelPlayer] = useState<Player | null>(null);
  /** Classe que dispara a transição de entrada/saída do painel (ver DETAIL_CLOSE_MS abaixo). */
  const [panelVisible, setPanelVisible] = useState(false);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fullSquad = useMemo(
    () => (career ? resolveSquad(career, career.playerClubId) : []),
    [career],
  );

  // Monta o painel "fechado" primeiro (opacity/transform inicial) e só na renderização
  // seguinte liga a classe que dispara a transição — trocar de jogador com o painel já
  // aberto não reabre a animação, só troca o conteúdo.
  useEffect(() => {
    if (panelPlayer) setPanelVisible(true);
  }, [panelPlayer]);

  useEffect(() => () => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
  }, []);

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
    estimateSize: () => 52,
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

  function closeDetail() {
    setSelectedPlayerId(null);
    setPanelVisible(false);
    closeTimeoutRef.current = setTimeout(() => setPanelPlayer(null), DETAIL_CLOSE_MS);
  }

  function toggleSelection(player: Player) {
    if (selectedPlayerId === player.id) {
      closeDetail();
      return;
    }
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setSelectedPlayerId(player.id);
    setPanelPlayer(player);
  }

  return (
    <div className="squad">
      <div className="squad__header">
        <div className="squad__heading">
          <span className="eyebrow">Profissional</span>
          <h2 className="squad__title">{fullSquad.length} jogadores federados</h2>
        </div>
        <div className="squad__filters" ref={filtersRef}>
          <div className="squad__filters-track">
            {POSITION_FILTERS.map((f) => (
              <button key={f.id} ref={registerFilter(f.id)} type="button" className="squad__filter" onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>

          <div
            className="fm-indicator-layer squad__filters-indicator-layer"
            aria-hidden="true"
            data-ready={filterIndicator ? 'true' : 'false'}
            style={
              filterIndicator
                ? ({
                    '--fm-indicator-left': `${filterIndicator.left}px`,
                    '--fm-indicator-right': `${filterIndicator.right}px`,
                  } as CSSProperties)
                : undefined
            }
          >
            {POSITION_FILTERS.map((f) => (
              <span key={f.id} className="squad__filter">
                {f.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="squad__layout">
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

            <div ref={parentRef} className="squad__scroll scroll-styled">
              <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                {virtualizer.getVirtualItems().map((row) => {
                  const player = squad[row.index];
                  return (
                    <div
                      key={player.id}
                      className={`squad__row squad__row--clickable${player.id === selectedPlayerId ? ' squad__row--selected' : ''}`}
                      onClick={() => toggleSelection(player)}
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
                      <span className="numeric squad__stat squad__stat--force">{player.strength}</span>
                      <span className={`numeric ${statClass(player.condition)}`}>{player.condition}</span>
                      <span className={`numeric ${statClass(player.morale)}`}>{player.morale}</span>
                      <span className="numeric squad__stat squad__stat--muted">{formatMarketValueBRL(player.marketValue)}</span>
                      <span className="numeric squad__stat squad__stat--muted">{formatPhysical(player)}</span>
                      <span className="numeric squad__stat squad__stat--muted">{formatFoot(player)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Card>

        {panelPlayer && (
          <Card className={`squad__detail${panelVisible ? ' squad__detail--visible' : ''}`}>
            <div className="squad__detail-head">
              <div className="squad__detail-heading">
                <h2 className="squad__detail-name">{panelPlayer.name}</h2>
                <p className="squad__detail-meta">
                  {POSITION_LABEL[panelPlayer.position]} · {panelPlayer.age} anos · {panelPlayer.nationality}
                </p>
                <p className="squad__detail-value">{formatMarketValueBRL(panelPlayer.marketValue)}</p>
              </div>
              <button
                type="button"
                className="squad__detail-close"
                onClick={closeDetail}
                aria-label="Fechar detalhes do jogador"
              >
                ×
              </button>
            </div>

            {panelPlayer.secondaryPositions.length > 0 && (
              <div className="squad__detail-badges">
                <span className="squad__detail-badge squad__detail-badge--primary">{panelPlayer.position}</span>
                {panelPlayer.secondaryPositions.map((pos) => (
                  <span key={pos} className="squad__detail-badge">
                    {pos}
                  </span>
                ))}
              </div>
            )}

            <div className="squad__detail-section">
              <span className="squad__detail-title">Estado</span>
              <div className="squad__detail-bars">
                <ProgressBar value={panelPlayer.strength} max={100} label={`Geral · ${panelPlayer.strength}`} />
                <ProgressBar value={panelPlayer.condition} max={100} label={`Condição · ${panelPlayer.condition}`} />
                <ProgressBar value={panelPlayer.morale} max={100} label={`Moral · ${panelPlayer.morale}`} />
              </div>
            </div>

            <div className="squad__detail-section">
              <span className="squad__detail-title">Físico</span>
              <div className="squad__detail-grid">
                <span className="squad__detail-label">Altura</span>
                <span className="squad__detail-value">{panelPlayer.height ? `${panelPlayer.height} cm` : '—'}</span>
                <span className="squad__detail-label">Peso</span>
                <span className="squad__detail-value">{panelPlayer.weight ? `${panelPlayer.weight} kg` : '—'}</span>
                <span className="squad__detail-label">Pé preferido</span>
                <span className="squad__detail-value">{preferredFootLabel(panelPlayer)}</span>
                <span className="squad__detail-label">Pé fraco</span>
                <span className="squad__detail-value">{weakFootStars(panelPlayer)}</span>
              </div>
            </div>

            <div className="squad__detail-section">
              <span className="squad__detail-title">Atributos</span>
              <div className="squad__detail-bars">
                {ATTRIBUTE_ORDER.map((key) => (
                  <ProgressBar
                    key={key}
                    value={panelPlayer.attributes[key]}
                    max={100}
                    label={`${ATTRIBUTE_LABEL[key]} · ${panelPlayer.attributes[key]}`}
                  />
                ))}
              </div>
            </div>

            <div className="squad__detail-section">
              <span className="squad__detail-title">Temporada atual</span>
              <div className="squad__detail-grid">
                <span className="squad__detail-label">Jogos</span>
                <span className="squad__detail-value">{panelPlayer.seasonStats.appearances}</span>
                <span className="squad__detail-label">Gols</span>
                <span className="squad__detail-value">{panelPlayer.seasonStats.goals}</span>
                <span className="squad__detail-label">Defesas</span>
                <span className="squad__detail-value">{panelPlayer.seasonStats.saves}</span>
                <span className="squad__detail-label">Cartões</span>
                <span className="squad__detail-value squad__detail-cards">
                  <span className="squad__detail-card-count">
                    {panelPlayer.seasonStats.yellowCards} <IconCard color="var(--fm-warn)" />
                  </span>
                  <span className="squad__detail-card-count">
                    {panelPlayer.seasonStats.redCards} <IconCard color="var(--fm-danger)" />
                  </span>
                </span>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
