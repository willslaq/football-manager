import { useState } from 'react';
import { useCareerStore } from '../../store/careerStore';
import type { EngineTraceEntry } from '../../engine/types';
import { findClub } from '../utils';
import { CLUB_CRESTS } from '../clubCrests';
import { Button, Card, IconBall, MatchEventFeed, OnPitchList, RoundResultsList, SubstitutionDialog } from '../components';
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
    const cardLabel =
      entry.card === 'none' ? 'sem cartão' : entry.card === 'second_yellow' ? '2º amarelo → vermelho' : entry.card;
    return `#${i} [${entry.minute}'] FALTA ${clubName(entry.teamId)} · ${fouler} em ${victim} · zona=${entry.zone} → ${cardLabel}`;
  }
  if (entry.kind === 'energy') {
    const parts = Object.entries(entry.energyByPlayerId)
      .map(([id, energy]) => `${playerName(id)}=${fmt(energy, 0)}`)
      .join(' ');
    return `#${i} [${entry.minute}'] ENERGIA ${parts}`;
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
  const openSubstitutionDialog = useCareerStore((s) => s.openSubstitutionDialog);
  const closeSubstitutionDialog = useCareerStore((s) => s.closeSubstitutionDialog);
  const selectPitchSlot = useCareerStore((s) => s.selectPitchSlot);
  const queueSwap = useCareerStore((s) => s.queueSwap);
  const removePendingSwap = useCareerStore((s) => s.removePendingSwap);
  const confirmSubstitutions = useCareerStore((s) => s.confirmSubstitutions);
  const [geekOpen, setGeekOpen] = useState(false);

  if (!career || !liveMatch) return null;

  const home = findClub(career, liveMatch.homeTeamId);
  const away = findClub(career, liveMatch.awayTeamId);
  const playersById = new Map(career.world.players.map((p) => [p.id, p]));
  const clubsById = new Map(career.world.clubs.map((c) => [c.id, c]));
  const clubName = (id: string) => clubsById.get(id)?.shortName ?? id;
  const playerName = (id: string) => playersById.get(id)?.name ?? id;
  const playerCondition = (id: string) => playersById.get(id)?.condition ?? 100;

  const homeGoalEvents = liveMatch.events.filter((e) => e.type === 'goal' && e.teamId === liveMatch.homeTeamId);
  const awayGoalEvents = liveMatch.events.filter((e) => e.type === 'goal' && e.teamId === liveMatch.awayTeamId);
  const isShotEvent = (type: string) => type === 'goal' || type === 'shot_saved' || type === 'shot_missed';
  const homeShots = liveMatch.events.filter((e) => isShotEvent(e.type) && e.teamId === liveMatch.homeTeamId).length;
  const awayShots = liveMatch.events.filter((e) => isShotEvent(e.type) && e.teamId === liveMatch.awayTeamId).length;

  const isFullTime = liveMatch.minute >= 90;
  const half = liveMatch.minute > 45 ? '2º tempo' : '1º tempo';
  // Rodada real do confronto ao vivo — mesmo fixture que Home mostrava antes de "Iniciar Partida" —,
  // só pra dar contexto na barra de controle; não afeta o motor nem a UI de resultado.
  const liveRound = career.season.competitions
    .flatMap((c) => c.fixtures.flat())
    .find(
      (f) =>
        f.date === career.season.currentDate &&
        f.homeTeamId === liveMatch.homeTeamId &&
        f.awayTeamId === liveMatch.awayTeamId,
    )?.round;

  return (
    <>
      <div className="ml-topbar">
        <span className="ml-live-badge">
          <span className="ml-live-dot" />
          {isFullTime ? 'Fim de jogo' : liveMatch.paused ? 'Pausado' : 'Ao vivo'}
        </span>
        <span className="ml-minute numeric">{liveMatch.minute}&apos;</span>
        <span className="ml-topbar__context">
          {half}
          {liveRound !== undefined && <> · Rodada {liveRound}</>}
        </span>

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
                1x
              </button>
              <button
                type="button"
                className={liveMatch.speed === 2 ? 'ml-speed-btn ml-speed-btn--active' : 'ml-speed-btn'}
                aria-pressed={liveMatch.speed === 2}
                onClick={() => setLiveMatchSpeed(2)}
              >
                2x
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="match-live-layout">
        <OnPitchList
          pitchRoster={liveMatch.pitchRoster}
          events={liveMatch.events}
          energyByPlayerId={liveMatch.energyByPlayerId}
          playerName={playerName}
          playerCondition={playerCondition}
          onOpen={openSubstitutionDialog}
          disabled={isFullTime}
          subCount={liveMatch.subCount}
        />

        <main className="match-live">
          <div className="fm-glass-hero ml-scoreboard">
            <div className="ml-scoreboard__main">
              <div className="ml-team">
                {home && CLUB_CRESTS[home.id] && <img className="ml-team__crest" src={CLUB_CRESTS[home.id]} alt="" />}
                <span className="ml-team__name" title={home?.name}>
                  {home?.name ?? liveMatch.homeTeamId}
                </span>
              </div>

              <div className="ml-score-center">
                <div className="ml-score numeric">
                  <span>{liveMatch.homeGoals}</span>
                  <span className="ml-score__sep">—</span>
                  <span>{liveMatch.awayGoals}</span>
                </div>
                <span className="ml-score-minute">{liveMatch.minute} minutos</span>
              </div>

              <div className="ml-team">
                {away && CLUB_CRESTS[away.id] && <img className="ml-team__crest" src={CLUB_CRESTS[away.id]} alt="" />}
                <span className="ml-team__name" title={away?.name}>
                  {away?.name ?? liveMatch.awayTeamId}
                </span>
              </div>
            </div>

            <div className="ml-scoreboard__markers">
              <ul className="ml-goals">
                {homeGoalEvents.length > 0 ? (
                  homeGoalEvents.map((event, i) => (
                    <li key={i}>
                      <IconBall className="ml-goals__ball" />
                      {event.minute}&apos; {playerName(event.playerId)}
                    </li>
                  ))
                ) : (
                  <li className="ml-goals__empty">Sem gols</li>
                )}
              </ul>
              <span className="ml-scoreboard__divider" />
              <ul className="ml-goals">
                {awayGoalEvents.length > 0 ? (
                  awayGoalEvents.map((event, i) => (
                    <li key={i}>
                      <IconBall className="ml-goals__ball" />
                      {event.minute}&apos; {playerName(event.playerId)}
                    </li>
                  ))
                ) : (
                  <li className="ml-goals__empty">Sem gols</li>
                )}
              </ul>
            </div>

            <div className="ml-scoreboard__stats">
              <div className="ml-possession">
                <span className="ml-possession__label">Posse de bola</span>
                <span className="ml-possession__value numeric">{liveMatch.possessionHome}%</span>
                <div className="ml-possession__track">
                  <div
                    className="ml-possession__fill ml-possession__fill--home"
                    style={{ width: `${liveMatch.possessionHome}%` }}
                  />
                  <div
                    className="ml-possession__fill ml-possession__fill--away"
                    style={{ width: `${100 - liveMatch.possessionHome}%` }}
                  />
                </div>
                <span className="ml-possession__value ml-possession__value--away numeric">{100 - liveMatch.possessionHome}%</span>
              </div>
              <div className="ml-shots">
                <span className="ml-shots__label">Finalizações</span>
                <span className="ml-shots__value numeric">
                  {homeShots} · {awayShots}
                </span>
              </div>
            </div>
          </div>

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
            {!isFullTime && (
              <Button variant="ghost" block onClick={skipLiveMatch}>
                Pular para o resultado
              </Button>
            )}
          </Card>
        </main>

        <Card className="ml-sidebar" aria-label="Outros jogos do dia">
          <span className="eyebrow">Outros jogos do dia</span>
          <RoundResultsList
            entries={liveMatch.otherMatches}
            playerClubId={career.playerClubId}
            clubName={clubName}
            emptyMessage="Nenhum outro jogo nesse dia."
          />
        </Card>
      </div>

      <SubstitutionDialog
        open={liveMatch.substitutionDialogOpen}
        pitchRoster={liveMatch.pitchRoster}
        benchIds={liveMatch.benchIds}
        pendingSwaps={liveMatch.pendingSwaps}
        selectedPitchSlotId={liveMatch.selectedPitchSlotId}
        subCount={liveMatch.subCount}
        players={career.world.players}
        energyByPlayerId={liveMatch.energyByPlayerId}
        onSelectSlot={selectPitchSlot}
        onQueueSwap={queueSwap}
        onRemovePendingSwap={removePendingSwap}
        onConfirm={confirmSubstitutions}
        onClose={closeSubstitutionDialog}
      />

      {/* Fora de .match-live-layout de propósito: esse container tem transform pra animação de
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
          <button
            type="button"
            className="ml-geek-panel__close"
            onClick={() => setGeekOpen(false)}
            aria-label="Fechar log técnico"
          >
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
