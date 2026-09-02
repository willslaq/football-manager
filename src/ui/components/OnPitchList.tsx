import type { MatchEvent, PlayerId } from '../../engine/types';
import type { PitchRosterEntry } from '../../store/careerStore';
import { CardButton } from './Card';
import { EnergyBar } from './EnergyBar';
import { IconBall, IconCard } from './Icons';
import './OnPitchList.css';

function cardColorForPlayer(events: MatchEvent[], playerId: PlayerId): string | undefined {
  if (events.some((e) => e.type === 'red_card' && e.playerId === playerId)) return 'var(--fm-danger)';
  if (events.some((e) => e.type === 'yellow_card' && e.playerId === playerId)) return 'var(--fm-warn)';
  return undefined;
}

function goalCountForPlayer(events: MatchEvent[], playerId: PlayerId): number {
  return events.filter((e) => e.type === 'goal' && e.playerId === playerId).length;
}

export interface OnPitchListProps {
  pitchRoster: PitchRosterEntry[];
  events: MatchEvent[];
  /** Energia em partida corrente (0-100) de quem está em campo — ver careerStore's liveMatch.energyByPlayerId. */
  energyByPlayerId: Record<PlayerId, number>;
  playerName: (id: PlayerId) => string;
  /** Condição persistida (0-100) de quem entra em campo — fallback pra antes do 1º tick de energia (ver uso abaixo). */
  playerCondition: (id: PlayerId) => number;
  onOpen: () => void;
  disabled?: boolean;
  /** Substituições já confirmadas nessa partida — mostrado no cabeçalho ("3 subs"). */
  subCount?: number;
}

/**
 * Lista compacta do XI do jogador em campo, com energia/cartão/gol por titular — clicável pra
 * abrir o diálogo de substituição (ver SubstitutionDialog), que pausa a partida ao vivo.
 */
export function OnPitchList({
  pitchRoster,
  events,
  energyByPlayerId,
  playerName,
  playerCondition,
  onOpen,
  disabled,
  subCount,
}: OnPitchListProps) {
  if (pitchRoster.length === 0) return null;

  return (
    <CardButton
      className="opl"
      onClick={onOpen}
      disabled={disabled}
      aria-label="Ver escalação em campo e fazer substituições"
    >
      <div className="opl__header">
        <span className="eyebrow">Em campo</span>
        {subCount !== undefined && <span className="opl__sub-count">{subCount} subs</span>}
      </div>
      <ul className="opl__list">
        {pitchRoster.map((entry) => {
          const cardColor = cardColorForPlayer(events, entry.playerId);
          const goals = goalCountForPlayer(events, entry.playerId);
          const rowTone = cardColor ? (cardColor === 'var(--fm-danger)' ? ' opl__row--danger' : ' opl__row--warn') : '';
          return (
            <li key={entry.slotId} className={`opl__row${rowTone}`}>
              <span className="opl__pos">{entry.canonicalPosition}</span>
              <span className="opl__name">{playerName(entry.playerId)}</span>
              {/* Antes do 1º tick de energia (minuto 1), ainda não há entrada pra esse jogador — cai pra
                  `player.condition` (persistido entre partidas), nunca num 100 fixo. */}
              <EnergyBar value={energyByPlayerId[entry.playerId] ?? playerCondition(entry.playerId)} />
              {goals > 0 && (
                <span className="opl__goals">
                  <IconBall className="opl__icon" />
                  {goals > 1 && goals}
                </span>
              )}
              {cardColor && <IconCard color={cardColor} className="opl__icon" />}
            </li>
          );
        })}
      </ul>
    </CardButton>
  );
}
