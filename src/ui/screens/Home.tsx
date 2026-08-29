import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useCareerStore } from '../../store/careerStore';
import type { CareerState, Club, Lineup, Player, Tactics } from '../../engine/types';
import { TACTIC_STYLE_LABELS } from '../../engine/types';
import { DEFAULT_AUTO_TACTICS } from '../../engine/simulation/season';
import { buildSeasonSummary } from '../../engine/simulation/seasonLifecycle';
import { findClub, sortStandingsForDisplay, standingPosition } from '../utils';
import { defaultSlotName } from '../../persistence/slotName';
import { CLUB_CRESTS } from '../clubCrests';
import { Badge, Button, Card, TextField } from '../components';
import type { Screen } from '../../App';
import './Home.css';

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
  const advanceRound = useCareerStore((s) => s.advanceRound);
  const startNewSeason = useCareerStore((s) => s.startNewSeason);

  if (!career) return null;

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
      </div>
    );
  }

  const round = competition.fixtures[career.season.currentRound - 1];
  const fixture = round?.find((f) => f.homeTeamId === career.playerClubId || f.awayTeamId === career.playerClubId);
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
      {fixture && homeTeam && awayTeam && (
        <Card accentColor={playerClub?.colors.primary} className="matchup">
          <span className="eyebrow">
            Rodada {career.season.currentRound}/{competition.fixtures.length} · {competition.name}
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
            <Button variant="primary" block disabled={!lineupCheck.valid || loading} onClick={() => advanceRound()}>
              {loading ? 'Simulando…' : 'Avançar rodada'}
            </Button>
          </div>
        </Card>
      )}

      <SaveExportControls defaultSlotName={slotName} />
    </div>
  );
}
