import { mulberry32 } from '../rng';
import type { Club } from '../types/club';
import type { Player } from '../types/player';
import type { World } from '../types/career';
import { clubReputationFromStanding, generatePlayerDerived, moraleFromFinalStanding, playerSeed } from './attributes';
import { generateAcademyIntake } from './academy';
import { computeStartingBudget, defaultTicketPrice } from '../simulation/finance';
import { INITIAL_SEASON_YEAR } from './season';
import type { RawClubFile, RawStandingsFile } from './rawData';
import standingsFileA from '../../data/brasileirao-2026/standings-current.json';
import standingsFileB from '../../data/brasileirao-serie-b-2026/standings-current.json';

const EXCLUDED_FILES = ['competition.json', 'fixtures.json', 'standings-current.json'];

const clubModulesA = import.meta.glob<{ default: RawClubFile }>('../../data/brasileirao-2026/*.json', { eager: true });
const clubModulesB = import.meta.glob<{ default: RawClubFile }>('../../data/brasileirao-serie-b-2026/*.json', {
  eager: true,
});

function loadRawClubs(modules: Record<string, { default: RawClubFile }>): RawClubFile[] {
  return Object.entries(modules)
    .filter(([path]) => !EXCLUDED_FILES.some((excluded) => path.endsWith(excluded)))
    .map(([, mod]) => mod.default);
}

/**
 * Monta clubes+jogadores de UMA divisão a partir dos dados reais brutos e do snapshot de tabela
 * daquela divisão — reputação/moral inicial vêm da posição do clube NA PRÓPRIA competição (uma
 * tabela de 20 times cada, Série A e Série B não se misturam pra esse cálculo). Também semeia a
 * categoria de base de cada clube (`academySquad`) com o intake do ano inicial (ver `academy.ts`),
 * pra não começar vazia — as próximas gerações vêm de `startNewSeason` a cada temporada.
 */
function buildDivision(
  seed: number,
  rawClubs: RawClubFile[],
  standings: RawStandingsFile['standings'],
  isSeriesA: boolean,
): World {
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
        birthYear: rawPlayer.birthYear ?? new Date().getFullYear() - rawPlayer.age,
        marketValue: rawPlayer.marketValue ?? 0,
        nationality: rawPlayer.nationality,
        position: rawPlayer.position,
        secondaryPositions: rawPlayer.secondaryPositions,
        strength: derived.strength,
        attributes: derived.attributes,
        condition: derived.condition,
        morale: derived.morale,
        potential: derived.potential,
        seasonStats: { appearances: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0, saves: 0, minutesPlayed: 0 },
        pendingYellowCards: 0,
        suspendedMatches: 0,
        height: rawPlayer.height,
        weight: rawPlayer.weight,
        preferredFoot: rawPlayer.preferredFoot,
        weakFoot: rawPlayer.weakFoot,
      });
      squad.push(id);
    });

    const academy = generateAcademyIntake(seed, { id: raw.club.id, reputation }, INITIAL_SEASON_YEAR);
    players.push(...academy);

    clubs.push({
      id: raw.club.id,
      name: raw.club.name,
      shortName: raw.club.shortName,
      reputation,
      morale: moraleFromFinalStanding(tablePosition, totalTeams),
      colors: raw.club.colors,
      stadiumCapacity: raw.club.stadiumCapacity,
      squad,
      academySquad: academy.map((p) => p.id),
      formation: raw.club.formation,
      style: raw.club.style,
      budget: computeStartingBudget(reputation, raw.club.stadiumCapacity),
      ticketPrice: defaultTicketPrice(isSeriesA),
    });
  }

  return { clubs, players };
}

/**
 * Monta o mundo (clubes + jogadores) a partir dos dados reais do Brasileirão Série A E Série B
 * 2026 (src/data/brasileirao-2026 e src/data/brasileirao-serie-b-2026) — as duas divisões
 * inteiras, sempre, já que o jogador pode escolher um clube de qualquer uma das duas ao começar
 * uma carreira, e um clube pode migrar de divisão entre temporadas (ver `startNewSeason`).
 * Identidade dos jogadores (nome, posição, idade, nacionalidade) é fixa. Para jogadores casados
 * com o mod do EA FC 26 (campo `overall` presente), strength/potential/attributes vêm dos dados
 * reais (ver `generatePlayerDerived`); para os demais, continuam derivados deterministicamente a
 * partir da seed, como antes.
 */
export function generateWorld(seed: number): World {
  const seriesA = buildDivision(seed, loadRawClubs(clubModulesA), (standingsFileA as RawStandingsFile).standings, true);
  const seriesB = buildDivision(seed, loadRawClubs(clubModulesB), (standingsFileB as RawStandingsFile).standings, false);
  return { clubs: [...seriesA.clubs, ...seriesB.clubs], players: [...seriesA.players, ...seriesB.players] };
}
