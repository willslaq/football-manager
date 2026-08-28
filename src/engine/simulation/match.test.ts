import { describe, expect, it } from 'vitest';
import { generateWorld } from '../generation/world';
import type { World } from '../types/career';
import type { Formation, TacticStyle } from '../types/tactics';
import { pickAutoLineup } from './autoLineup';
import { simulateMatch, type MatchTeamInput } from './match';

function buildTeam(
  world: World,
  clubId: string,
  formation: Formation = '4-4-2',
  style: TacticStyle = 'balanced',
): MatchTeamInput {
  const club = world.clubs.find((c) => c.id === clubId);
  if (!club) throw new Error(`clube não encontrado: ${clubId}`);
  const playersById = new Map(world.players.map((p) => [p.id, p]));
  const squad = club.squad.map((id) => playersById.get(id)!);
  const starters = pickAutoLineup(squad, formation);
  return { clubId, players: starters, tactics: { formation, style } };
}

describe('simulateMatch', () => {
  const world = generateWorld(99);
  const home = buildTeam(world, 'palmeiras');
  const away = buildTeam(world, 'chapecoense');

  it('é determinístico: mesma entrada e seed produzem o mesmo resultado', () => {
    const a = simulateMatch(home, away, 12345);
    const b = simulateMatch(home, away, 12345);
    expect(a).toEqual(b);
  });

  it('seeds diferentes produzem resultados diferentes', () => {
    const a = simulateMatch(home, away, 1);
    const b = simulateMatch(home, away, 2);
    expect(a).not.toEqual(b);
  });

  it('sempre traz uma explicação legível não vazia', () => {
    for (let seed = 0; seed < 20; seed++) {
      const result = simulateMatch(home, away, seed);
      expect(result.explanation.length).toBeGreaterThan(0);
      for (const reason of result.explanation) {
        expect(reason.factor).toBeTruthy();
        expect(typeof reason.impact).toBe('number');
        expect(reason.note.length).toBeGreaterThan(0);
      }
    }
  });

  it('estatísticas são internamente consistentes', () => {
    for (let seed = 0; seed < 50; seed++) {
      const result = simulateMatch(home, away, seed);
      expect(result.stats.shotsOnTarget.home).toBeLessThanOrEqual(result.stats.shots.home);
      expect(result.stats.shotsOnTarget.away).toBeLessThanOrEqual(result.stats.shots.away);
      expect(result.homeGoals).toBeLessThanOrEqual(result.stats.shotsOnTarget.home);
      expect(result.awayGoals).toBeLessThanOrEqual(result.stats.shotsOnTarget.away);
      const totalPossession = result.stats.possession.home + result.stats.possession.away;
      expect(totalPossession).toBeGreaterThanOrEqual(99);
      expect(totalPossession).toBeLessThanOrEqual(101);
      expect(result.manOfTheMatch).toBeTruthy();
    }
  });

  it('time mais forte vence com mais frequência em 10.000 partidas, mas não sempre', () => {
    let homeWins = 0;
    let draws = 0;
    let awayWins = 0;
    const N = 10_000;

    for (let seed = 0; seed < N; seed++) {
      const result = simulateMatch(home, away, seed);
      if (result.homeGoals > result.awayGoals) homeWins++;
      else if (result.homeGoals < result.awayGoals) awayWins++;
      else draws++;
    }

    console.log(`Palmeiras (mandante) ${homeWins} - ${draws} - ${awayWins} Chapecoense (visitante), em ${N} jogos`);

    // Com overalls reais (EA FC 26) o gap entre os dois times é mais comprimido do
    // que o gerador procedural antigo produzia, então empates ficam mais comuns —
    // o mandante vence bem mais que o visitante, mas não necessariamente >50% bruto.
    expect(homeWins).toBeGreaterThan(awayWins * 1.2);
    // Mesmo o time muito mais fraco deve vencer algumas vezes — resultado não pode ser determinístico demais.
    expect(awayWins).toBeGreaterThan(0);
  });

  it('confronto entre iguais (mesmo clube nos dois lados) fica equilibrado ao longo de muitos jogos', () => {
    const teamA = buildTeam(world, 'internacional');
    const teamB = buildTeam(world, 'internacional');

    let winsA = 0;
    let winsB = 0;
    const N = 2000;
    for (let seed = 0; seed < N; seed++) {
      const result = simulateMatch(teamA, teamB, seed);
      if (result.homeGoals > result.awayGoals) winsA++;
      else if (result.homeGoals < result.awayGoals) winsB++;
    }

    // Mandante deve levar vantagem (fator casa), mas não esmagadoramente.
    expect(winsA).toBeGreaterThan(winsB);
    expect(winsB / N).toBeGreaterThan(0.15);
  });
});
