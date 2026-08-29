import { useState } from 'react';
import { useCareerStore } from '../../store/careerStore';
import type { Club, Lineup, Tactics } from '../../engine/types';
import { TACTIC_STYLE_LABELS } from '../../engine/types';
import { DEFAULT_AUTO_TACTICS } from '../../engine/simulation/season';
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

function isLineupValid(
  lineup: Lineup | null,
  squadPositionById: Map<string, string>,
): { valid: boolean; reason?: string } {
  if (!lineup) return { valid: false, reason: 'Nenhuma escalação definida.' };
  if (lineup.starters.length !== 11) {
    return { valid: false, reason: `Escale exatamente 11 jogadores (atualmente ${lineup.starters.length}).` };
  }
  const goalkeepers = lineup.starters.filter((id) => squadPositionById.get(id) === 'GOL');
  if (goalkeepers.length !== 1) {
    return { valid: false, reason: 'A escalação precisa de exatamente 1 goleiro.' };
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
        <TextField
          id="save-slot-name"
          label="Nome do save"
          value={slotName}
          onChange={(e) => setSlotName(e.target.value)}
        />
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

export function Home({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  const career = useCareerStore((s) => s.career);
  const lineup = useCareerStore((s) => s.lineup);
  const tactics = useCareerStore((s) => s.tactics);
  const loading = useCareerStore((s) => s.loading);
  const error = useCareerStore((s) => s.error);
  const advanceRound = useCareerStore((s) => s.advanceRound);

  if (!career) return null;

  const playerClub = findClub(career, career.playerClubId);
  const competition = career.season.competitions[0];
  const squadPositionById = new Map(career.world.players.map((p) => [p.id, p.position]));
  const lineupCheck = isLineupValid(lineup, squadPositionById);
  const slotName = defaultSlotName(career);

  if (career.season.state === 'finished') {
    const table = sortStandingsForDisplay(competition.standings);
    const championEntry = table[0];
    const champion = findClub(career, championEntry.clubId);
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
              <Badge tone={!isHome ? 'pitch' : 'neutral'}>Visitante</Badge>
            </div>
          </div>

          {!lineupCheck.valid && <p className="matchup__warning">{lineupCheck.reason}</p>}
          {error && <p className="error-banner">{error}</p>}

          <div className="matchup__action">
            <Button
              variant="primary"
              block
              disabled={!lineupCheck.valid || loading}
              onClick={() => advanceRound()}
            >
              {loading ? 'Simulando…' : 'Avançar rodada'}
            </Button>
          </div>
        </Card>
      )}

      <SaveExportControls defaultSlotName={slotName} />
    </div>
  );
}
