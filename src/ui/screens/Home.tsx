import { useState } from 'react';
import { useCareerStore } from '../../store/careerStore';
import type { Lineup } from '../../engine/types';
import { findClub, sortStandingsForDisplay } from '../utils';
import { CLUB_CRESTS } from '../clubCrests';
import { Badge, Button, Card, TextField } from '../components';
import type { Screen } from '../../App';
import './Home.css';

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
  const loading = useCareerStore((s) => s.loading);
  const error = useCareerStore((s) => s.error);
  const advanceRound = useCareerStore((s) => s.advanceRound);

  if (!career) return null;

  const playerClub = findClub(career, career.playerClubId);
  const competition = career.season.competitions[0];
  const squadPositionById = new Map(career.world.players.map((p) => [p.id, p.position]));
  const lineupCheck = isLineupValid(lineup, squadPositionById);
  const slotName = `${playerClub?.name ?? career.playerClubId} - ${career.trainer.name}`;

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
