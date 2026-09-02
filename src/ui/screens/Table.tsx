import type { CSSProperties } from 'react';
import { useState } from 'react';
import { useCareerStore } from '../../store/careerStore';
import { findClub, findPlayerCompetition, isSeriesB, sortStandingsForDisplay, standingsZone, standingsZoneSeriesB, type StandingsZone } from '../utils';
import { CLUB_CRESTS } from '../clubCrests';
import { Button, Card } from '../components';
import type { Screen } from '../../App';
import './Table.css';

const ZONE_COLOR: Record<Exclude<StandingsZone, null>, string> = {
  libertadores: 'var(--fm-accent)',
  'libertadores-pre': 'color-mix(in srgb, var(--fm-accent) 50%, transparent)',
  sula: 'var(--fm-warn)',
  relegation: 'var(--fm-danger)',
  promotion: 'var(--fm-accent)',
};

const LEGEND_A: { zone: Exclude<StandingsZone, null>; label: string }[] = [
  { zone: 'libertadores', label: 'Libertadores' },
  { zone: 'libertadores-pre', label: 'Pré-Libertadores' },
  { zone: 'sula', label: 'Sul-Americana' },
  { zone: 'relegation', label: 'Rebaixamento' },
];

const LEGEND_B: { zone: Exclude<StandingsZone, null>; label: string }[] = [
  { zone: 'promotion', label: 'Acesso à Série A' },
  { zone: 'relegation', label: 'Rebaixamento' },
];

export function Table({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  const career = useCareerStore((s) => s.career);
  const playerCompetition = career ? findPlayerCompetition(career) : null;
  const [selectedCompetitionId, setSelectedCompetitionId] = useState<string | null>(null);
  if (!career || !playerCompetition) return null;

  const competition =
    career.season.competitions.find((c) => c.id === selectedCompetitionId) ?? playerCompetition;
  const table = sortStandingsForDisplay(competition.standings);
  const seriesB = isSeriesB(competition);
  const zoneOf = seriesB ? standingsZoneSeriesB : standingsZone;
  const legend = seriesB ? LEGEND_B : LEGEND_A;

  return (
    <div className="standings">
      <div className="standings__header">
        <div className="standings__tabs">
          {career.season.competitions.map((c) => (
            <Button
              key={c.id}
              type="button"
              size="sm"
              variant={c.id === competition.id ? 'primary' : 'secondary'}
              aria-pressed={c.id === competition.id}
              onClick={() => setSelectedCompetitionId(c.id)}
            >
              {isSeriesB(c) ? 'Série B' : 'Série A'}
              {c.id === playerCompetition.id && ' · seu clube'}
            </Button>
          ))}
        </div>
        <div className="standings__heading">
          <span className="eyebrow">Classificação · rodada {career.season.currentRound}</span>
          <h1 className="standings__title">{competition.name}</h1>
        </div>
        <div className="standings__legend">
          {legend.map((item) => (
            <span className="standings__legend-item" key={item.zone}>
              <span className="standings__legend-dot" style={{ background: ZONE_COLOR[item.zone] }} />
              {item.label}
            </span>
          ))}
        </div>
        <Button variant="secondary" size="sm" onClick={() => onNavigate('matchHistory')}>
          Histórico de partidas
        </Button>
      </div>

      <Card className="standings__card">
        <div className="standings__scroll">
          <table className="standings__table">
            <thead>
              <tr>
                <th>#</th>
                <th>Clube</th>
                <th>P</th>
                <th>J</th>
                <th>V</th>
                <th>E</th>
                <th>D</th>
                <th>GP</th>
                <th>GC</th>
                <th>SG</th>
              </tr>
            </thead>
            <tbody>
              {table.map((entry, index) => {
                const position = index + 1;
                const club = findClub(career, entry.clubId);
                const isOwn = entry.clubId === career.playerClubId;
                const zone = zoneOf(position);
                const crest = club ? CLUB_CRESTS[club.id] : undefined;

                return (
                  <tr key={entry.clubId} className={isOwn ? 'standings__row--own' : undefined}>
                    <td
                      className="standings__pos numeric"
                      style={zone ? ({ '--zone-color': ZONE_COLOR[zone] } as CSSProperties) : undefined}
                    >
                      {position}
                    </td>
                    <td>
                      <div className="standings__club">
                        {crest ? (
                          <img className="standings__crest" src={crest} alt="" width={24} height={24} />
                        ) : (
                          <span className="standings__crest standings__crest--placeholder" aria-hidden="true" />
                        )}
                        <span className="standings__name" title={club?.name ?? entry.clubId}>
                          {club?.name ?? entry.clubId}
                        </span>
                      </div>
                    </td>
                    <td className="standings__points numeric">{entry.points}</td>
                    <td className="numeric">{entry.played}</td>
                    <td className="numeric">{entry.won}</td>
                    <td className="numeric">{entry.drawn}</td>
                    <td className="numeric">{entry.lost}</td>
                    <td className="numeric">{entry.goalsFor}</td>
                    <td className="numeric">{entry.goalsAgainst}</td>
                    <td className="numeric">{entry.goalsFor - entry.goalsAgainst}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
