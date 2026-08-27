import { describe, expect, it } from 'vitest';
import { generateWorld } from './world';

describe('generateWorld', () => {
  it('produz o mesmo mundo para a mesma seed', () => {
    const a = generateWorld(42);
    const b = generateWorld(42);
    expect(a).toEqual(b);
  });

  it('produz atributos diferentes para seeds diferentes', () => {
    const a = generateWorld(1);
    const b = generateWorld(2);
    expect(a.players[0].attributes).not.toEqual(b.players[0].attributes);
  });

  it('carrega os 20 clubes da Série A 2026 com elenco não vazio', () => {
    const world = generateWorld(1);
    expect(world.clubs).toHaveLength(20);
    for (const club of world.clubs) {
      expect(club.squad.length).toBeGreaterThan(0);
    }
  });

  it('carrega o total esperado de jogadores reais (BID completo)', () => {
    const world = generateWorld(1);
    expect(world.players.length).toBeGreaterThan(700);
  });

  it('todo jogador referenciado em squad existe em players', () => {
    const world = generateWorld(1);
    const playerIds = new Set(world.players.map((p) => p.id));
    for (const club of world.clubs) {
      for (const playerId of club.squad) {
        expect(playerIds.has(playerId)).toBe(true);
      }
    }
  });

  it('distribuições de idade e força são plausíveis (histograma no console)', () => {
    const world = generateWorld(1);

    const ageBuckets: Record<string, number> = {};
    const strengthBuckets: Record<string, number> = {};
    const positionCounts: Record<string, number> = {};

    for (const player of world.players) {
      const ageBucket = `${Math.floor(player.age / 5) * 5}-${Math.floor(player.age / 5) * 5 + 4}`;
      ageBuckets[ageBucket] = (ageBuckets[ageBucket] ?? 0) + 1;

      const strengthBucket = `${Math.floor(player.strength / 10) * 10}-${Math.floor(player.strength / 10) * 10 + 9}`;
      strengthBuckets[strengthBucket] = (strengthBuckets[strengthBucket] ?? 0) + 1;

      positionCounts[player.position] = (positionCounts[player.position] ?? 0) + 1;

      expect(player.strength).toBeGreaterThanOrEqual(0);
      expect(player.strength).toBeLessThanOrEqual(100);
      expect(player.potential).toBeGreaterThanOrEqual(player.strength);
    }

    console.log('Histograma de idade:', ageBuckets);
    console.log('Histograma de força:', strengthBuckets);
    console.log('Distribuição de posições:', positionCounts);

    // Sanidade: idade de atleta profissional federado (mesmo intervalo validado em validateCareerState).
    const outliers = world.players.filter((p) => p.age < 15 || p.age > 45);
    expect(outliers.length).toBe(0);
  });

  it('reputação de clube reflete a posição real na tabela (líder > lanterna)', () => {
    const world = generateWorld(1);
    const palmeiras = world.clubs.find((c) => c.id === 'palmeiras')!;
    const chapecoense = world.clubs.find((c) => c.id === 'chapecoense')!;
    expect(palmeiras.reputation).toBeGreaterThan(chapecoense.reputation);
  });
});
