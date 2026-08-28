import type { ClubId, MatchEvent, MatchEventType } from '../../engine/types';
import { Badge } from './Badge';
import './MatchEventFeed.css';

/** Cartão de árbitro em miniatura, levemente inclinado (mesma linguagem visual de uma transmissão). */
function IconCard({ color }: { color: string }) {
  return (
    <svg width="11" height="15" viewBox="0 0 12 16" aria-hidden="true" className="match-event-feed__card">
      <rect x="1" y="1" width="10" height="14" rx="1.6" fill={color} transform="rotate(-9 6 8)" />
    </svg>
  );
}

const FEED_META: Partial<Record<MatchEventType, { label: string; tone: 'pitch' | 'floodlight' | 'neutral'; verb: string; suffix: string }>> = {
  goal: { label: 'GOL', tone: 'pitch', verb: 'Gol de', suffix: '' },
  shot_saved: { label: 'DEFESA', tone: 'floodlight', verb: 'Chute de', suffix: ', defendido pelo goleiro' },
  shot_missed: { label: 'PRA FORA', tone: 'neutral', verb: 'Chute de', suffix: ', pra fora' },
  yellow_card: { label: 'AMARELO', tone: 'neutral', verb: 'Cartão amarelo para', suffix: '' },
  red_card: { label: 'VERMELHO', tone: 'floodlight', verb: 'Cartão vermelho para', suffix: '' },
};

/** Cor do cartão gráfico por tipo de evento — só yellow_card/red_card usam IconCard, o resto usa Badge. */
const CARD_COLOR: Partial<Record<MatchEventType, string>> = {
  yellow_card: 'var(--floodlight)',
  red_card: 'var(--danger)',
};

function FeedItem({
  event,
  teamName,
  crestSrc,
  playerName,
}: {
  event: MatchEvent;
  teamName?: string;
  crestSrc?: string;
  playerName: string;
}) {
  const meta = FEED_META[event.type];
  if (!meta) return null;
  const cardColor = CARD_COLOR[event.type];
  return (
    <li className="match-event-feed__item">
      <span className="match-event-feed__minute numeric">{event.minute}&apos;</span>
      {cardColor ? <IconCard color={cardColor} /> : <Badge tone={meta.tone}>{meta.label}</Badge>}
      <span className="match-event-feed__text">
        {meta.verb} {playerName}
        {meta.suffix}
        {event.setPiece === 'penalty' ? ' (pênalti)' : event.setPiece === 'free_kick' ? ' (falta)' : ''}{' '}
        {crestSrc ? (
          <img className="match-event-feed__team-crest" src={crestSrc} alt={teamName ?? ''} title={teamName} />
        ) : (
          teamName
        )}
      </span>
    </li>
  );
}

export interface MatchEventFeedProps {
  events: MatchEvent[];
  /** Só o mandante precisa ser identificado — quem não é ele, na partida, é o visitante. */
  homeTeamId: ClubId;
  homeTeamName?: string;
  awayTeamName?: string;
  homeCrestSrc?: string;
  awayCrestSrc?: string;
  playerName: (playerId: string) => string;
  /** 'desc' = mais recente primeiro (feed ao vivo); 'asc' = ordem cronológica (relatório pós-jogo). */
  order?: 'asc' | 'desc';
  emptyMessage?: string;
}

/**
 * Lista de eventos de uma partida (gol, cartão, chute...) com ícone/crachá por tipo e o
 * escudo do time — usada tanto no lance a lance ao vivo (MatchLive) quanto no relatório
 * pós-jogo (MatchResult), único lugar dessa renderização pra não divergir entre os dois.
 */
export function MatchEventFeed({
  events,
  homeTeamId,
  homeTeamName,
  awayTeamName,
  homeCrestSrc,
  awayCrestSrc,
  playerName,
  order = 'asc',
  emptyMessage = 'Nenhum evento registrado.',
}: MatchEventFeedProps) {
  if (events.length === 0) {
    return <p className="match-event-feed__empty">{emptyMessage}</p>;
  }

  const indexed = events.map((event, i) => ({ event, i }));
  // Índice na ordem cronológica (estável conforme a lista só cresce), não na exibida — senão o
  // React reconcilia por posição visual e um item novo (ao vivo, entra no topo) reaproveita o nó
  // DOM do item anterior em vez de montar um novo, e a animação de entrada nunca dispara nele.
  const ordered = order === 'desc' ? [...indexed].reverse() : indexed;

  return (
    <ul className="match-event-feed__list">
      {ordered.map(({ event, i }) => {
        const isHome = event.teamId === homeTeamId;
        return (
          <FeedItem
            key={i}
            event={event}
            teamName={isHome ? homeTeamName : awayTeamName}
            crestSrc={isHome ? homeCrestSrc : awayCrestSrc}
            playerName={playerName(event.playerId)}
          />
        );
      })}
    </ul>
  );
}
