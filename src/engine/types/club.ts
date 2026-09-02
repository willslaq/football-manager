import type { PlayerId } from './player';
import type { Formation, TacticStyle } from './tactics';

export type ClubId = string;

export interface ClubColors {
  primary: string;
  secondary: string;
}

export interface Club {
  id: ClubId;
  name: string;
  shortName: string;
  /** 0-100. */
  reputation: number;
  /**
   * Moral do clube, 0-100 — métrica de exibição (não influencia a simulação de partida,
   * só `player.morale` faz isso hoje). Semeada pela posição final da temporada anterior
   * (ver `moraleFromFinalStanding`) e ajustada a cada rodada pelo resultado (ver `advanceRound`).
   */
  morale: number;
  colors: ClubColors;
  stadiumCapacity: number;
  /** Referencia jogadores em World.players — não embute os objetos (fonte única de verdade). */
  squad: PlayerId[];
  /**
   * Categoria de base: jovens promessas (ver `generation/academy.ts`) que vivem em World.players
   * mas ficam de fora de `squad` — invisíveis pra escalação/simulação de partida de propósito
   * (Lineup.tsx e season.ts só leem `squad`). `promotePlayer` move um id daqui pra `squad`.
   * Opcional só pra tolerar saves salvos antes dessa feature — sempre tratar como `?? []`.
   */
  academySquad?: PlayerId[];
  /** Formação/estilo real pesquisado (último jogo) pra escalação automática de CPU — ausente = DEFAULT_AUTO_TACTICS (season.ts). */
  formation?: Formation;
  style?: TacticStyle;
  /**
   * Saldo em caixa do clube, em EUR (mesma convenção de `Player.marketValue` — exibição converte
   * pra R$, ver `formatEurBRL`). Cresce com bilheteria (`simulation/finance.ts`'s
   * `computeMatchdayRevenue`) e premiação de fim de temporada (`computePrizeMoney`) — só receita
   * por ora, sem despesas (não há contratos/salários no jogo ainda).
   */
  budget: number;
  /**
   * Preço médio do ingresso pro mando de campo, em EUR. CPU nunca muda o próprio (fica sempre no
   * padrão da divisão, ver `defaultTicketPrice`); o clube do jogador pode ajustar dentro da faixa
   * de `ticketPriceRange`, na tela de Finanças. Afeta a receita de bilheteria linearmente e a
   * ocupação do estádio com uma leve elasticidade (ver `FINANCE_TICKET_PRICE_ELASTICITY`).
   */
  ticketPrice: number;
}
