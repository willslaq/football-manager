import { describe, expect, it } from 'vitest';
import { generateWorld } from '../generation/world';
import type { World } from '../types/career';
import type { Player, Position } from '../types/player';
import type { Formation, TacticStyle } from '../types/tactics';
import { pickAutoLineup } from './autoLineup';
import { simulateMatch, type MatchSubstitution, type MatchTeamInput } from './match';

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

/** Jogador do elenco do clube que não está entre os titulares — pra testes de substituição. */
function pickBenchPlayer(world: World, clubId: string, starters: Player[], position?: Position): Player {
  const club = world.clubs.find((c) => c.id === clubId);
  if (!club) throw new Error(`clube não encontrado: ${clubId}`);
  const playersById = new Map(world.players.map((p) => [p.id, p]));
  const starterIds = new Set(starters.map((p) => p.id));
  const candidate = club.squad
    .map((id) => playersById.get(id)!)
    .find((p) => !starterIds.has(p.id) && (!position || p.position === position));
  if (!candidate) throw new Error(`sem reserva disponível pra ${clubId} (posição ${position ?? 'qualquer'})`);
  return candidate;
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

  it('a força de ataque degrada ao longo da partida pelo desgaste de energia (Player.condition)', () => {
    const early: number[] = [];
    const late: number[] = [];

    for (let seed = 0; seed < 300; seed++) {
      simulateMatch(home, away, seed, 'subtle', (entry) => {
        if (entry.kind !== 'chance' || entry.teamId !== home.clubId) return;
        if (entry.minute <= 15) early.push(entry.attackStrength);
        else if (entry.minute >= 75) late.push(entry.attackStrength);
      });
    }

    // Amostra mínima pra média não ser ruído — BASE_CHANCES_PER_TEAM=6/90min é esparso.
    expect(early.length).toBeGreaterThan(30);
    expect(late.length).toBeGreaterThan(30);

    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const earlyAvg = avg(early);
    const lateAvg = avg(late);

    // Perceptível (não é ruído estatístico) mas não catastrófico — mesma faixa de
    // degradação implícita em ENERGY_DRAIN_PER_MINUTE_OUTFIELD/effectiveRating's conditionFactor.
    expect(lateAvg).toBeLessThan(earlyAvg);
    expect(earlyAvg - lateAvg).toBeGreaterThan(earlyAvg * 0.02);
    expect(earlyAvg - lateAvg).toBeLessThan(earlyAvg * 0.25);
  });

  it('finalEnergyByPlayerId traz a energia final de todo mundo que jogou, dentro da faixa 0-100', () => {
    const result = simulateMatch(home, away, 42);
    const allStarterIds = [...home.players, ...away.players].map((p) => p.id);

    for (const id of allStarterIds) {
      const energy = result.finalEnergyByPlayerId[id];
      expect(energy).toBeDefined();
      expect(energy).toBeGreaterThanOrEqual(0);
      expect(energy).toBeLessThanOrEqual(100);
      // Quem jogou os 90 minutos inteiros gasta energia real, não pode terminar intacto em 100.
      expect(energy).toBeLessThan(100);
    }
  });
});

describe('simulateMatch com substituições', () => {
  const world = generateWorld(99);
  const home = buildTeam(world, 'palmeiras');
  const away = buildTeam(world, 'chapecoense');

  it('não muda os eventos dos minutos anteriores à troca (prefixo determinístico da mesma seed)', () => {
    const outPlayer = home.players.find((p) => p.position !== 'GOL')!;
    const benchPlayer = pickBenchPlayer(world, 'palmeiras', home.players);
    const sub: MatchSubstitution = { minute: 46, teamSide: 'home', playerOutId: outPlayer.id, playerIn: benchPlayer };

    for (let seed = 0; seed < 20; seed++) {
      const base = simulateMatch(home, away, seed);
      const withSub = simulateMatch(home, away, seed, 'subtle', undefined, [sub]);
      expect(withSub.events.filter((e) => e.minute <= 45)).toEqual(base.events.filter((e) => e.minute <= 45));
    }
  });

  it('gera um evento substitution com minuto, playerId (saiu) e playerInId (entrou) corretos', () => {
    const outPlayer = home.players.find((p) => p.position !== 'GOL')!;
    const benchPlayer = pickBenchPlayer(world, 'palmeiras', home.players);
    const sub: MatchSubstitution = { minute: 46, teamSide: 'home', playerOutId: outPlayer.id, playerIn: benchPlayer };

    const result = simulateMatch(home, away, 777, 'subtle', undefined, [sub]);
    const subEvent = result.events.find((e) => e.type === 'substitution');
    expect(subEvent).toMatchObject({
      minute: 46,
      teamId: home.clubId,
      playerId: outPlayer.id,
      playerInId: benchPlayer.id,
    });
  });

  it('o jogador substituído não gera mais nenhum evento de jogo depois de sair', () => {
    const outPlayer = home.players.find((p) => p.position !== 'GOL')!;
    const benchPlayer = pickBenchPlayer(world, 'palmeiras', home.players);
    const subMinute = 46;
    const sub: MatchSubstitution = { minute: subMinute, teamSide: 'home', playerOutId: outPlayer.id, playerIn: benchPlayer };

    for (let seed = 0; seed < 150; seed++) {
      const result = simulateMatch(home, away, seed, 'subtle', undefined, [sub]);
      const eventsAfterExit = result.events.filter(
        (e) => e.playerId === outPlayer.id && e.type !== 'substitution' && e.minute >= subMinute,
      );
      expect(eventsAfterExit).toHaveLength(0);
    }
  });

  it('substituto com atributos extremos altera a produção ofensiva de forma perceptível (não é cosmético)', () => {
    const outPlayer = home.players.find((p) => p.position !== 'GOL')!;
    const superStriker: Player = {
      ...outPlayer,
      id: 'super-striker-test',
      attributes: { ...outPlayer.attributes, finishing: 99, heading: 99 },
    };
    const sub: MatchSubstitution = { minute: 1, teamSide: 'home', playerOutId: outPlayer.id, playerIn: superStriker };

    const N = 400;
    let baselineGoals = 0;
    let subGoals = 0;
    for (let seed = 0; seed < N; seed++) {
      const baseline = simulateMatch(home, away, seed);
      baselineGoals += baseline.events.filter((e) => e.type === 'goal' && e.playerId === outPlayer.id).length;

      const withSub = simulateMatch(home, away, seed, 'subtle', undefined, [sub]);
      subGoals += withSub.events.filter((e) => e.type === 'goal' && e.playerId === superStriker.id).length;
    }

    expect(subGoals).toBeGreaterThan(baselineGoals * 1.3);
  });

  it('substituição do goleiro: defesas após a troca são creditadas ao novo goleiro, não ao antigo', () => {
    const outGoalkeeper = home.players.find((p) => p.position === 'GOL')!;
    const benchGoalkeeper = pickBenchPlayer(world, 'palmeiras', home.players, 'GOL');
    const sub: MatchSubstitution = {
      minute: 1,
      teamSide: 'home',
      playerOutId: outGoalkeeper.id,
      playerIn: benchGoalkeeper,
    };

    let savesForOld = 0;
    let savesForNew = 0;
    for (let seed = 0; seed < 300; seed++) {
      const result = simulateMatch(home, away, seed, 'subtle', undefined, [sub]);
      savesForOld += result.events.filter((e) => e.type === 'shot_saved' && e.goalkeeperId === outGoalkeeper.id).length;
      savesForNew += result.events.filter((e) => e.type === 'shot_saved' && e.goalkeeperId === benchGoalkeeper.id).length;
    }

    expect(savesForOld).toBe(0);
    expect(savesForNew).toBeGreaterThan(0);
  });

  it('finalEnergyByPlayerId: quem saiu fica congelado na energia de quando saiu, e quem entrou parte da própria condition (não de 100 fixo)', () => {
    const outPlayer = home.players.find((p) => p.position !== 'GOL')!;
    const tiredBenchPlayer: Player = { ...pickBenchPlayer(world, 'palmeiras', home.players), condition: 60 };
    const subMinute = 20;
    const sub: MatchSubstitution = { minute: subMinute, teamSide: 'home', playerOutId: outPlayer.id, playerIn: tiredBenchPlayer };

    const result = simulateMatch(home, away, 321, 'subtle', undefined, [sub]);

    // Saiu no minuto 20: drenou só ~19-20 minutos (0.35/min), não os 90 inteiros — congelado bem
    // acima de quem ficou o jogo todo (que termina perto de 100 - 90*0.35 ≈ 68).
    expect(result.finalEnergyByPlayerId[outPlayer.id]).toBeGreaterThan(90);
    expect(result.finalEnergyByPlayerId[outPlayer.id]).toBeLessThan(100);

    // Entrou com condition=60, não com energia cheia — e só drena a partir daí (não pode terminar acima disso).
    expect(result.finalEnergyByPlayerId[tiredBenchPlayer.id]).toBeLessThanOrEqual(60);
    expect(result.finalEnergyByPlayerId[tiredBenchPlayer.id]).toBeGreaterThanOrEqual(55);
  });
});
