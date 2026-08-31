import type { LiveMatchSpeed } from '../../worker/liveMatch';
import type { Club, MatchEvent, Player, PlayerId } from '../../engine/types';
import { CLUB_CRESTS } from '../clubCrests';
import { Button, Card, IconBall, MatchEventFeed } from '../components';
import './MatchLive.css';

function IconPlay() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.3v11.4c0 .7.8 1.1 1.4.7l9-5.7a.85.85 0 0 0 0-1.4l-9-5.7C4.8 1.2 4 1.6 4 2.3z" fill="currentColor" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3.5" y="2.5" width="3" height="11" rx="0.5" fill="currentColor" />
      <rect x="9.5" y="2.5" width="3" height="11" rx="0.5" fill="currentColor" />
    </svg>
  );
}

function IconChevron() {
  return (
    <svg width="7" height="12" viewBox="0 0 7 12" aria-hidden="true">
      <path d="M1 1l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export interface FriendlyLiveState {
  minute: number;
  homeGoals: number;
  awayGoals: number;
  possessionHome: number;
  events: MatchEvent[];
  paused: boolean;
  speed: LiveMatchSpeed;
}

interface FriendlyLiveProps {
  homeClub: Club;
  awayClub: Club;
  playersById: Map<PlayerId, Player>;
  live: FriendlyLiveState;
  onTogglePause: () => void;
  onSetSpeed: (speed: LiveMatchSpeed) => void;
  onSkip: () => void;
}

/**
 * Puramente apresentacional — quem cria e mantém o `LiveMatchController` é `Friendly.tsx`, direto
 * no clique de "Simular partida" (nunca dentro de um efeito daqui): sob StrictMode, um efeito que
 * criasse a transmissão no mount seria montado→limpo→montado de novo, e a limpeza (`skip()`)
 * entregaria a partida inteira instantaneamente antes da segunda montagem real.
 */
export function FriendlyLive({ homeClub, awayClub, playersById, live, onTogglePause, onSetSpeed, onSkip }: FriendlyLiveProps) {
  const playerName = (id: string) => playersById.get(id)?.name ?? id;
  const isFullTime = live.minute >= 90;
  const homeGoalEvents = live.events.filter((e) => e.type === 'goal' && e.teamId === homeClub.id);
  const awayGoalEvents = live.events.filter((e) => e.type === 'goal' && e.teamId === awayClub.id);

  return (
    <main className="match-live">
      <div className="ml-header">
        <span className="ml-live-badge">
          <span className="ml-live-dot" />
          {isFullTime ? 'Fim de jogo' : live.paused ? 'Pausado' : 'Ao vivo'}
        </span>
        <span className="ml-minute numeric">{live.minute}&apos;</span>
      </div>

      {!isFullTime && (
        <div className="ml-controls">
          <Button variant="secondary" size="sm" onClick={onTogglePause} aria-pressed={live.paused}>
            {live.paused ? <IconPlay /> : <IconPause />}
            {live.paused ? 'Retomar' : 'Pausar'}
          </Button>

          <div className="ml-speed-toggle" role="group" aria-label="Velocidade da simulação">
            <button
              type="button"
              className={live.speed === 1 ? 'ml-speed-btn ml-speed-btn--active' : 'ml-speed-btn'}
              aria-pressed={live.speed === 1}
              onClick={() => onSetSpeed(1)}
            >
              <IconChevron />
              1x
            </button>
            <button
              type="button"
              className={live.speed === 2 ? 'ml-speed-btn ml-speed-btn--active' : 'ml-speed-btn'}
              aria-pressed={live.speed === 2}
              onClick={() => onSetSpeed(2)}
            >
              <IconChevron />
              <IconChevron />
              2x
            </button>
          </div>
        </div>
      )}

      <Card accentColor={homeClub.colors.primary} className="ml-scoreboard">
        <div className="ml-teams">
          <div className="ml-team">
            {CLUB_CRESTS[homeClub.id] && <img className="ml-team__crest" src={CLUB_CRESTS[homeClub.id]} alt="" />}
            <span className="ml-team__name" title={homeClub.name}>
              {homeClub.name}
            </span>
            {homeGoalEvents.length > 0 && (
              <ul className="ml-goals">
                {homeGoalEvents.map((event, i) => (
                  <li key={i}>
                    <IconBall className="ml-goals__ball" />
                    {event.minute}&apos; {playerName(event.playerId)}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="ml-score numeric">
            <span>{live.homeGoals}</span>
            <span className="ml-score__sep">—</span>
            <span>{live.awayGoals}</span>
          </div>

          <div className="ml-team">
            {CLUB_CRESTS[awayClub.id] && <img className="ml-team__crest" src={CLUB_CRESTS[awayClub.id]} alt="" />}
            <span className="ml-team__name" title={awayClub.name}>
              {awayClub.name}
            </span>
            {awayGoalEvents.length > 0 && (
              <ul className="ml-goals">
                {awayGoalEvents.map((event, i) => (
                  <li key={i}>
                    <IconBall className="ml-goals__ball" />
                    {event.minute}&apos; {playerName(event.playerId)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      <Card className="ml-possession">
        <div className="ml-possession__row">
          <span className="ml-possession__value numeric">{live.possessionHome}%</span>
          <div className="ml-possession__body">
            <span className="ml-possession__label">Posse de bola</span>
            <div className="ml-possession__track">
              <div className="ml-possession__fill ml-possession__fill--home" style={{ width: `${live.possessionHome}%` }} />
              <div className="ml-possession__fill ml-possession__fill--away" style={{ width: `${100 - live.possessionHome}%` }} />
            </div>
          </div>
          <span className="ml-possession__value ml-possession__value--away numeric">{100 - live.possessionHome}%</span>
        </div>
      </Card>

      <Card className="ml-feed">
        <span className="eyebrow">Lance a lance</span>
        <MatchEventFeed
          events={live.events}
          homeTeamId={homeClub.id}
          homeTeamName={homeClub.name}
          awayTeamName={awayClub.name}
          homeCrestSrc={CLUB_CRESTS[homeClub.id]}
          awayCrestSrc={CLUB_CRESTS[awayClub.id]}
          playerName={playerName}
          order="desc"
          emptyMessage="Partida em andamento…"
        />
      </Card>

      {!isFullTime && (
        <Button variant="ghost" block onClick={onSkip}>
          Pular para o resultado
        </Button>
      )}
    </main>
  );
}
