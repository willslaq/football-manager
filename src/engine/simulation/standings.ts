import type { StandingEntry } from '../types/competition';

/**
 * Ordena a tabela por pontos, vitórias, saldo de gols e gols pró — os
 * critérios de desempate oficiais que o motor consegue calcular no MVP
 * (competition.json). Confronto direto e cartões ficam de fora por ora: o
 * motor de partida ainda não gera cartões, e confronto direto exigiria
 * histórico completo de resultados (indisponível para as rodadas herdadas da
 * situação real, sem placar jogo a jogo).
 */
export function sortStandings(standings: StandingEntry[]): StandingEntry[] {
  return [...standings].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.won !== a.won) return b.won - a.won;
    const goalDiffA = a.goalsFor - a.goalsAgainst;
    const goalDiffB = b.goalsFor - b.goalsAgainst;
    if (goalDiffB !== goalDiffA) return goalDiffB - goalDiffA;
    return b.goalsFor - a.goalsFor;
  });
}
