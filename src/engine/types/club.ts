import type { PlayerId } from './player';

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
  colors: ClubColors;
  stadiumCapacity: number;
  /** Referencia jogadores em World.players — não embute os objetos (fonte única de verdade). */
  squad: PlayerId[];
}
