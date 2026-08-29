import { describe, expect, it } from 'vitest';
import { createBrasileiraoCareer } from '../generation/career';
import type { Lineup, Tactics } from '../types/tactics';
import { advanceRound, applyCardSuspension } from './season';
import { pickAutoLineup } from './autoLineup';

const DEFAULT_TACTICS: Tactics = { formation: '4-4-2', style: 'balanced' };

function autoLineupFor(state: ReturnType<typeof createBrasileiraoCareer>, clubId: string): Lineup {
  const playersById = new Map(state.world.players.map((p) => [p.id, p]));
  const club = state.world.clubs.find((c) => c.id === clubId)!;
  const squad = club.squad.map((id) => playersById.get(id)!);
  const starters = pickAutoLineup(squad, DEFAULT_TACTICS.formation);
  const ids = starters.map((p) => p.id);
  return {
    starters: ids,
    formation: DEFAULT_TACTICS.formation,
    captain: ids[0],
    penaltyTaker: ids[ids.length - 1],
    freeKickTaker: ids[ids.length - 1],
  };
}

describe('applyCardSuspension (regra CBF: 3 amarelos acumulados ou 1 vermelho suspendem 1 jogo)', () => {
  it('acumula amarelo sem suspender antes do 3º', () => {
    const result = applyCardSuspension({ pendingYellowCards: 0, suspendedMatches: 0 }, 1, 0);
    expect(result).toEqual({ pendingYellowCards: 1, suspendedMatches: 0 });
  });

  it('suspende e zera o contador exatamente no 3º amarelo acumulado', () => {
    const result = applyCardSuspension({ pendingYellowCards: 2, suspendedMatches: 0 }, 1, 0);
    expect(result).toEqual({ pendingYellowCards: 0, suspendedMatches: 1 });
  });

  it('vermelho direto suspende sem depender de amarelo', () => {
    const result = applyCardSuspension({ pendingYellowCards: 0, suspendedMatches: 0 }, 0, 1);
    expect(result).toEqual({ pendingYellowCards: 0, suspendedMatches: 1 });
  });

  it('2º amarelo (expulsão) suspende, mas os amarelos daquela partida não contam pro acúmulo', () => {
    // yellowCards=2 (o 1º + o do 2º amarelo) e redCards=1 na mesma partida — nenhum dos dois entra no acúmulo.
    const result = applyCardSuspension({ pendingYellowCards: 0, suspendedMatches: 0 }, 2, 1);
    expect(result).toEqual({ pendingYellowCards: 0, suspendedMatches: 1 });
  });

  it('vermelho na partida não apaga amarelo já acumulado de partidas anteriores', () => {
    const result = applyCardSuspension({ pendingYellowCards: 2, suspendedMatches: 0 }, 1, 1);
    // O amarelo desta partida (parte do 2º amarelo/vermelho) não soma, mas o pendingYellowCards
    // trazido de antes (2, de outras partidas) permanece intacto — só zera ao bater 3.
    expect(result).toEqual({ pendingYellowCards: 2, suspendedMatches: 1 });
  });

  it('suspensão anterior soma com uma nova (ex.: vermelho enquanto já cumpre suspensão)', () => {
    const result = applyCardSuspension({ pendingYellowCards: 0, suspendedMatches: 1 }, 0, 1);
    expect(result.suspendedMatches).toBe(2);
  });
});

describe('advanceRound — suspensão bloqueia escalação automática da CPU e decrementa depois de cumprida', () => {
  it('jogador suspenso não é selecionado pela auto-escalação da CPU, e a suspensão é cumprida (decrementa) na rodada', () => {
    const state = createBrasileiraoCareer(11, { id: 't1', name: 'X' }, 'palmeiras');
    const cpuClub = state.world.clubs.find((c) => c.id !== 'palmeiras')!;
    const suspendedPlayerId = cpuClub.squad[0];

    const stateWithSuspension = {
      ...state,
      world: {
        ...state.world,
        players: state.world.players.map((p) =>
          p.id === suspendedPlayerId ? { ...p, suspendedMatches: 1 } : p,
        ),
      },
    };

    const lineup = autoLineupFor(stateWithSuspension, 'palmeiras');
    const next = advanceRound(stateWithSuspension, { playerLineup: lineup, playerTactics: DEFAULT_TACTICS });

    const suspendedAfter = next.world.players.find((p) => p.id === suspendedPlayerId)!;

    // Não jogou (excluído da auto-escalação da CPU) — sem aparição registrada.
    expect(suspendedAfter.seasonStats.appearances).toBe(0);
    // Cumpriu a suspensão nesta rodada (não jogou) — decrementa de volta a 0, disponível de novo.
    expect(suspendedAfter.suspendedMatches).toBe(0);

    // O clube ainda escalou 11 titulares normalmente (só sem o suspenso) — nada quebrou no resto do elenco.
    const clubAppearances = cpuClub.squad
      .map((id) => next.world.players.find((p) => p.id === id)!)
      .reduce((sum, p) => sum + p.seasonStats.appearances, 0);
    expect(clubAppearances).toBe(11);
  });
});

describe('advanceRound — temporada inteira mantém os invariantes de suspensão', () => {
  it('pendingYellowCards nunca chega a 3 e suspendedMatches nunca fica negativo', () => {
    let state = createBrasileiraoCareer(23, { id: 't1', name: 'X' }, 'flamengo');
    let iterations = 0;
    const totalRounds = state.season.competitions[0].fixtures.length;

    while (state.season.state !== 'finished') {
      const lineup = autoLineupFor(state, 'flamengo');
      state = advanceRound(state, { playerLineup: lineup, playerTactics: DEFAULT_TACTICS });
      iterations++;
      expect(iterations).toBeLessThanOrEqual(totalRounds + 1);
    }

    for (const player of state.world.players) {
      expect(player.pendingYellowCards).toBeGreaterThanOrEqual(0);
      expect(player.pendingYellowCards).toBeLessThan(3);
      expect(player.suspendedMatches).toBeGreaterThanOrEqual(0);
    }
  });
});
