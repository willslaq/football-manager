export type PlayerId = string;

/**
 * Posições no padrão do futebol moderno (nomenclatura pt-BR, granularidade
 * equivalente à usada em jogos como o FIFA/EA FC).
 *
 * GOL Goleiro           VOL Volante            PD  Ponta Direita
 * ZAG Zagueiro          MC  Meia Central       PE  Ponta Esquerda
 * LD  Lateral Direito   MD  Meia Direita       SA  Segundo Atacante
 * LE  Lateral Esquerdo  ME  Meia Esquerda      CA  Centroavante
 * ALD Ala Direito       MEA Meia-Atacante
 * ALE Ala Esquerdo
 */
export const POSITIONS = [
  'GOL',
  'ZAG',
  'LD',
  'LE',
  'ALD',
  'ALE',
  'VOL',
  'MC',
  'MD',
  'ME',
  'MEA',
  'PD',
  'PE',
  'SA',
  'CA',
] as const;

export type Position = (typeof POSITIONS)[number];

export interface PlayerAttributes {
  finishing: number;
  speed: number;
  dribbling: number;
  passing: number;
  heading: number;
  marking: number;
  tackling: number;
  positioning: number;
  reflexes: number;
}

export interface PlayerSeasonStats {
  appearances: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
  /** Defesas feitas como goleiro (chutes no alvo evitados). */
  saves: number;
}

export interface Player {
  id: PlayerId;
  name: string;
  age: number;
  nationality: string;
  position: Position;
  secondaryPositions: Position[];
  /** Força geral, 0-100. */
  strength: number;
  /** Cada atributo em 0-100. */
  attributes: PlayerAttributes;
  /** Condição física, 0-100. */
  condition: number;
  /** Moral, 0-100. */
  morale: number;
  /** 0-100. Oculto da UI voltada ao jogador (SRS §8). */
  potential: number;
  seasonStats: PlayerSeasonStats;
}
