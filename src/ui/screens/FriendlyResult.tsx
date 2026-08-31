import { useState } from 'react';
import type { Club, MatchResult, Player, PlayerId } from '../../engine/types';
import { CLUB_CRESTS } from '../clubCrests';
import { Badge, Button, Card, IconBall, MatchEventFeed } from '../components';
import './MatchResult.css';
import './Friendly.css';

function IconChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={open ? 'mr-details__chevron mr-details__chevron--open' : 'mr-details__chevron'}
    >
      <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function StatRow({ label, home, away }: { label: string; home: number; away: number }) {
  const total = home + away || 1;
  const homePct = (home / total) * 100;
  return (
    <div className="stat-row">
      <span className="stat-row__value numeric">{home}</span>
      <div className="stat-row__body">
        <span className="stat-row__label">{label}</span>
        <div className="stat-row__track">
          <div className="stat-row__fill stat-row__fill--home" style={{ width: `${homePct}%` }} />
          <div className="stat-row__fill stat-row__fill--away" style={{ width: `${100 - homePct}%` }} />
        </div>
      </div>
      <span className="stat-row__value stat-row__value--away numeric">{away}</span>
    </div>
  );
}

function reasonBadge(impact: number): { label: string; tone: 'pitch' | 'floodlight' | 'neutral' } | null {
  if (impact > 0.05) return { label: 'Mandante', tone: 'pitch' };
  if (impact < -0.05) return { label: 'Visitante', tone: 'floodlight' };
  return null;
}

interface FriendlyResultProps {
  result: MatchResult;
  homeClub: Club;
  awayClub: Club;
  playersById: Map<PlayerId, Player>;
  onPlayAgain: () => void;
  onRebuild: () => void;
  onBackToStart: () => void;
}

export function FriendlyResult({
  result,
  homeClub,
  awayClub,
  playersById,
  onPlayAgain,
  onRebuild,
  onBackToStart,
}: FriendlyResultProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const homeEvents = result.events.filter((e) => e.type === 'goal' && e.teamId === result.homeTeamId);
  const awayEvents = result.events.filter((e) => e.type === 'goal' && e.teamId === result.awayTeamId);
  const motm = playersById.get(result.manOfTheMatch);
  const motmClub = homeClub.squad.includes(result.manOfTheMatch)
    ? homeClub
    : awayClub.squad.includes(result.manOfTheMatch)
      ? awayClub
      : undefined;
  const playerName = (id: string) => playersById.get(id)?.name ?? id;

  return (
    <main className="match-result">
      <div className="mr-header">
        <span className="eyebrow">Amistoso</span>
      </div>

      <Card accentColor={homeClub.colors.primary} className="mr-scoreboard">
        <div className="mr-teams">
          <div className="mr-team">
            {CLUB_CRESTS[homeClub.id] && <img className="mr-team__crest" src={CLUB_CRESTS[homeClub.id]} alt="" />}
            <span className="mr-team__name" title={homeClub.name}>
              {homeClub.name}
            </span>
            {homeEvents.length > 0 && (
              <ul className="mr-goals">
                {homeEvents.map((event, i) => (
                  <li key={i}>
                    <IconBall className="mr-goals__ball" />
                    {event.minute}&apos; {playerName(event.playerId)}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mr-score numeric">
            <span>{result.homeGoals}</span>
            <span className="mr-score__sep">—</span>
            <span>{result.awayGoals}</span>
          </div>

          <div className="mr-team">
            {CLUB_CRESTS[awayClub.id] && <img className="mr-team__crest" src={CLUB_CRESTS[awayClub.id]} alt="" />}
            <span className="mr-team__name" title={awayClub.name}>
              {awayClub.name}
            </span>
            {awayEvents.length > 0 && (
              <ul className="mr-goals">
                {awayEvents.map((event, i) => (
                  <li key={i}>
                    <IconBall className="mr-goals__ball" />
                    {event.minute}&apos; {playerName(event.playerId)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      {motm && (
        <Card accentColor={motmClub?.colors.primary} className="mr-motm">
          {motmClub && CLUB_CRESTS[motmClub.id] && <img className="mr-motm__crest" src={CLUB_CRESTS[motmClub.id]} alt="" />}
          <div>
            <p className="mr-motm__label">Craque da partida</p>
            <p className="mr-motm__name">{motm.name}</p>
          </div>
        </Card>
      )}

      <Card className="mr-details">
        <button
          type="button"
          className="mr-details__toggle"
          onClick={() => setDetailsOpen((v) => !v)}
          aria-expanded={detailsOpen}
        >
          <span>Mostrar detalhes da partida</span>
          <IconChevronDown open={detailsOpen} />
        </button>
        {detailsOpen && (
          <div className="mr-details__body">
            <MatchEventFeed
              events={result.events}
              homeTeamId={result.homeTeamId}
              homeTeamName={homeClub.name}
              awayTeamName={awayClub.name}
              homeCrestSrc={CLUB_CRESTS[homeClub.id]}
              awayCrestSrc={CLUB_CRESTS[awayClub.id]}
              playerName={playerName}
              order="asc"
            />
          </div>
        )}
      </Card>

      <Card className="mr-stats">
        <StatRow label="Posse de bola" home={result.stats.possession.home} away={result.stats.possession.away} />
        <StatRow label="Finalizações" home={result.stats.shots.home} away={result.stats.shots.away} />
        <StatRow label="No alvo" home={result.stats.shotsOnTarget.home} away={result.stats.shotsOnTarget.away} />
        <StatRow label="Faltas" home={result.stats.fouls.home} away={result.stats.fouls.away} />
      </Card>

      <Card className="mr-explanation">
        <span className="eyebrow">Por que esse resultado?</span>
        {result.explanation.map((reason, i) => {
          const badge = reasonBadge(reason.impact);
          return (
            <div className="mr-reason" key={i}>
              <p className="mr-reason__note">{reason.note}</p>
              {badge && (
                <span className="mr-reason__badge">
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                </span>
              )}
            </div>
          );
        })}
      </Card>

      <div className="friendly-result__actions">
        <Button variant="primary" onClick={onPlayAgain}>
          Jogar de novo
        </Button>
        <Button variant="secondary" onClick={onRebuild}>
          Ajustar escalações
        </Button>
        <Button variant="ghost" onClick={onBackToStart}>
          Voltar ao início
        </Button>
      </div>
    </main>
  );
}
