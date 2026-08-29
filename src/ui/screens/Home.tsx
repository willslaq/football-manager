import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useCareerStore } from '../../store/careerStore';
import type { CareerState, Club, Lineup, Player, Tactics } from '../../engine/types';
import { TACTIC_STYLE_LABELS } from '../../engine/types';
import { addDays, toEpochDay } from '../../engine/generation/calendar';
import { DEFAULT_AUTO_TACTICS } from '../../engine/simulation/season';
import { buildSeasonSummary } from '../../engine/simulation/seasonLifecycle';
import { findClub, sortStandingsForDisplay, standingPosition } from '../utils';
import { defaultSlotName } from '../../persistence/slotName';
import { CLUB_CRESTS } from '../clubCrests';
import { Badge, Button, Card, RoundResultsList, TextField } from '../components';
import type { Screen } from '../../App';
import './Home.css';

/** Data de um fixture (ISO 'YYYY-MM-DD') em pt-BR curto — ex.: "sáb., 30 de ago." UTC pra não deslocar o dia por fuso. */
function formatFixtureDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** Só o dia do mês, 2 dígitos — o número grande que "rola" na animação de avanço de tempo. */
function formatRollDay(iso: string): string {
  return iso.slice(-2);
}

/** Dia da semana + mês por extenso — contexto abaixo do número grande, atualiza junto, sem animação própria. */
function formatRollContext(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'long', month: 'long', timeZone: 'UTC' });
}

/**
 * O número do dia "rolando": o valor antigo sobe e some, o novo entra por baixo e toma o lugar
 * — mesmo efeito de um relógio de estação/odômetro. Cada mudança de `date` remonta os dois spans
 * (via `key`), o que dispara a transição de entrada (`@starting-style`) e a animação de saída.
 */
function DayRoll({ date }: { date: string }) {
  const [outgoing, setOutgoing] = useState<string | null>(null);
  const prevDateRef = useRef(date);

  useEffect(() => {
    if (prevDateRef.current === date) return;
    setOutgoing(prevDateRef.current);
    prevDateRef.current = date;
    const t = setTimeout(() => setOutgoing(null), 260);
    return () => clearTimeout(t);
  }, [date]);

  return (
    <span className="cal-roll">
      {outgoing && (
        <span key={`out-${outgoing}`} className="cal-roll__digit cal-roll__digit--out numeric">
          {formatRollDay(outgoing)}
        </span>
      )}
      <span key={`in-${date}`} className="cal-roll__digit cal-roll__digit--in numeric">
        {formatRollDay(date)}
      </span>
    </span>
  );
}

/**
 * Tática exibida no card do confronto: o time do jogador mostra a tática atual salva
 * (Escalação), não um "padrão" — o adversário (CPU) mostra a tática real que o motor vai
 * usar contra ele: a pesquisada pro clube (Club.formation/style) ou, na falta dela, o mesmo
 * DEFAULT_AUTO_TACTICS que season.ts realmente aplica (não um valor inventado à parte).
 */
function matchupTactics(club: Club | undefined, isPlayerClub: boolean, playerTactics: Tactics): Tactics {
  if (isPlayerClub) return playerTactics;
  return {
    formation: club?.formation ?? DEFAULT_AUTO_TACTICS.formation,
    style: club?.style ?? DEFAULT_AUTO_TACTICS.style,
  };
}

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function isLineupValid(lineup: Lineup | null, playersById: Map<string, Player>): { valid: boolean; reason?: string } {
  if (!lineup) return { valid: false, reason: 'Nenhuma escalação definida.' };
  if (lineup.starters.length !== 11) {
    return { valid: false, reason: `Escale exatamente 11 jogadores (atualmente ${lineup.starters.length}).` };
  }
  const goalkeepers = lineup.starters.filter((id) => playersById.get(id)?.position === 'GOL');
  if (goalkeepers.length !== 1) {
    return { valid: false, reason: 'A escalação precisa de exatamente 1 goleiro.' };
  }
  const suspended = lineup.starters.map((id) => playersById.get(id)).find((p) => p && p.suspendedMatches > 0);
  if (suspended) {
    return { valid: false, reason: `${suspended.name} está suspenso — ajuste a escalação antes de avançar.` };
  }
  return { valid: true };
}

function SaveExportControls({ defaultSlotName }: { defaultSlotName: string }) {
  const [slotName, setSlotName] = useState(defaultSlotName);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const saveCurrentCareer = useCareerStore((s) => s.saveCurrentCareer);
  const exportCurrentCareer = useCareerStore((s) => s.exportCurrentCareer);

  async function handleSave() {
    await saveCurrentCareer(slotName.trim() || defaultSlotName);
    setSavedMessage('Carreira salva.');
    setTimeout(() => setSavedMessage(null), 2000);
  }

  function handleExport() {
    const json = exportCurrentCareer();
    if (json) downloadTextFile(`${slotName.trim() || defaultSlotName}.json`, json);
  }

  return (
    <Card className="save-controls">
      <div className="save-controls__field">
        <TextField id="save-slot-name" label="Nome do save" value={slotName} onChange={(e) => setSlotName(e.target.value)} />
      </div>
      <Button variant="secondary" onClick={handleSave}>
        Salvar
      </Button>
      <Button variant="ghost" onClick={handleExport}>
        Exportar JSON
      </Button>
      {savedMessage && <span className="save-controls__message">{savedMessage}</span>}
    </Card>
  );
}

/** Lista compacta de clubes (crest/nome/pontos) — Libertadores/rebaixamento no resumo de fim de temporada. */
function ClubStandingList({ career, clubIds, accent }: { career: CareerState; clubIds: string[]; accent: string }) {
  const table = sortStandingsForDisplay(career.season.competitions[0].standings);
  const entries = table.filter((e) => clubIds.includes(e.clubId));
  return (
    <ul className="season-end__club-list">
      {entries.map((entry) => {
        const club = findClub(career, entry.clubId);
        return (
          <li key={entry.clubId} className="season-end__club-row" style={{ '--accent': accent } as CSSProperties}>
            {club && CLUB_CRESTS[club.id] && <img className="season-end__club-crest" src={CLUB_CRESTS[club.id]} alt="" />}
            <span className="season-end__club-name">{club?.name ?? entry.clubId}</span>
            <span className="season-end__club-points numeric">{entry.points} pts</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Artilheiro/Luva de Ouro — jogador + clube + número. */
function PlayerHighlightCard({
  career,
  label,
  playerId,
  value,
  unit,
}: {
  career: CareerState;
  label: string;
  playerId: string | undefined;
  value: number | undefined;
  unit: string;
}) {
  if (!playerId || value === undefined) return null;
  const player = career.world.players.find((p) => p.id === playerId);
  const club = career.world.clubs.find((c) => c.squad.includes(playerId));
  return (
    <Card accentColor={club?.colors.primary} className="season-end__highlight">
      {club && CLUB_CRESTS[club.id] && <img className="season-end__highlight-crest" src={CLUB_CRESTS[club.id]} alt="" />}
      <div>
        <p className="season-end__highlight-label">{label}</p>
        <p className="season-end__highlight-name">{player?.name ?? playerId}</p>
        <p className="season-end__highlight-club">{club?.name}</p>
      </div>
      <p className="season-end__highlight-value numeric">
        {value}
        <span className="season-end__highlight-unit">{unit}</span>
      </p>
    </Card>
  );
}

export function Home({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  const career = useCareerStore((s) => s.career);
  const lineup = useCareerStore((s) => s.lineup);
  const tactics = useCareerStore((s) => s.tactics);
  const loading = useCareerStore((s) => s.loading);
  const error = useCareerStore((s) => s.error);
  const advanceTime = useCareerStore((s) => s.advanceTime);
  const startMatch = useCareerStore((s) => s.startMatch);
  const passedResults = useCareerStore((s) => s.passedResults);
  const startNewSeason = useCareerStore((s) => s.startNewSeason);

  // Animação de "avançar o tempo": enquanto o calendário caminha dia a dia (de verdade, no motor,
  // numa só chamada síncrona — ver advanceCalendar), mostra os dias passando um a um na tela, com
  // a UI de fundo borrada, até estacionar no dia de verdade que o motor devolveu. `pendingAdvance`
  // marca que estamos esperando a resposta de um clique em "Avançar o tempo" (não de "Iniciar
  // Partida", que não mexe no calendário) pra saber quando montar a sequência de dias a animar.
  const currentDate = career?.season.currentDate ?? null;
  const pendingAdvanceRef = useRef(false);
  const prevDateRef = useRef<string | null>(currentDate);
  const [rollSequence, setRollSequence] = useState<string[] | null>(null);
  const [rollIndex, setRollIndex] = useState(0);

  useEffect(() => {
    if (pendingAdvanceRef.current && currentDate && prevDateRef.current && currentDate !== prevDateRef.current) {
      const from = prevDateRef.current;
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const totalDays = toEpochDay(currentDate) - toEpochDay(from);
      const days = reducedMotion ? 1 : Math.max(1, totalDays);
      setRollSequence(
        Array.from({ length: days }, (_, i) => (i === days - 1 ? currentDate : addDays(from, i + 1))),
      );
      setRollIndex(0);
      pendingAdvanceRef.current = false;
    }
    prevDateRef.current = currentDate;
  }, [currentDate]);

  useEffect(() => {
    if (!rollSequence) return undefined;
    if (rollIndex >= rollSequence.length - 1) {
      const t = setTimeout(() => setRollSequence(null), 450);
      return () => clearTimeout(t);
    }
    const stepDelay = Math.min(200, Math.max(50, 1800 / rollSequence.length));
    const t = setTimeout(() => setRollIndex((i) => i + 1), stepDelay);
    return () => clearTimeout(t);
  }, [rollSequence, rollIndex]);

  function handleAdvanceTime(): void {
    pendingAdvanceRef.current = true;
    advanceTime();
  }

  if (!career) return null;

  // Renderizado nos dois retornos abaixo (temporada encerrada ou não) — "avançar o tempo" pode
  // ser exatamente o que encerra a temporada, e a animação já em andamento não deve sumir de repente.
  const rollOverlay = rollSequence && (
    <div className="calendar-roll-overlay" role="status" aria-live="polite" aria-label="Avançando o calendário">
      <div className="calendar-roll">
        <DayRoll date={rollSequence[rollIndex]} />
        <span className="calendar-roll__context">{formatRollContext(rollSequence[rollIndex])}</span>
      </div>
    </div>
  );

  const playerClub = findClub(career, career.playerClubId);
  const competition = career.season.competitions[0];
  const playersById = new Map(career.world.players.map((p) => [p.id, p]));
  const lineupCheck = isLineupValid(lineup, playersById);
  const slotName = defaultSlotName(career);

  if (career.season.state === 'finished') {
    const table = sortStandingsForDisplay(competition.standings);
    const championEntry = table[0];
    const champion = findClub(career, championEntry.clubId);
    const summary = buildSeasonSummary(career);

    return (
      <div className="home">
        <Card accentColor={champion?.colors.primary} className="champion-card">
          <span className="eyebrow">Temporada encerrada</span>
          {champion && CLUB_CRESTS[champion.id] && (
            <img className="champion-card__crest" src={CLUB_CRESTS[champion.id]} alt="" width={80} height={80} />
          )}
          <div>
            <p className="champion-card__label">Campeão</p>
            <h2 className="champion-card__name">{champion?.name ?? championEntry.clubId}</h2>
            <p className="champion-card__points numeric">{championEntry.points} pontos</p>
          </div>
          <Button variant="primary" onClick={() => onNavigate('table')}>
            Ver tabela final
          </Button>
        </Card>

        <div className="season-end__highlights">
          <PlayerHighlightCard
            career={career}
            label="Artilheiro"
            playerId={summary.topScorer?.playerId}
            value={summary.topScorer?.goals}
            unit="gols"
          />
          <PlayerHighlightCard
            career={career}
            label="Luva de Ouro"
            playerId={summary.goldenGlove?.playerId}
            value={summary.goldenGlove?.saves}
            unit="defesas"
          />
        </div>

        <div className="season-end__zones">
          <Card className="season-end__zone">
            <span className="eyebrow">Classificados para a Libertadores</span>
            <ClubStandingList career={career} clubIds={summary.libertadores} accent="var(--pitch)" />
          </Card>
          <Card className="season-end__zone">
            <span className="eyebrow">Rebaixados</span>
            <ClubStandingList career={career} clubIds={summary.relegated} accent="var(--danger)" />
          </Card>
        </div>

        <Button variant="primary" block disabled={loading} onClick={() => startNewSeason()}>
          {loading ? 'Preparando nova temporada…' : 'Iniciar nova temporada'}
        </Button>

        <SaveExportControls defaultSlotName={slotName} />

        {rollOverlay}
      </div>
    );
  }

  // Próximo jogo do time do jogador ainda sem resultado, em qualquer rodada — não necessariamente
  // "hoje": com o calendário real, a maior parte dos dias não tem jogo do jogador (ver
  // `advanceTime`), então o card/botão não pode mais depender de um fixture "da rodada atual".
  // `date >= currentDate` é essencial: rodadas anteriores à rodada real do snapshot inicial não
  // têm `.result` por design (só entram como saldo agregado nas standings — ver
  // `deriveCurrentRound` em season.ts), e sem esse filtro o primeiro fixture "sem resultado"
  // encontrado seria um desses, lá no passado, não o próximo jogo de verdade.
  const fixture = competition.fixtures
    .flat()
    .find(
      (f) =>
        !f.result &&
        f.date >= career.season.currentDate &&
        (f.homeTeamId === career.playerClubId || f.awayTeamId === career.playerClubId),
    );
  // Botão de duas caras: se o calendário já está no dia desse jogo, "Iniciar Partida" (simula e
  // transmite ao vivo); senão, "Avançar o tempo" (só caminha o calendário até esse dia).
  const isMatchDay = !!fixture && fixture.date === career.season.currentDate;
  const isHome = fixture?.homeTeamId === career.playerClubId;
  const opponentId = fixture ? (isHome ? fixture.awayTeamId : fixture.homeTeamId) : undefined;
  const opponent = opponentId ? findClub(career, opponentId) : undefined;

  const homeTeam = isHome ? playerClub : opponent;
  const awayTeam = isHome ? opponent : playerClub;
  const homePosition = homeTeam ? standingPosition(competition.standings, homeTeam.id) : null;
  const awayPosition = awayTeam ? standingPosition(competition.standings, awayTeam.id) : null;
  const homeTactics = matchupTactics(homeTeam, isHome, tactics);
  const awayTactics = matchupTactics(awayTeam, !isHome, tactics);

  return (
    <div className="home">
      {passedResults.length > 0 && (
        <Card className="matchup-passed">
          <span className="eyebrow">Enquanto isso…</span>
          <RoundResultsList
            entries={passedResults.map((f) => ({
              homeTeamId: f.homeTeamId,
              awayTeamId: f.awayTeamId,
              homeGoals: f.result?.homeGoals ?? 0,
              awayGoals: f.result?.awayGoals ?? 0,
              finished: true,
            }))}
            clubName={(id) => findClub(career, id)?.name ?? id}
          />
        </Card>
      )}

      {fixture && homeTeam && awayTeam && (
        <Card accentColor={playerClub?.colors.primary} className="matchup">
          <span className="eyebrow">
            Rodada {fixture.round}/{competition.fixtures.length} · {formatFixtureDate(fixture.date)} ·{' '}
            {competition.name}
          </span>

          <div className="matchup__teams">
            <div className="matchup__team">
              {CLUB_CRESTS[homeTeam.id] && (
                <img className="matchup__crest" src={CLUB_CRESTS[homeTeam.id]} alt="" width={96} height={96} />
              )}
              <p className="matchup__name" title={homeTeam.name}>
                {homeTeam.name}
                {homePosition && <span className="matchup__name-position numeric">{homePosition}º</span>}
              </p>
              <p className="matchup__tactics">
                {homeTactics.formation} · {TACTIC_STYLE_LABELS[homeTactics.style]}
              </p>
              <p className="matchup__morale" title="Moral do clube — não influencia a simulação, só reflete a campanha">
                Moral <span className="numeric">{homeTeam.morale}</span>
              </p>
              <Badge tone={isHome ? 'pitch' : 'neutral'}>Mandante</Badge>
            </div>

            <span className="matchup__vs">×</span>

            <div className="matchup__team">
              {CLUB_CRESTS[awayTeam.id] && (
                <img className="matchup__crest" src={CLUB_CRESTS[awayTeam.id]} alt="" width={96} height={96} />
              )}
              <p className="matchup__name" title={awayTeam.name}>
                {awayTeam.name}
                {awayPosition && <span className="matchup__name-position numeric">{awayPosition}º</span>}
              </p>
              <p className="matchup__tactics">
                {awayTactics.formation} · {TACTIC_STYLE_LABELS[awayTactics.style]}
              </p>
              <p className="matchup__morale" title="Moral do clube — não influencia a simulação, só reflete a campanha">
                Moral <span className="numeric">{awayTeam.morale}</span>
              </p>
              <Badge tone={!isHome ? 'pitch' : 'neutral'}>Visitante</Badge>
            </div>
          </div>

          {!lineupCheck.valid && <p className="matchup__warning">{lineupCheck.reason}</p>}
          {error && <p className="error-banner">{error}</p>}

          <div className="matchup__action">
            {isMatchDay ? (
              <Button variant="primary" block disabled={!lineupCheck.valid || loading} onClick={() => startMatch()}>
                {loading ? 'Simulando…' : 'Iniciar Partida'}
              </Button>
            ) : (
              <Button variant="primary" block disabled={!lineupCheck.valid || loading} onClick={handleAdvanceTime}>
                {loading ? 'Avançando…' : 'Avançar o tempo'}
              </Button>
            )}
          </div>
        </Card>
      )}

      <SaveExportControls defaultSlotName={slotName} />

      {rollOverlay}
    </div>
  );
}
