import { describe, expect, it } from 'vitest';
import { validateCareerState } from './validateCareerState';
import type { CareerState } from './types/career';
import type { Player } from './types/player';
import type { Club } from './types/club';

function makePlayer(id: string, name: string, position: Player['position']): Player {
  return {
    id,
    name,
    age: 24,
    birthYear: 2001,
    nationality: 'BRA',
    position,
    secondaryPositions: [],
    strength: 65,
    attributes: {
      finishing: 60,
      speed: 65,
      dribbling: 60,
      passing: 62,
      heading: 55,
      marking: 58,
      tackling: 57,
      positioning: 60,
      reflexes: 50,
      aggression: 55,
    },
    condition: 100,
    morale: 70,
    potential: 75,
    seasonStats: { appearances: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0, saves: 0 },
    pendingYellowCards: 0,
    suspendedMatches: 0,
  };
}

function makeClub(id: string, name: string, squad: string[]): Club {
  return {
    id,
    name,
    shortName: name.slice(0, 3).toUpperCase(),
    reputation: 50,
    morale: 70,
    colors: { primary: '#ff0000', secondary: '#ffffff' },
    stadiumCapacity: 20000,
    squad,
  };
}

function buildExampleCareerState(): CareerState {
  const homePlayers = [
    makePlayer('p1', 'Goleiro A', 'GOL'),
    makePlayer('p2', 'Zagueiro A', 'ZAG'),
    makePlayer('p3', 'Atacante A', 'CA'),
  ];
  const awayPlayers = [
    makePlayer('p4', 'Goleiro B', 'GOL'),
    makePlayer('p5', 'Zagueiro B', 'ZAG'),
    makePlayer('p6', 'Atacante B', 'CA'),
  ];

  const home = makeClub('clubA', 'Clube A', homePlayers.map((p) => p.id));
  const away = makeClub('clubB', 'Clube B', awayPlayers.map((p) => p.id));

  return {
    seed: 42,
    trainer: { id: 't1', name: 'Treinador Exemplo' },
    playerClubId: home.id,
    world: {
      clubs: [home, away],
      players: [...homePlayers, ...awayPlayers],
    },
    season: {
      year: 2026,
      calendar: [
        { round: 0, competitionId: 'liga' },
        { round: 1, competitionId: 'liga' },
      ],
      competitions: [
        {
          id: 'liga',
          name: 'Liga Exemplo',
          teams: [home.id, away.id],
          fixtures: [
            [{ round: 0, date: '2026-01-31', homeTeamId: home.id, awayTeamId: away.id }],
            [{ round: 1, date: '2026-02-07', homeTeamId: away.id, awayTeamId: home.id }],
          ],
          standings: [
            { clubId: home.id, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 },
            { clubId: away.id, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 },
          ],
        },
      ],
      state: 'not_started',
      currentDate: '2026-01-30',
      currentRound: 1,
    },
    history: [],
    settings: { tacticalIntensity: 'subtle' },
  };
}

describe('validateCareerState', () => {
  it('aceita um CareerState montado à mão', () => {
    const result = validateCareerState(buildExampleCareerState());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejeita playerClubId que não existe no mundo', () => {
    const state = buildExampleCareerState();
    state.playerClubId = 'clube-fantasma';

    const result = validateCareerState(state);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('playerClubId'))).toBe(true);
  });

  it('rejeita atributo de jogador fora do intervalo [0, 100]', () => {
    const state = buildExampleCareerState();
    state.world.players[0].attributes.finishing = 150;

    const result = validateCareerState(state);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('finishing'))).toBe(true);
  });

  it('rejeita squad que referencia jogador inexistente', () => {
    const state = buildExampleCareerState();
    state.world.clubs[0].squad.push('jogador-fantasma');

    const result = validateCareerState(state);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('jogador-fantasma'))).toBe(true);
  });
});
