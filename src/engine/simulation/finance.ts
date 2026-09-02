// Sistema financeiro: caixa do clube, bilheteria de jogos em casa e premiação de fim de
// temporada. Só receita nesta fase — não há contratos/salários no jogo ainda, então não existe
// despesa real pra modelar (ver PLANO_IMPLEMENTACAO.md/TODO.md). Funções puras, mesmo padrão do
// resto do motor.

import { mulberry32 } from '../rng';
import type { CareerState } from '../types/career';
import type { Club, ClubId } from '../types/club';
import type { FinanceTransaction } from '../types/finance';
import type { StandingEntry } from '../types/competition';
import {
  FINANCE_BASE_OCCUPANCY,
  FINANCE_BASE_STARTING_BUDGET_EUR,
  FINANCE_DEFAULT_TICKET_PRICE_SERIE_A_EUR,
  FINANCE_DEFAULT_TICKET_PRICE_SERIE_B_EUR,
  FINANCE_OCCUPANCY_MAX,
  FINANCE_OCCUPANCY_MIN,
  FINANCE_OCCUPANCY_MORALE_WEIGHT,
  FINANCE_OCCUPANCY_NOISE_AMPLITUDE,
  FINANCE_OCCUPANCY_OPPONENT_REPUTATION_WEIGHT,
  FINANCE_OCCUPANCY_REPUTATION_WEIGHT,
  FINANCE_OCCUPANCY_TABLE_POSITION_WEIGHT,
  FINANCE_SERIE_A_PRIZE_POOL_EUR,
  FINANCE_SERIE_B_PRIZE_POOL_EUR,
  FINANCE_STARTING_BUDGET_PER_CAPACITY_EUR,
  FINANCE_STARTING_BUDGET_PER_REPUTATION_EUR,
  FINANCE_TICKET_PRICE_ELASTICITY,
  FINANCE_TICKET_PRICE_MAX_MULTIPLIER,
  FINANCE_TICKET_PRICE_MIN_MULTIPLIER,
} from './config';
import { sortStandings } from './standings';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Orçamento inicial de um clube novo (EUR) — ver comentário da constante base em config.ts. */
export function computeStartingBudget(reputation: number, stadiumCapacity: number): number {
  return Math.round(
    FINANCE_BASE_STARTING_BUDGET_EUR +
      reputation * FINANCE_STARTING_BUDGET_PER_REPUTATION_EUR +
      stadiumCapacity * FINANCE_STARTING_BUDGET_PER_CAPACITY_EUR,
  );
}

/** Preço-padrão do ingresso (EUR) pra divisão — usado por toda CPU e como ponto de partida do clube do jogador. */
export function defaultTicketPrice(isSeriesA: boolean): number {
  return isSeriesA ? FINANCE_DEFAULT_TICKET_PRICE_SERIE_A_EUR : FINANCE_DEFAULT_TICKET_PRICE_SERIE_B_EUR;
}

/** Faixa permitida de ajuste de preço do ingresso do clube do jogador — múltiplo do padrão da própria divisão. */
export function ticketPriceRange(isSeriesA: boolean): { min: number; max: number } {
  const base = defaultTicketPrice(isSeriesA);
  return {
    min: Math.round(base * FINANCE_TICKET_PRICE_MIN_MULTIPLIER),
    max: Math.round(base * FINANCE_TICKET_PRICE_MAX_MULTIPLIER),
  };
}

export interface MatchdayRevenueInput {
  homeClub: Club;
  awayClub: Club;
  /** Posição do mandante na tabela ENTRANDO nessa partida (1 = líder) — não o resultado dela. */
  homeTablePosition: number;
  totalTeams: number;
  isSeriesA: boolean;
  /** Seed derivada por partida (ver `deriveSeed`) — mesmo padrão do seed de simulação, motor continua determinístico/replayável. */
  seed: number;
}

export interface MatchdayRevenueResult {
  attendance: number;
  occupancy: number;
  revenueEur: number;
}

/**
 * Bilheteria de UMA partida em casa — sempre creditada só ao mandante (visitante não leva cota,
 * mesma simplificação real das divisões de acesso do futebol brasileiro). Ocupação depende de
 * reputação/moral do mandante, posição na tabela, quão badalado é o visitante e do próprio preço
 * do ingresso (elasticidade leve — ver `FINANCE_TICKET_PRICE_ELASTICITY`), mais um ruído seedado.
 */
export function computeMatchdayRevenue(input: MatchdayRevenueInput): MatchdayRevenueResult {
  const { homeClub, awayClub, homeTablePosition, totalTeams, isSeriesA, seed } = input;
  const rng = mulberry32(seed);
  const midTable = (totalTeams + 1) / 2;
  const basePrice = defaultTicketPrice(isSeriesA);
  const priceRatio = basePrice > 0 ? homeClub.ticketPrice / basePrice : 1;

  const occupancy = clamp(
    FINANCE_BASE_OCCUPANCY +
      (homeClub.reputation - 50) * FINANCE_OCCUPANCY_REPUTATION_WEIGHT +
      (homeClub.morale - 50) * FINANCE_OCCUPANCY_MORALE_WEIGHT +
      (midTable - homeTablePosition) * FINANCE_OCCUPANCY_TABLE_POSITION_WEIGHT +
      Math.max(0, awayClub.reputation - homeClub.reputation) * FINANCE_OCCUPANCY_OPPONENT_REPUTATION_WEIGHT -
      (priceRatio - 1) * FINANCE_TICKET_PRICE_ELASTICITY +
      (rng() * 2 - 1) * FINANCE_OCCUPANCY_NOISE_AMPLITUDE,
    FINANCE_OCCUPANCY_MIN,
    FINANCE_OCCUPANCY_MAX,
  );

  const attendance = Math.round(homeClub.stadiumCapacity * occupancy);
  const revenueEur = Math.round(attendance * homeClub.ticketPrice);
  return { attendance, occupancy, revenueEur };
}

export interface ApplyMatchdayRevenueResult {
  clubs: Club[];
  /** Só não-null quando o mandante é o clube do jogador — ver `CareerState.financeLog`. */
  transaction: FinanceTransaction | null;
}

/**
 * Aplica a bilheteria de uma partida já resolvida ao caixa do mandante — chamada tanto de
 * `commitFixturesBatch` (jogos de CPU) quanto de `commitPlayerMatchResult` (jogo do jogador,
 * mandante ou visitante) em season.ts. `standings` deve ser a tabela ENTRANDO na partida (antes
 * do resultado dela ser aplicado), pra refletir a expectativa de público de quem vai assistir.
 */
export function applyMatchdayRevenue(
  clubs: Club[],
  homeClubId: ClubId,
  awayClubId: ClubId,
  standings: StandingEntry[],
  totalTeams: number,
  isSeriesA: boolean,
  playerClubId: ClubId,
  date: string,
  seed: number,
): ApplyMatchdayRevenueResult {
  const homeClub = clubs.find((c) => c.id === homeClubId);
  const awayClub = clubs.find((c) => c.id === awayClubId);
  if (!homeClub || !awayClub) return { clubs, transaction: null };

  const table = sortStandings(standings);
  const foundPosition = table.findIndex((entry) => entry.clubId === homeClubId) + 1;
  const homeTablePosition = foundPosition > 0 ? foundPosition : Math.ceil(totalTeams / 2);

  const { revenueEur } = computeMatchdayRevenue({ homeClub, awayClub, homeTablePosition, totalTeams, isSeriesA, seed });
  const budget = homeClub.budget + revenueEur;

  const transaction: FinanceTransaction | null =
    homeClubId === playerClubId
      ? { date, type: 'matchday', description: `Bilheteria vs. ${awayClub.shortName}`, amountEur: revenueEur, balanceAfterEur: budget }
      : null;

  return { clubs: clubs.map((c) => (c.id === homeClubId ? { ...c, budget } : c)), transaction };
}

function prizeWeight(position: number, totalTeams: number): number {
  return totalTeams - position + 1;
}

/** Premiação de um clube pela posição final numa competição de `totalTeams` times — fração do `poolEur` proporcional ao peso linear da posição (1º pesa `totalTeams`, último pesa 1). */
export function computePrizeMoney(position: number, totalTeams: number, poolEur: number): number {
  const totalWeight = (totalTeams * (totalTeams + 1)) / 2;
  if (totalWeight <= 0) return 0;
  return Math.round((poolEur * prizeWeight(position, totalTeams)) / totalWeight);
}

/** Prêmio total (EUR) distribuído entre os clubes de uma divisão ao fim da temporada. */
export function prizePoolForDivision(isSeriesA: boolean): number {
  return isSeriesA ? FINANCE_SERIE_A_PRIZE_POOL_EUR : FINANCE_SERIE_B_PRIZE_POOL_EUR;
}

/** Ajusta `Club.ticketPrice` do clube do jogador — sempre clamped à faixa da própria divisão (ver `ticketPriceRange`); CPU nunca chama isso. */
export function setTicketPrice(state: CareerState, ticketPrice: number): CareerState {
  const isSeriesA = state.season.competitions[0]?.teams.includes(state.playerClubId) ?? true;
  const { min, max } = ticketPriceRange(isSeriesA);
  const clamped = clamp(Math.round(ticketPrice), min, max);
  return {
    ...state,
    world: {
      ...state.world,
      clubs: state.world.clubs.map((c) => (c.id === state.playerClubId ? { ...c, ticketPrice: clamped } : c)),
    },
  };
}
