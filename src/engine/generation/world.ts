import { mulberry32 } from '../rng';
import type { Club } from '../types/club';
import type { Player } from '../types/player';
import type { World } from '../types/career';
import { clubReputationFromStanding, generatePlayerDerived, playerSeed } from './attributes';
import type { RawClubFile, RawStandingsFile } from './rawData';
import standingsFile from '../../data/brasileirao-2026/standings-current.json';

const EXCLUDED_FILES = ['competition.json', 'fixtures.json', 'standings-current.json'];

const clubModules = import.meta.glob<{ default: RawClubFile }>(
  '../../data/brasileirao-2026/*.json',
  { eager: true },
);

function loadRawClubs(): RawClubFile[] {
  return Object.entries(clubModules)
    .filter(([path]) => !EXCLUDED_FILES.some((excluded) => path.endsWith(excluded)))
    .map(([, mod]) => mod.default);
}

/**
 * Monta o mundo (clubes + jogadores) a partir dos dados reais do Brasileirão
 * Série A 2026 (src/data/brasileirao-2026). Identidade dos jogadores (nome,
 * posição, idade, nacionalidade) é fixa. Para jogadores casados com o mod do
 * EA FC 26 (campo `overall` presente), strength/potential/attributes vêm dos
 * dados reais (ver `generatePlayerDerived`); para os demais, continuam
 * derivados deterministicamente a partir da seed, como antes.
 */
export function generateWorld(seed: number): World {
  const rawClubs = loadRawClubs();
  const standings = (standingsFile as RawStandingsFile).standings;
  const totalTeams = standings.length;
  const positionByClub = new Map(standings.map((entry, index) => [entry.clubId, index + 1]));

  const clubs: Club[] = [];
  const players: Player[] = [];

  for (const raw of rawClubs) {
    const tablePosition = positionByClub.get(raw.club.id) ?? Math.ceil(totalTeams / 2);
    const reputation = clubReputationFromStanding(tablePosition, totalTeams);
    const squad: string[] = [];

    raw.squad.forEach((rawPlayer, index) => {
      const id = `${raw.club.id}-${index + 1}`;
      const rng = mulberry32(playerSeed(seed, id));
      const real =
        rawPlayer.overall != null && rawPlayer.attributes
          ? {
              overall: rawPlayer.overall,
              potential: rawPlayer.potential ?? rawPlayer.overall,
              attributes: rawPlayer.attributes,
            }
          : undefined;
      const derived = generatePlayerDerived(rng, rawPlayer.position, rawPlayer.age, reputation, real);

      players.push({
        id,
        name: rawPlayer.name,
        age: rawPlayer.age,
        nationality: rawPlayer.nationality,
        position: rawPlayer.position,
        secondaryPositions: rawPlayer.secondaryPositions,
        strength: derived.strength,
        attributes: derived.attributes,
        condition: derived.condition,
        morale: derived.morale,
        potential: derived.potential,
        seasonStats: { appearances: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0, saves: 0 },
        pendingYellowCards: 0,
        suspendedMatches: 0,
        height: rawPlayer.height,
        weight: rawPlayer.weight,
        preferredFoot: rawPlayer.preferredFoot,
        weakFoot: rawPlayer.weakFoot,
      });
      squad.push(id);
    });

    clubs.push({
      id: raw.club.id,
      name: raw.club.name,
      shortName: raw.club.shortName,
      reputation,
      colors: raw.club.colors,
      stadiumCapacity: raw.club.stadiumCapacity,
      squad,
      formation: raw.club.formation,
      style: raw.club.style,
    });
  }

  return { clubs, players };
}
