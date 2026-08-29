import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useCareerStore } from '../../store/careerStore';
import { findClub } from '../utils';
import { CLUB_CRESTS } from '../clubCrests';
import { Badge, Button, Card, CardButton, IconBall } from '../components';
import type { ClubId, Fixture, MatchEvent, MatchResult, Player } from '../../engine/types';
import './MatchHistory.css';

interface MatchHistoryProps {
  onSelect: (result: MatchResult) => void;
  onBack: () => void;
}

type Filter = 'mine' | 'all';
type Outcome = 'win' | 'draw' | 'loss';

const OUTCOME_LABEL: Record<Outcome, string> = { win: 'Vitória', draw: 'Empate', loss: 'Derrota' };
/** Mesmas cores usadas no restante da UI (badges de zona na Tabela, outcome no MatchResult). */
const OUTCOME_VAR: Record<Outcome, string> = {
  win: 'var(--pitch)',
  draw: 'var(--floodlight)',
  loss: 'var(--danger)',
};

function outcomeFor(fixture: Fixture, playerClubId: ClubId): Outcome | null {
  const result = fixture.result;
  if (!result) return null;
  const isHome = fixture.homeTeamId === playerClubId;
  if (!isHome && fixture.awayTeamId !== playerClubId) return null;
  const mine = isHome ? result.homeGoals : result.awayGoals;
  const theirs = isHome ? result.awayGoals : result.homeGoals;
  return mine > theirs ? 'win' : mine < theirs ? 'loss' : 'draw';
}

/** "Fulano 36' 75'" — um gol por minuto, agrupado por autor na ordem em que ele marcou. */
function scorerLines(events: MatchEvent[], teamId: ClubId, playersById: Map<string, Player>): string[] {
  const minutesByPlayer = new Map<string, number[]>();
  const order: string[] = [];
  for (const event of events) {
    if (event.type !== 'goal' || event.teamId !== teamId) continue;
    if (!minutesByPlayer.has(event.playerId)) {
      minutesByPlayer.set(event.playerId, []);
      order.push(event.playerId);
    }
    minutesByPlayer.get(event.playerId)!.push(event.minute);
  }
  return order.map((playerId) => {
    const name = playersById.get(playerId)?.name ?? playerId;
    const minutes = minutesByPlayer
      .get(playerId)!
      .sort((a, b) => a - b)
      .map((m) => `${m}'`)
      .join(' ');
    return `${name} ${minutes}`;
  });
}

/** Caps o delay do stagger — com muitas rodadas jogadas, a lista não deve levar segundos pra "acordar". */
function staggerStyle(index: number): CSSProperties {
  return { '--i': Math.min(index, 8) } as CSSProperties;
}

export function MatchHistory({ onSelect, onBack }: MatchHistoryProps) {
  const career = useCareerStore((s) => s.career);
  const [filter, setFilter] = useState<Filter>('mine');
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  if (!career) return null;

  const competition = career.season.competitions[0];
  const playersById = new Map(career.world.players.map((p) => [p.id, p]));
  const playedRounds = competition.fixtures
    .map((fixtures, index) => ({ roundNumber: index + 1, fixtures }))
    .filter((round) => round.fixtures.some((f) => f.result))
    .reverse();

  const roundNumbers = playedRounds.map((r) => r.roundNumber);
  const minRound = roundNumbers.length ? Math.min(...roundNumbers) : 0;
  const maxRound = roundNumbers.length ? Math.max(...roundNumbers) : 0;
  const activeRound = selectedRound !== null && roundNumbers.includes(selectedRound) ? selectedRound : (roundNumbers[0] ?? null);
  const activeRoundData = playedRounds.find((r) => r.roundNumber === activeRound);

  function goToRound(n: number) {
    if (n < minRound || n > maxRound) return;
    setSelectedRound(n);
  }

  return (
    <main className="match-history">
      <div className="mh-header">
        <div>
          <span className="eyebrow">{competition.name}</span>
          <h1 className="mh-title">Histórico de partidas</h1>
        </div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Voltar
        </Button>
      </div>

      <div className="mh-filter" role="group" aria-label="Filtrar partidas exibidas">
        <Button size="sm" variant={filter === 'mine' ? 'primary' : 'secondary'} aria-pressed={filter === 'mine'} onClick={() => setFilter('mine')}>
          Meus jogos
        </Button>
        <Button size="sm" variant={filter === 'all' ? 'primary' : 'secondary'} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          Rodada completa
        </Button>
      </div>

      {playedRounds.length === 0 && (
        <Card className="mh-empty">
          <p>Nenhuma partida disputada ainda — volte aqui depois de avançar uma rodada.</p>
        </Card>
      )}

      {filter === 'mine' && (
        <div className="mh-timeline">
          {playedRounds.map(({ roundNumber, fixtures }, i) => {
            const ownFixture = fixtures.find((f) => f.homeTeamId === career.playerClubId || f.awayTeamId === career.playerClubId);
            if (!ownFixture?.result) return null;
            const isHome = ownFixture.homeTeamId === career.playerClubId;
            const home = findClub(career, ownFixture.homeTeamId);
            const away = findClub(career, ownFixture.awayTeamId);
            const outcome = outcomeFor(ownFixture, career.playerClubId)!;
            const homeScorers = scorerLines(ownFixture.result.events, ownFixture.homeTeamId, playersById);
            const awayScorers = scorerLines(ownFixture.result.events, ownFixture.awayTeamId, playersById);

            return (
              <CardButton
                key={roundNumber}
                className="mh-match"
                accentColor={OUTCOME_VAR[outcome]}
                style={staggerStyle(i)}
                onClick={() => onSelect(ownFixture.result!)}
              >
                <div className="mh-match__meta">
                  <span className="mh-match__round">Rodada {roundNumber}</span>
                  <Badge tone={isHome ? 'pitch' : 'neutral'}>{isHome ? 'Mandante' : 'Visitante'}</Badge>
                </div>

                <div className="mh-match__result">
                  <span className={`mh-match__outcome mh-match__outcome--${outcome}`}>{OUTCOME_LABEL[outcome]}</span>

                  <div className="mh-match__body">
                    <div className="mh-match__side">
                      <span className="mh-match__team">
                        {home && CLUB_CRESTS[home.id] && <img className="mh-match__crest" src={CLUB_CRESTS[home.id]} alt="" />}
                        <span className="mh-match__name" title={home?.name}>
                          {home?.name ?? ownFixture.homeTeamId}
                        </span>
                      </span>
                      {homeScorers.length > 0 && (
                        <div className="mh-match__scorers">
                          {homeScorers.map((line, idx) => (
                            <span key={idx} className="mh-match__scorer">
                              <IconBall className="mh-match__scorer-ball" /> {line}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <span className="mh-match__score numeric">
                      {ownFixture.result.homeGoals} — {ownFixture.result.awayGoals}
                    </span>

                    <div className="mh-match__side mh-match__side--away">
                      <span className="mh-match__team mh-match__team--away">
                        <span className="mh-match__name" title={away?.name}>
                          {away?.name ?? ownFixture.awayTeamId}
                        </span>
                        {away && CLUB_CRESTS[away.id] && <img className="mh-match__crest" src={CLUB_CRESTS[away.id]} alt="" />}
                      </span>
                      {awayScorers.length > 0 && (
                        <div className="mh-match__scorers mh-match__scorers--away">
                          {awayScorers.map((line, idx) => (
                            <span key={idx} className="mh-match__scorer">
                              <IconBall className="mh-match__scorer-ball" /> {line}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardButton>
            );
          })}
        </div>
      )}

      {filter === 'all' && activeRoundData && (
        <>
          <div className="mh-pager">
            <Button variant="secondary" size="sm" disabled={activeRound === null || activeRound <= minRound} onClick={() => activeRound !== null && goToRound(activeRound - 1)}>
              ← Anterior
            </Button>
            <select
              className="field__input mh-pager__select"
              aria-label="Selecionar rodada"
              value={activeRound ?? ''}
              onChange={(e) => goToRound(Number(e.target.value))}
            >
              {roundNumbers.map((n) => (
                <option key={n} value={n}>
                  Rodada {n}
                </option>
              ))}
            </select>
            <Button variant="secondary" size="sm" disabled={activeRound === null || activeRound >= maxRound} onClick={() => activeRound !== null && goToRound(activeRound + 1)}>
              Próxima →
            </Button>
          </div>

          <div className="mh-rounds">
            <Card className="mh-round" key={activeRoundData.roundNumber}>
              <span className="mh-round__label">Rodada {activeRoundData.roundNumber}</span>
              <div className="mh-round__fixtures">
                {activeRoundData.fixtures.map((fixture) => {
                  if (!fixture.result) return null;
                  const home = findClub(career, fixture.homeTeamId);
                  const away = findClub(career, fixture.awayTeamId);
                  const isOwn = fixture.homeTeamId === career.playerClubId || fixture.awayTeamId === career.playerClubId;
                  const outcome = isOwn ? outcomeFor(fixture, career.playerClubId) : null;
                  const rowStyle = outcome ? ({ '--outcome-color': OUTCOME_VAR[outcome] } as CSSProperties) : undefined;

                  return (
                    <button
                      type="button"
                      className={`mh-fixture${isOwn ? ' mh-fixture--own' : ''}`}
                      style={rowStyle}
                      key={`${fixture.homeTeamId}-${fixture.awayTeamId}`}
                      onClick={() => onSelect(fixture.result!)}
                    >
                      <span className="mh-fixture__team">
                        {home && CLUB_CRESTS[home.id] && <img className="mh-fixture__crest" src={CLUB_CRESTS[home.id]} alt="" />}
                        <span className="mh-fixture__name" title={home?.name}>
                          {home?.name ?? fixture.homeTeamId}
                        </span>
                      </span>
                      <span className="mh-fixture__score numeric">
                        {fixture.result.homeGoals} — {fixture.result.awayGoals}
                      </span>
                      <span className="mh-fixture__team mh-fixture__team--away">
                        <span className="mh-fixture__name" title={away?.name}>
                          {away?.name ?? fixture.awayTeamId}
                        </span>
                        {away && CLUB_CRESTS[away.id] && <img className="mh-fixture__crest" src={CLUB_CRESTS[away.id]} alt="" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>
        </>
      )}
    </main>
  );
}
