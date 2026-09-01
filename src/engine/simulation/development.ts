import type { Player } from '../types/player';
import {
  CONDITION_AGE_PEAK_MAX,
  CONDITION_AGE_PEAK_MIN,
  DEVELOPMENT_BASE_GROWTH_RATE,
  DEVELOPMENT_MAX_DECLINE_PER_SEASON,
  DEVELOPMENT_DECLINE_PER_YEAR,
  DEVELOPMENT_MIN_GROWTH_SPEED,
  DEVELOPMENT_YOUTH_AGE_FLOOR,
  physicalAgeDistance,
} from './config';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Quão rápido um jogador abaixo do prime fecha o gap pro potencial, de 0 a 1 — máximo
 * (`DEVELOPMENT_YOUTH_AGE_FLOOR` ou mais novo) até o piso (`DEVELOPMENT_MIN_GROWTH_SPEED`) bem na
 * borda do prime (`CONDITION_AGE_PEAK_MIN`). Puramente etário; minutagem entra à parte, como
 * multiplicador de participação (ver `developPlayer`).
 */
function growthSpeed(age: number): number {
  if (age >= CONDITION_AGE_PEAK_MIN) return 0;
  const span = CONDITION_AGE_PEAK_MIN - DEVELOPMENT_YOUTH_AGE_FLOOR;
  const t = (CONDITION_AGE_PEAK_MIN - age) / span;
  return clamp(t, DEVELOPMENT_MIN_GROWTH_SPEED, 1);
}

/**
 * Evolui a força (`Player.strength`) de um jogador ao virar a temporada — chamado por
 * `startNewSeason` ANTES de zerar `seasonStats`/envelhecer, com os dados da temporada que acabou
 * de terminar (mesma idade e minutagem vividas). Três regimes, seguindo a mesma faixa de prime
 * físico já usada pra fadiga (`CONDITION_AGE_PEAK_MIN/MAX` — ver comentário lá sobre ser a fonte
 * única da verdade):
 *
 * - Abaixo do prime: cresce rumo ao potencial. Retornos decrescentes (proporcional ao gap
 *   restante) e escalado por dois fatores independentes — quão jovem (`growthSpeed`) e quanto
 *   jogou (`participation`, minutos jogados / minutos disponíveis no elenco do clube). Um jovem
 *   que não sai do banco praticamente não evolui, por mais potencial que tenha.
 * - No prime: congelado. É o platô — sem crescimento nem declínio até a idade sair da faixa.
 * - Acima do prime: declina, só em função da distância etária (jogar mais não segura o declínio —
 *   é físico, não se resolve descansando no banco), com teto por temporada pra não desabar de vez.
 *
 * `clubMatchesPlayed` é o total de partidas do CLUBE na temporada (não do jogador) — denominador
 * da participação; 0 (sem dados) trata como não jogou nada.
 */
export function developPlayer(player: Player, clubMatchesPlayed: number): Player {
  const { age, potential, strength } = player;

  if (age < CONDITION_AGE_PEAK_MIN) {
    const availableMinutes = clubMatchesPlayed * 90;
    const participation = availableMinutes > 0 ? clamp(player.seasonStats.minutesPlayed / availableMinutes, 0, 1) : 0;
    const gap = Math.max(0, potential - strength);
    const growth = gap * DEVELOPMENT_BASE_GROWTH_RATE * growthSpeed(age) * participation;
    if (growth === 0) return player;
    return { ...player, strength: clamp(strength + growth, strength, potential) };
  }

  if (age > CONDITION_AGE_PEAK_MAX) {
    const decline = Math.min(DEVELOPMENT_DECLINE_PER_YEAR * physicalAgeDistance(age), DEVELOPMENT_MAX_DECLINE_PER_SEASON);
    if (decline === 0) return player;
    return { ...player, strength: clamp(strength - decline, 0, strength) };
  }

  return player;
}
