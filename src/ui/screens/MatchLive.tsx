import { useState } from 'react';
import { useCareerStore } from '../../store/careerStore';
import type { EngineTraceEntry } from '../../engine/types';
import { findClub } from '../utils';
import { CLUB_CRESTS } from '../clubCrests';
import { Button, Card, MatchEventFeed } from '../components';
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

function IconTerminal() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2 3.5l4 4-4 4M8 12h6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits);
}

/** Formata uma entrada do rastro técnico bruto do motor pro modo geek — texto de terminal, não pra jogador comum. */
function formatTraceEntry(
  entry: EngineTraceEntry,
  i: number,
  clubName: (id: string) => string,
  playerName: (id: string) => string,
): string {
  if (entry.kind === 'setup') {
    return [
      `#${i} SETUP`,
      `  ${clubName(entry.home.clubId)} (casa)  atk=${fmt(entry.home.attack)} def=${fmt(entry.home.defense)} mid=${fmt(entry.home.midfield)}`,
      `  ${clubName(entry.away.clubId)} (fora)  atk=${fmt(entry.away.attack)} def=${fmt(entry.away.defense)} mid=${fmt(entry.away.midfield)}`,
      `  posse=${fmt(entry.possessionHome * 100, 0)}%/${fmt((1 - entry.possessionHome) * 100, 0)}%  chances=${entry.homeChanceCount}/${entry.awayChanceCount}`,
    ].join('\n');
  }
  if (entry.kind === 'possession') {
    return `#${i} [${entry.minute}'] posse=${fmt(entry.possessionHome * 100, 0)}%`;
  }
  if (entry.kind === 'foul') {
    const fouler = entry.foulerId ? playerName(entry.foulerId) : '?';
    const victim = entry.victimId ? playerName(entry.victimId) : '?';
    const cardLabel = entry.card === 'none' ? 'sem cartão' : entry.card === 'second_yellow' ? '2º amarelo → vermelho' : entry.card;
    return `#${i} [${entry.minute}'] FALTA ${clubName(entry.teamId)} · ${fouler} em ${victim} · zona=${entry.zone} → ${cardLabel}`;
  }
  const outcome = entry.isGoal ? 'GOL' : entry.isOnTarget ? 'no alvo (defendido)' : 'fora';
  const shooter = entry.shooterId ? playerName(entry.shooterId) : '?';
  return `#${i} [${entry.minute}'] ${clubName(entry.teamId)} · ${shooter}  atk=${fmt(entry.attackStrength)} vs def=${fmt(entry.defenseStrength)} → quality=${fmt(entry.quality, 3)} → prob=${fmt(entry.goalProbability * 100, 0)}% → ${outcome}`;
}

export function MatchLive() {
  const career = useCareerStore((s) => s.career);
  const liveMatch = useCareerStore((s) => s.liveMatch);
  const engineLog = useCareerStore((s) => s.engineLog);
  const skipLiveMatch = useCareerStore((s) => s.skipLiveMatch);
  const setLiveMatchSpeed = useCareerStore((s) => s.setLiveMatchSpeed);
  const toggleLiveMatchPause = useCareerStore((s) => s.toggleLiveMatchPause);
  const [geekOpen, setGeekOpen] = useState(false);

  if (!career || !liveMatch) return null;

  const home = findClub(career, liveMatch.homeTeamId);
  const away = findClub(career, liveMatch.awayTeamId);
  const playersById = new Map(career.world.players.map((p) => [p.id, p]));
  const clubsById = new Map(career.world.clubs.map((c) => [c.id, c]));
  const clubName = (id: string) => clubsById.get(id)?.shortName ?? id;
  const playerName = (id: string) => playersById.get(id)?.name ?? id;

  const homeGoalEvents = liveMatch.events.filter((e) => e.type === 'goal' && e.teamId === liveMatch.homeTeamId);
  const awayGoalEvents = liveMatch.events.filter((e) => e.type === 'goal' && e.teamId === liveMatch.awayTeamId);

  const isFullTime = liveMatch.minute >= 90;

  return (
    <>
      <main className="match-live">
        <div className="ml-header">
          <span className="ml-live-badge">
            <span className="ml-live-dot" />
            {isFullTime ? 'Fim de jogo' : liveMatch.paused ? 'Pausado' : 'Ao vivo'}
          </span>
          <span className="ml-minute numeric">{liveMatch.minute}&apos;</span>
        </div>

        {!isFullTime && (
          <div className="ml-controls">
            <Button variant="secondary" size="sm" onClick={toggleLiveMatchPause} aria-pressed={liveMatch.paused}>
              {liveMatch.paused ? <IconPlay /> : <IconPause />}
              {liveMatch.paused ? 'Retomar' : 'Pausar'}
            </Button>

            <div className="ml-speed-toggle" role="group" aria-label="Velocidade da simulação">
              <button
                type="button"
                className={liveMatch.speed === 1 ? 'ml-speed-btn ml-speed-btn--active' : 'ml-speed-btn'}
                aria-pressed={liveMatch.speed === 1}
                onClick={() => setLiveMatchSpeed(1)}
              >
                <IconChevron />
                1x
              </button>
              <button
                type="button"
                className={liveMatch.speed === 2 ? 'ml-speed-btn ml-speed-btn--active' : 'ml-speed-btn'}
                aria-pressed={liveMatch.speed === 2}
                onClick={() => setLiveMatchSpeed(2)}
              >
                <IconChevron />
                <IconChevron />
                2x
              </button>
            </div>
          </div>
        )}

        <Card accentColor={home?.colors.primary} className="ml-scoreboard">
          <div className="ml-teams">
            <div className="ml-team">
              {home && CLUB_CRESTS[home.id] && <img className="ml-team__crest" src={CLUB_CRESTS[home.id]} alt="" />}
              <span className="ml-team__name" title={home?.name}>
                {home?.name ?? liveMatch.homeTeamId}
              </span>
              {homeGoalEvents.length > 0 && (
                <ul className="ml-goals">
                  {homeGoalEvents.map((event, i) => (
                    <li key={i}>
                      {event.minute}&apos; {playerName(event.playerId)}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="ml-score numeric">
              <span>{liveMatch.homeGoals}</span>
              <span className="ml-score__sep">—</span>
              <span>{liveMatch.awayGoals}</span>
            </div>

            <div className="ml-team">
              {away && CLUB_CRESTS[away.id] && <img className="ml-team__crest" src={CLUB_CRESTS[away.id]} alt="" />}
              <span className="ml-team__name" title={away?.name}>
                {away?.name ?? liveMatch.awayTeamId}
              </span>
              {awayGoalEvents.length > 0 && (
                <ul className="ml-goals">
                  {awayGoalEvents.map((event, i) => (
                    <li key={i}>
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
            <span className="ml-possession__value numeric">{liveMatch.possessionHome}%</span>
            <div className="ml-possession__body">
              <span className="ml-possession__label">Posse de bola</span>
              <div className="ml-possession__track">
                <div className="ml-possession__fill ml-possession__fill--home" style={{ width: `${liveMatch.possessionHome}%` }} />
                <div
                  className="ml-possession__fill ml-possession__fill--away"
                  style={{ width: `${100 - liveMatch.possessionHome}%` }}
                />
              </div>
            </div>
            <span className="ml-possession__value ml-possession__value--away numeric">{100 - liveMatch.possessionHome}%</span>
          </div>
        </Card>

        <Card className="ml-feed">
          <span className="eyebrow">Lance a lance</span>
          <MatchEventFeed
            events={liveMatch.events}
            homeTeamId={liveMatch.homeTeamId}
            homeTeamName={home?.name}
            awayTeamName={away?.name}
            homeCrestSrc={home && CLUB_CRESTS[home.id]}
            awayCrestSrc={away && CLUB_CRESTS[away.id]}
            playerName={playerName}
            order="desc"
            emptyMessage="Partida em andamento…"
          />
        </Card>

        {!isFullTime && (
          <Button variant="ghost" block onClick={skipLiveMatch}>
            Pular para o resultado
          </Button>
        )}
      </main>

      {/* Fora de .match-live de propósito: esse container tem transform pra animação de
          entrada, e um ancestral com transform vira containing block de position:fixed —
          o painel "escondido" fora da tela ficaria visível de novo dependendo da largura da janela. */}
      <button
        type="button"
        className="ml-geek-toggle"
        onClick={() => setGeekOpen((v) => !v)}
        title="Log técnico do motor"
        aria-label="Abrir log técnico do motor"
        aria-pressed={geekOpen}
      >
        <IconTerminal />
      </button>

      <div className={geekOpen ? 'ml-geek-panel ml-geek-panel--open' : 'ml-geek-panel'} aria-hidden={!geekOpen}>
        <div className="ml-geek-panel__header">
          <span>engine.log</span>
          <button type="button" className="ml-geek-panel__close" onClick={() => setGeekOpen(false)} aria-label="Fechar log técnico">
            ×
          </button>
        </div>
        <pre className="ml-geek-panel__body">
          {engineLog.length === 0
            ? 'aguardando computação…'
            : engineLog.map((entry, i) => formatTraceEntry(entry, i, clubName, playerName)).join('\n\n')}
        </pre>
      </div>
    </>
  );
}
