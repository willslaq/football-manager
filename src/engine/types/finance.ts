export type FinanceTransactionType = 'matchday' | 'prize';

/**
 * Um lançamento no extrato do clube do jogador — `CareerState.financeLog` só rastreia o clube do
 * jogador (todo clube tem `Club.budget` atualizado, mas só o extrato do jogador é guardado, pra
 * não crescer sem necessidade com os outros ~40 clubes do mundo). `balanceAfterEur` é um snapshot
 * do saldo já incluindo esse lançamento — barato de guardar, evita a UI ter que somar o extrato
 * inteiro só pra mostrar o saldo corrente de cada linha.
 */
export interface FinanceTransaction {
  /** Data do lançamento (ISO 'YYYY-MM-DD') — `season.currentDate` no momento em que aconteceu. */
  date: string;
  type: FinanceTransactionType;
  /** Texto pronto pra exibição (ex.: "Bilheteria vs. Palmeiras", "Premiação Série A — 3º lugar"). */
  description: string;
  /** Sempre positivo nesta fase (só receita — bilheteria/premiação; sem despesas ainda). */
  amountEur: number;
  balanceAfterEur: number;
}
