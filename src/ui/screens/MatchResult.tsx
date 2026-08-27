import { useCareerStore } from '../../store/careerStore';
import { findClub } from '../utils';
import { CLUB_CRESTS } from '../clubCrests';
import { Badge, Button, Card } from '../components';
import type { Screen } from '../../App';
import './MatchResult.css';

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

export function MatchResult({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  const career = useCareerStore((s) => s.career);
  const lastMatch = useCareerStore((s) => s.lastMatch);

  if (!career || !lastMatch) return null;

  const home = findClub(career, lastMatch.homeTeamId);
  const away = findClub(career, lastMatch.awayTeamId);
  const playersById = new Map(career.world.players.map((p) => [p.id, p]));
  const competition = career.season.competitions[0];
  const roundPlayed = career.season.currentRound - 1;

  const isPlayerHome = lastMatch.homeTeamId === career.playerClubId;
  const isPlayerAway = lastMatch.awayTeamId === career.playerClubId;
  const playerGoals = isPlayerHome ? lastMatch.homeGoals : lastMatch.awayGoals;
  const opponentGoals = isPlayerHome ? lastMatch.awayGoals : lastMatch.homeGoals;
  const outcome =
    isPlayerHome || isPlayerAway
      ? playerGoals > opponentGoals
        ? 'win'
        : playerGoals < opponentGoals
          ? 'loss'
          : 'draw'
      : null;
  const outcomeLabel = outcome === 'win' ? 'Vitória' : outcome === 'loss' ? 'Derrota' : outcome === 'draw' ? 'Empate' : null;

  const homeEvents = lastMatch.events.filter((e) => e.type === 'goal' && e.teamId === lastMatch.homeTeamId);
  const awayEvents = lastMatch.events.filter((e) => e.type === 'goal' && e.teamId === lastMatch.awayTeamId);

  const motm = playersById.get(lastMatch.manOfTheMatch);
  const motmClub = home?.squad.includes(lastMatch.manOfTheMatch) ? home : away?.squad.includes(lastMatch.manOfTheMatch) ? away : undefined;

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
              {home?.name ?? lastMatch.homeTeamId}
            </span>
            {homeEvents.length > 0 && (
              <ul className="mr-goals">
                {homeEvents.map((event, i) => (
                  <li key={i}>
                    {event.minute}&apos; {playersById.get(event.playerId)?.name ?? event.playerId}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mr-score numeric">
            <span>{lastMatch.homeGoals}</span>
            <span className="mr-score__sep">—</span>
            <span>{lastMatch.awayGoals}</span>
          </div>

          <div className="mr-team">
            {away && CLUB_CRESTS[away.id] && <img className="mr-team__crest" src={CLUB_CRESTS[away.id]} alt="" />}
            <span className="mr-team__name" title={away?.name}>
              {away?.name ?? lastMatch.awayTeamId}
            </span>
            {awayEvents.length > 0 && (
              <ul className="mr-goals">
                {awayEvents.map((event, i) => (
                  <li key={i}>
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
          {motmClub && CLUB_CRESTS[motmClub.id] && (
            <img className="mr-motm__crest" src={CLUB_CRESTS[motmClub.id]} alt="" />
          )}
          <div>
            <p className="mr-motm__label">Craque da partida</p>
            <p className="mr-motm__name">{motm.name}</p>
          </div>
        </Card>
      )}

      <Card className="mr-stats">
        <StatRow label="Posse de bola" home={lastMatch.stats.possession.home} away={lastMatch.stats.possession.away} />
        <StatRow label="Finalizações" home={lastMatch.stats.shots.home} away={lastMatch.stats.shots.away} />
        <StatRow label="No alvo" home={lastMatch.stats.shotsOnTarget.home} away={lastMatch.stats.shotsOnTarget.away} />
      </Card>

      <Card className="mr-explanation">
        <span className="eyebrow">Por que esse resultado?</span>
        {lastMatch.explanation.map((reason, i) => {
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

      <Button variant="primary" block onClick={() => onNavigate('home')}>
        Continuar
      </Button>
    </main>
  );
}
