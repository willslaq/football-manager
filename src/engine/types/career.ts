import type { ClubId, Club } from './club';
import type { Player, PlayerId } from './player';
import type { Season } from './season';
import type { CompetitionId } from './competition';
import type { TacticalIntensity } from './tactics';

export interface World {
  clubs: Club[];
  players: Player[];
}

export interface Trainer {
  id: string;
  name: string;
}

export interface CareerHistoryEntry {
  year: number;
  competitionId: CompetitionId;
  champion: ClubId;
  /** Clubes classificados pra Libertadores (fase de grupos + Pré-Libertadores) nessa temporada — vazio pra uma entrada da Série B. */
  libertadores: ClubId[];
  /**
   * Clubes rebaixados nessa temporada. Pra uma entrada da Série A, é real (ver `startNewSeason` —
   * esses clubes de fato jogam a Série B no ano seguinte). Pra uma entrada da Série B, é só
   * informativo (posições 17-20): não há dados de clubes da Série C pra substituí-los, então
   * continuam na Série B.
   */
  relegated: ClubId[];
  /** Clubes promovidos nessa temporada (posições 1-4) — só populado pra uma entrada da Série B; vazio pra Série A. */
  promoted: ClubId[];
  /** Artilheiro da temporada — null se ninguém marcou (borda: temporada abortada cedo). */
  topScorer: { playerId: PlayerId; goals: number } | null;
  /** Luva de Ouro (goleiro com mais defesas) da temporada — null se ninguém defendeu nada. */
  goldenGlove: { playerId: PlayerId; saves: number } | null;
}

export interface CareerSettings {
  /** Quanto formação/estilo pesam na simulação de partida — ajustável a qualquer momento. */
  tacticalIntensity: TacticalIntensity;
}

/** Raiz serializável da carreira — este objeto inteiro é o save. */
export interface CareerState {
  seed: number;
  trainer: Trainer;
  playerClubId: ClubId;
  world: World;
  season: Season;
  history: CareerHistoryEntry[];
  settings: CareerSettings;
}
