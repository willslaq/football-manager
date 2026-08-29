import type { MatchEvent, PlayerId } from '../../engine/types';
import type { PitchRosterEntry } from '../../store/careerStore';
import { CardButton } from './Card';
import { IconBall, IconCard } from './Icons';
import './OnPitchList.css';

function cardColorForPlayer(events: MatchEvent[], playerId: PlayerId): string | undefined {
  if (events.some((e) => e.type === 'red_card' && e.playerId === playerId)) return 'var(--danger)';
  if (events.some((e) => e.type === 'yellow_card' && e.playerId === playerId)) return 'var(--floodlight)';
  return undefined;
}

function goalCountForPlayer(events: MatchEvent[], playerId: PlayerId): number {
  return events.filter((e) => e.type === 'goal' && e.playerId === playerId).length;
}

export interface OnPitchListProps {
  pitchRoster: PitchRosterEntry[];
  events: MatchEvent[];
  playerName: (id: PlayerId) => string;
  onOpen: () => void;
  disabled?: boolean;
}

/**
 * Lista compacta do XI do jogador em campo, com ícone de cartão/gol por titular — clicável pra
 * abrir o diálogo de substituição (ver SubstitutionDialog), que pausa a partida ao vivo.
 */
export function OnPitchList({ pitchRoster, events, playerName, onOpen, disabled }: OnPitchListProps) {
  if (pitchRoster.length === 0) return null;

  return (
    <CardButton
      className="opl"
      onClick={onOpen}
      disabled={disabled}
      aria-label="Ver escalação em campo e fazer substituições"
    >
      <span className="eyebrow">Em campo</span>
      <ul className="opl__list">
        {pitchRoster.map((entry) => {
          const cardColor = cardColorForPlayer(events, entry.playerId);
          const goals = goalCountForPlayer(events, entry.playerId);
          return (
            <li key={entry.slotId} className="opl__row">
              <span className="opl__pos">{entry.canonicalPosition}</span>
              <span className="opl__name">{playerName(entry.playerId)}</span>
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
