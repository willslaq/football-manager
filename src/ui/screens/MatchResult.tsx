import { useState } from 'react';
import { useCareerStore } from '../../store/careerStore';
import { findClub } from '../utils';
import { CLUB_CRESTS } from '../clubCrests';
import { Badge, Button, Card, IconBall, MatchEventFeed, RoundResultsList } from '../components';
import type { Screen } from '../../App';
import type { MatchResult as MatchResultData } from '../../engine/types';
import './MatchResult.css';

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

interface MatchResultProps {
  onNavigate: (screen: Screen) => void;
  /** Resultado específico a exibir (ex.: partida do histórico). Sem isso, usa a última partida jogada. */
  result?: MatchResultData;
}

export function MatchResult({ onNavigate, result: resultProp }: MatchResultProps) {
  const career = useCareerStore((s) => s.career);
  const lastMatch = useCareerStore((s) => s.lastMatch);
  const match = resultProp ?? lastMatch;
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (!career || !match) return null;

  const home = findClub(career, match.homeTeamId);
  const away = findClub(career, match.awayTeamId);
  const playersById = new Map(career.world.players.map((p) => [p.id, p]));
  const clubsById = new Map(career.world.clubs.map((c) => [c.id, c]));
  const clubName = (id: string) => clubsById.get(id)?.shortName ?? id;
  const competition = career.season.competitions[0];
  const matchRoundIndex = competition.fixtures.findIndex((round) => round.some((f) => f.result === match));
  const roundPlayed = matchRoundIndex === -1 ? career.season.currentRound - 1 : matchRoundIndex + 1;
  const roundFixtures = matchRoundIndex === -1 ? [] : competition.fixtures[matchRoundIndex];

  const isPlayerHome = match.homeTeamId === career.playerClubId;
  const isPlayerAway = match.awayTeamId === career.playerClubId;
  const playerGoals = isPlayerHome ? match.homeGoals : match.awayGoals;
  const opponentGoals = isPlayerHome ? match.awayGoals : match.homeGoals;
  const outcome =
    isPlayerHome || isPlayerAway ? (playerGoals > opponentGoals ? 'win' : playerGoals < opponentGoals ? 'loss' : 'draw') : null;
  const outcomeLabel = outcome === 'win' ? 'Vitória' : outcome === 'loss' ? 'Derrota' : outcome === 'draw' ? 'Empate' : null;

  const homeEvents = match.events.filter((e) => e.type === 'goal' && e.teamId === match.homeTeamId);
  const awayEvents = match.events.filter((e) => e.type === 'goal' && e.teamId === match.awayTeamId);

  const motm = playersById.get(match.manOfTheMatch);
  const motmClub = home?.squad.includes(match.manOfTheMatch)
    ? home
    : away?.squad.includes(match.manOfTheMatch)
      ? away
      : undefined;

  const playerName = (id: string) => playersById.get(id)?.name ?? id;

  return (
    <main className="match-result">
      <div className="mr-header">
        {outcomeLabel && <span className={`mr-outcome mr-outcome--${outcome}`}>{outcomeLabel}</span>}
        <span className="eyebrow">
          Rodada {roundPlayed}/{competition.fixtures.length} · {competition.name}
        </span>
      </div>

      <Card accentColor={home?.colors.primary} className="mr-scoreboard">
        <div className="mr-teams">
          <div className="mr-team">
            {home && CLUB_CRESTS[home.id] && <img className="mr-team__crest" src={CLUB_CRESTS[home.id]} alt="" />}
            <span className="mr-team__name" title={home?.name}>
              {home?.name ?? match.homeTeamId}
            </span>
            {homeEvents.length > 0 && (
              <ul className="mr-goals">
                {homeEvents.map((event, i) => (
                  <li key={i}>
                    <IconBall className="mr-goals__ball" />
                    {event.minute}&apos; {playersById.get(event.playerId)?.name ?? event.playerId}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mr-score numeric">
            <span>{match.homeGoals}</span>
            <span className="mr-score__sep">—</span>
            <span>{match.awayGoals}</span>
          </div>

          <div className="mr-team">
            {away && CLUB_CRESTS[away.id] && <img className="mr-team__crest" src={CLUB_CRESTS[away.id]} alt="" />}
            <span className="mr-team__name" title={away?.name}>
              {away?.name ?? match.awayTeamId}
            </span>
            {awayEvents.length > 0 && (
              <ul className="mr-goals">
                {awayEvents.map((event, i) => (
                  <li key={i}>
                    <IconBall className="mr-goals__ball" />
                    {event.minute}&apos; {playersById.get(event.playerId)?.name ?? event.playerId}
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
              events={match.events}
              homeTeamId={match.homeTeamId}
              homeTeamName={home?.name}
              awayTeamName={away?.name}
              homeCrestSrc={home && CLUB_CRESTS[home.id]}
              awayCrestSrc={away && CLUB_CRESTS[away.id]}
              playerName={playerName}
              order="asc"
            />
          </div>
        )}
      </Card>

      <Card className="mr-stats">
        <StatRow label="Posse de bola" home={match.stats.possession.home} away={match.stats.possession.away} />
        <StatRow label="Finalizações" home={match.stats.shots.home} away={match.stats.shots.away} />
        <StatRow label="No alvo" home={match.stats.shotsOnTarget.home} away={match.stats.shotsOnTarget.away} />
        <StatRow label="Faltas" home={match.stats.fouls.home} away={match.stats.fouls.away} />
      </Card>

      <Card className="mr-explanation">
        <span className="eyebrow">Por que esse resultado?</span>
        {match.explanation.map((reason, i) => {
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

      {roundFixtures.length > 1 && (
        <Card className="mr-round">
          <span className="eyebrow">Resultado da rodada {roundPlayed}</span>
          <RoundResultsList
            entries={roundFixtures.map((f) => ({
              homeTeamId: f.homeTeamId,
              awayTeamId: f.awayTeamId,
              homeGoals: f.result?.homeGoals ?? 0,
              awayGoals: f.result?.awayGoals ?? 0,
              finished: !!f.result,
            }))}
            playerClubId={career.playerClubId}
            clubName={clubName}
          />
        </Card>
      )}

      <Button variant="primary" block onClick={() => onNavigate(resultProp ? 'matchHistory' : 'home')}>
        {resultProp ? 'Voltar ao histórico' : 'Continuar'}
      </Button>
    </main>
  );
}
