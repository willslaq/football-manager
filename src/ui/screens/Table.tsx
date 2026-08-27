import type { CSSProperties } from 'react';
import { useCareerStore } from '../../store/careerStore';
import { findClub, sortStandingsForDisplay } from '../utils';
import { CLUB_CRESTS } from '../clubCrests';
import { Card } from '../components';
import './Table.css';

type Zone = 'libertadores' | 'libertadores-pre' | 'sula' | 'relegation' | null;

function zoneFor(position: number): Zone {
  if (position <= 4) return 'libertadores';
  if (position === 5) return 'libertadores-pre';
  if (position <= 11) return 'sula';
  if (position >= 17) return 'relegation';
  return null;
}

const ZONE_COLOR: Record<Exclude<Zone, null>, string> = {
  libertadores: 'var(--pitch)',
  'libertadores-pre': 'color-mix(in srgb, var(--pitch) 50%, transparent)',
  sula: 'var(--floodlight)',
  relegation: 'var(--danger)',
};

const LEGEND: { zone: Exclude<Zone, null>; label: string }[] = [
  { zone: 'libertadores', label: 'Libertadores' },
  { zone: 'libertadores-pre', label: 'Pré-Libertadores' },
  { zone: 'sula', label: 'Sul-Americana' },
  { zone: 'relegation', label: 'Rebaixamento' },
];

export function Table() {
  const career = useCareerStore((s) => s.career);
  if (!career) return null;

  const competition = career.season.competitions[0];
  const table = sortStandingsForDisplay(competition.standings);

  return (
    <div className="standings">
      <div className="standings__header">
        <h1 className="standings__title">{competition.name}</h1>
        <div className="standings__legend">
          {LEGEND.map((item) => (
            <span className="standings__legend-item" key={item.zone}>
              <span className="standings__legend-dot" style={{ background: ZONE_COLOR[item.zone] }} />
              {item.label}
            </span>
          ))}
        </div>
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
                const zone = zoneFor(position);
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
                        {crest && <img className="standings__crest" src={crest} alt="" width={24} height={24} />}
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
