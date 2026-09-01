import { useMemo, useState } from 'react';
import { useCareerStore } from '../../store/careerStore';
import { POSITION_FILTERS, POSITION_GROUP, POSITION_LABEL, resolveAcademySquad, type PlayerListFilter } from '../utils';
import { Button, Card, ProgressBar } from '../components';
import type { Player, PlayerAttributes } from '../../engine/types';
import './Academy.css';

type Filter = PlayerListFilter;

/** Mesma ordem de exibição usada no painel de detalhe do Elenco (Squad.tsx) — sem relação com PlayerAttributes. */
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

function statClass(value: number): string {
  if (value >= 80) return 'academy__stat academy__stat--high';
  if (value < 50) return 'academy__stat academy__stat--low';
  return 'academy__stat';
}

export function Academy() {
  const career = useCareerStore((s) => s.career);
  const promotePlayer = useCareerStore((s) => s.promotePlayer);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  const fullAcademy = useMemo(
    () => (career ? resolveAcademySquad(career, career.playerClubId) : []),
    [career],
  );

  const academy = useMemo(() => {
    const filtered = filter === 'ALL' ? fullAcademy : fullAcademy.filter((p) => POSITION_GROUP[p.position] === filter);
    return [...filtered].sort((a, b) => b.strength - a.strength);
  }, [fullAcademy, filter]);

  const selectedPlayer = academy.find((p) => p.id === selectedPlayerId) ?? null;

  if (!career) return null;

  function handlePromote(player: Player) {
    promotePlayer(player.id);
    if (selectedPlayerId === player.id) setSelectedPlayerId(null);
  }

  return (
    <div className="academy">
      <div className="academy__header">
        <span className="eyebrow">{fullAcademy.length} promessas na categoria de base</span>
        <div className="academy__filters">
          {POSITION_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`academy__filter${filter === f.id ? ' academy__filter--active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="academy__layout">
        <Card className="academy__card">
          {academy.length === 0 ? (
            <p className="academy__empty">Nenhuma promessa nessa posição.</p>
          ) : (
            <div className="academy__table">
              <div className="academy__row academy__row--head">
                <span>Nome</span>
                <span>Pos</span>
                <span className="numeric">Idade</span>
                <span className="numeric">Força</span>
                <span />
              </div>
              {academy.map((player) => (
                <div
                  key={player.id}
                  className={`academy__row academy__row--clickable${player.id === selectedPlayerId ? ' academy__row--selected' : ''}`}
                  onClick={() => setSelectedPlayerId((current) => (current === player.id ? null : player.id))}
                >
                  <span className="academy__name" title={player.name}>
                    {player.name}
                  </span>
                  <span className="academy__pos">{player.position}</span>
                  <span className="numeric academy__stat">{player.age}</span>
                  <span className={`numeric ${statClass(player.strength)}`}>{player.strength}</span>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePromote(player);
                    }}
                  >
                    Promover
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {selectedPlayer && (
          <Card className="academy__detail">
            <div className="academy__detail-head">
              <div>
                <h2 className="academy__detail-name">{selectedPlayer.name}</h2>
                <p className="academy__detail-meta">
                  {POSITION_LABEL[selectedPlayer.position]} · {selectedPlayer.age} anos · {selectedPlayer.nationality}
                </p>
              </div>
              <Button variant="primary" size="sm" onClick={() => handlePromote(selectedPlayer)}>
                Promover ao elenco
              </Button>
            </div>

            <div className="academy__detail-section">
              <span className="academy__detail-title">Estado</span>
              <div className="academy__detail-bars">
                <ProgressBar value={selectedPlayer.strength} max={100} label={`Geral · ${selectedPlayer.strength}`} />
                <ProgressBar value={selectedPlayer.morale} max={100} label={`Moral · ${selectedPlayer.morale}`} />
              </div>
            </div>

            <div className="academy__detail-section">
              <span className="academy__detail-title">Atributos</span>
              <div className="academy__detail-bars">
                {ATTRIBUTE_ORDER.map((key) => (
                  <ProgressBar
                    key={key}
                    value={selectedPlayer.attributes[key]}
                    max={100}
                    label={`${ATTRIBUTE_LABEL[key]} · ${selectedPlayer.attributes[key]}`}
                  />
                ))}
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
