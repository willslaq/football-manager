import { describe, expect, it, vi } from 'vitest';
import type { Lineup, Player } from '../engine/types';

// careerStore.ts instancia um Web Worker no top-level do módulo (fora de qualquer
// função) — sem isso o import falha em ambiente Node do vitest ("Worker is not
// defined"), mesmo só testando uma função pura exportada do arquivo, que nunca toca
// o worker de verdade.
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage(): void {}
  terminate(): void {}
}
vi.stubGlobal('Worker', FakeWorker);

const { removeSuspendedStarters } = await import('./careerStore');

function player(id: string, suspendedMatches = 0): Player {
  return { id, suspendedMatches } as unknown as Player;
}

describe('removeSuspendedStarters', () => {
  it('devolve a mesma referência quando nenhum titular está suspenso (evita re-render à toa)', () => {
    const lineup: Lineup = {
      starters: ['a', 'b'],
      formation: '4-4-2',
      captain: 'a',
      penaltyTaker: 'a',
      freeKickTaker: 'a',
      slotAssignments: { 'def-0': 'a', 'def-1': 'b' },
    };
    const players = [player('a'), player('b')];
    expect(removeSuspendedStarters(lineup, players)).toBe(lineup);
  });

  it('remove titular suspenso dos starters e limpa a vaga correspondente em slotAssignments', () => {
    const lineup: Lineup = {
      starters: ['a', 'b', 'c'],
      formation: '4-4-2',
      captain: 'a',
      penaltyTaker: 'a',
      freeKickTaker: 'a',
      slotAssignments: { 'def-0': 'a', 'def-1': 'b', 'def-2': 'c' },
    };
    const players = [player('a'), player('b', 1), player('c')];
    const result = removeSuspendedStarters(lineup, players);

    expect(result.starters).toEqual(['a', 'c']);
    expect(result.slotAssignments).toEqual({ 'def-0': 'a', 'def-1': null, 'def-2': 'c' });
  });

  it('reatribui capitão/cobrador de pênalti/cobrador de falta se eram o jogador suspenso', () => {
    const lineup: Lineup = {
      starters: ['a', 'b'],
      formation: '4-4-2',
      captain: 'b',
      penaltyTaker: 'b',
      freeKickTaker: 'b',
      slotAssignments: { 'def-0': 'a', 'def-1': 'b' },
    };
    const players = [player('a'), player('b', 1)];
    const result = removeSuspendedStarters(lineup, players);

    expect(result.captain).toBe('a');
    expect(result.penaltyTaker).toBe('a');
    expect(result.freeKickTaker).toBe('a');
  });
});
