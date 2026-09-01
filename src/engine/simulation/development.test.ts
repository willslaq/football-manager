import { describe, expect, it } from 'vitest';
import type { Player } from '../types/player';
import { CONDITION_AGE_PEAK_MAX, CONDITION_AGE_PEAK_MIN } from './config';
import { developPlayer } from './development';

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    name: 'Test Player',
    age: 20,
    birthYear: 2006,
    marketValue: 1000000,
    nationality: 'BRA',
    position: 'MC',
    secondaryPositions: [],
    strength: 60,
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
    potential: 80,
    seasonStats: { appearances: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0, saves: 0, minutesPlayed: 0 },
    pendingYellowCards: 0,
    suspendedMatches: 0,
    ...overrides,
  };
}

describe('developPlayer', () => {
  it('não muda a força de quem não jogou nada, mesmo abaixo do prime com gap pro potencial', () => {
    const player = makePlayer({ age: 18, strength: 55, potential: 90, seasonStats: { ...makePlayer().seasonStats, minutesPlayed: 0 } });
    const next = developPlayer(player, 38);
    expect(next.strength).toBe(55);
  });

  it('cresce rumo ao potencial pra jovem titular absoluto, sem passar do potencial', () => {
    const player = makePlayer({
      age: 18,
      strength: 55,
      potential: 90,
      seasonStats: { ...makePlayer().seasonStats, minutesPlayed: 38 * 90 },
    });
    const next = developPlayer(player, 38);
    expect(next.strength).toBeGreaterThan(55);
    expect(next.strength).toBeLessThanOrEqual(90);
  });

  it('jovem mais novo cresce mais rápido que um mais velho com o mesmo gap e minutagem', () => {
    const baseSeasonStats = { appearances: 38, goals: 0, assists: 0, yellowCards: 0, redCards: 0, saves: 0, minutesPlayed: 38 * 90 };
    const young = developPlayer(makePlayer({ age: 17, strength: 50, potential: 90, seasonStats: baseSeasonStats }), 38);
    const older = developPlayer(makePlayer({ age: 23, strength: 50, potential: 90, seasonStats: baseSeasonStats }), 38);
    expect(young.strength - 50).toBeGreaterThan(older.strength - 50);
  });

  it('quem joga mais desenvolve mais rápido que quem fica no banco, mesma idade e potencial', () => {
    const starter = developPlayer(
      makePlayer({ age: 19, strength: 55, potential: 85, seasonStats: { ...makePlayer().seasonStats, minutesPlayed: 38 * 90 } }),
      38,
    );
    const benchWarmer = developPlayer(
      makePlayer({ age: 19, strength: 55, potential: 85, seasonStats: { ...makePlayer().seasonStats, minutesPlayed: 200 } }),
      38,
    );
    expect(starter.strength).toBeGreaterThan(benchWarmer.strength);
  });

  it('fica congelado dentro da faixa de prime, independente de minutagem', () => {
    const primeAge = Math.round((CONDITION_AGE_PEAK_MIN + CONDITION_AGE_PEAK_MAX) / 2);
    const player = makePlayer({
      age: primeAge,
      strength: 70,
      potential: 85,
      seasonStats: { ...makePlayer().seasonStats, minutesPlayed: 38 * 90 },
    });
    const next = developPlayer(player, 38);
    expect(next.strength).toBe(70);
  });

  it('declina depois do prime, mesmo tendo jogado a temporada inteira', () => {
    const player = makePlayer({
      age: CONDITION_AGE_PEAK_MAX + 3,
      strength: 80,
      potential: 80,
      seasonStats: { ...makePlayer().seasonStats, minutesPlayed: 38 * 90 },
    });
    const next = developPlayer(player, 38);
    expect(next.strength).toBeLessThan(80);
  });

  it('declina igual pra quem jogou tudo e pra quem não jogou nada — declínio é só etário', () => {
    const seasonPlaying = { appearances: 38, goals: 0, assists: 0, yellowCards: 0, redCards: 0, saves: 0, minutesPlayed: 38 * 90 };
    const seasonBenched = { appearances: 0, goals: 0, assists: 0, yellowCards: 0, redCards: 0, saves: 0, minutesPlayed: 0 };
    const age = CONDITION_AGE_PEAK_MAX + 4;
    const playing = developPlayer(makePlayer({ age, strength: 80, potential: 80, seasonStats: seasonPlaying }), 38);
    const benched = developPlayer(makePlayer({ age, strength: 80, potential: 80, seasonStats: seasonBenched }), 38);
    expect(playing.strength).toBe(benched.strength);
  });

  it('declínio nunca passa do teto configurado numa única temporada, mesmo bem distante do prime', () => {
    const player = makePlayer({
      age: CONDITION_AGE_PEAK_MAX + 20,
      strength: 80,
      potential: 80,
      seasonStats: { ...makePlayer().seasonStats, minutesPlayed: 38 * 90 },
    });
    const next = developPlayer(player, 38);
    expect(80 - next.strength).toBeLessThanOrEqual(6);
  });

  it('nunca cresce acima do potencial nem declina abaixo de 0', () => {
    const atPotential = developPlayer(
      makePlayer({ age: 18, strength: 80, potential: 80, seasonStats: { ...makePlayer().seasonStats, minutesPlayed: 38 * 90 } }),
      38,
    );
    expect(atPotential.strength).toBe(80);

    const veryOld = developPlayer(
      makePlayer({ age: 60, strength: 2, potential: 80, seasonStats: { ...makePlayer().seasonStats, minutesPlayed: 38 * 90 } }),
      38,
    );
    expect(veryOld.strength).toBeGreaterThanOrEqual(0);
  });

  it('sem partidas do clube na temporada (clubMatchesPlayed 0), trata participação como zero e não cresce', () => {
    const player = makePlayer({ age: 18, strength: 55, potential: 90, seasonStats: { ...makePlayer().seasonStats, minutesPlayed: 0 } });
    const next = developPlayer(player, 0);
    expect(next.strength).toBe(55);
  });
});
