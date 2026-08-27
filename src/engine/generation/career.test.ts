import { describe, expect, it } from 'vitest';
import { createBrasileiraoCareer } from './career';
import { validateCareerState } from '../validateCareerState';

describe('createBrasileiraoCareer', () => {
  it('gera um CareerState real que passa em validateCareerState', () => {
    const career = createBrasileiraoCareer(7, { id: 't1', name: 'Treinador Exemplo' }, 'palmeiras');
    const result = validateCareerState(career);

    if (!result.valid) {
      console.log('Erros de validação:', result.errors.slice(0, 20));
    }
    expect(result.valid).toBe(true);
  });

  it('a competição tem 38 rodadas com 10 jogos cada e temporada em andamento', () => {
    const career = createBrasileiraoCareer(7, { id: 't1', name: 'Treinador Exemplo' }, 'palmeiras');
    const competition = career.season.competitions[0];

    expect(competition.fixtures).toHaveLength(38);
    for (const round of competition.fixtures) {
      expect(round).toHaveLength(10);
    }
    expect(career.season.state).toBe('in_progress');
    expect(career.season.currentRound).toBeGreaterThan(1);
  });

  it('é determinístico para a mesma seed e reflete o clube escolhido', () => {
    const a = createBrasileiraoCareer(7, { id: 't1', name: 'X' }, 'flamengo');
    const b = createBrasileiraoCareer(7, { id: 't1', name: 'X' }, 'flamengo');
    expect(a).toEqual(b);
    expect(a.playerClubId).toBe('flamengo');
  });
});
