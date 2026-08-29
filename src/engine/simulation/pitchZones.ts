import type { Position } from '../types/player';

/**
 * Ponto no campo, no mesmo sistema de coordenadas de `POSITION_COORD`
 * (positionFit.ts): `line` vai do gol (0) ao ataque (5), `side` da
 * esquerda (-1) ao direito (+1).
 */
export interface FieldCoord {
  line: number;
  side: number;
}

/** Região retangular do campo que uma posição normalmente ocupa. */
export interface PositionZone {
  line: [number, number];
  side: [number, number];
}

/**
 * "Área de calor" de cada posição — usada só pra layout/leitura visual do
 * campo (onde renderizar cada vaga, e a que posição um ponto do campo
 * corresponde). Distinto de `POSITION_COORD` (positionFit.ts), que mede
 * similaridade entre posições pra encaixe/força efetiva — os dois
 * compartilham o mesmo sistema de coordenadas mas respondem perguntas
 * diferentes, por isso ficam em arquivos/tabelas separadas.
 */
export const POSITION_ZONES: Record<Position, PositionZone> = {
  GOL: { line: [0, 0.6], side: [-1, 1] },
  ZAG: { line: [0.6, 1.6], side: [-0.55, 0.55] },
  LD: { line: [0.9, 2.0], side: [0.5, 1] },
  LE: { line: [0.9, 2.0], side: [-1, -0.5] },
  ALD: { line: [1.3, 2.6], side: [0.5, 1] },
  ALE: { line: [1.3, 2.6], side: [-1, -0.5] },
  VOL: { line: [1.7, 2.6], side: [-0.55, 0.55] },
  MC: { line: [2.4, 3.6], side: [-0.6, 0.6] },
  MD: { line: [2.7, 3.8], side: [0.5, 1] },
  ME: { line: [2.7, 3.8], side: [-1, -0.5] },
  MEA: { line: [3.4, 4.4], side: [-0.55, 0.55] },
  PD: { line: [4.0, 5.0], side: [0.5, 1] },
  PE: { line: [4.0, 5.0], side: [-1, -0.5] },
  SA: { line: [3.6, 4.3], side: [-0.5, 0.5] },
  CA: { line: [4.5, 5.0], side: [-0.35, 0.35] },
};

function zoneCenter(zone: PositionZone): FieldCoord {
  return { line: (zone.line[0] + zone.line[1]) / 2, side: (zone.side[0] + zone.side[1]) / 2 };
}

function containsCoord(zone: PositionZone, coord: FieldCoord): boolean {
  return (
    coord.line >= zone.line[0] && coord.line <= zone.line[1] && coord.side >= zone.side[0] && coord.side <= zone.side[1]
  );
}

/**
 * Distância até o CENTRO DA PRÓPRIA ZONA de `position` (não o
 * `POSITION_COORD` de positionFit.ts — tabelas com propósitos diferentes,
 * ver comentário de `POSITION_ZONES`). Usar a âncora da própria zona
 * garante que um ponto colocado exatamente no centro de uma zona sempre
 * resolve pra ela mesma (distância zero, mínimo possível), mesmo quando
 * outra zona vizinha também contém o ponto.
 */
function distanceToAnchor(position: Position, coord: FieldCoord): number {
  const anchor = zoneCenter(POSITION_ZONES[position]);
  return Math.hypot(anchor.line - coord.line, anchor.side - coord.side);
}

/**
 * Ponto central da zona de uma posição — usado pra posicionar vagas de
 * formações pré-definidas no campo.
 */
export function zoneAnchor(position: Position): FieldCoord {
  return zoneCenter(POSITION_ZONES[position]);
}

/**
 * Ponto de uma vaga cuja posição canônica se repete no mesmo setor da
 * formação (ex.: os dois ZAG de uma defesa de 4, ou os dois MC de um
 * 4-3-3): mesma profundidade (linha) da âncora da zona, espalhados pela
 * largura da zona (`side`) pra não ficarem sobrepostos. Com uma vaga só
 * daquela posição no setor, cai na própria âncora.
 */
export function coordForRole(position: Position, indexAmongSame: number, countAmongSame: number): FieldCoord {
  const zone = POSITION_ZONES[position];
  const line = (zone.line[0] + zone.line[1]) / 2;
  if (countAmongSame <= 1) return { line, side: (zone.side[0] + zone.side[1]) / 2 };

  const margin = (zone.side[1] - zone.side[0]) * 0.15;
  const from = zone.side[0] + margin;
  const to = zone.side[1] - margin;
  const t = indexAmongSame / (countAmongSame - 1);
  return { line, side: from + (to - from) * t };
}

/**
 * A posição cuja zona melhor representa este ponto do campo — a busca do
 * "radar": dado onde a ficha do jogador está, qual função ela está
 * exercendo. Entre as zonas que contêm o ponto, desempata pela de centro
 * mais próximo; se nenhuma zona contém o ponto (vãos entre zonas), cai pra
 * posição com centro de zona mais próximo — todo ponto do campo sempre
 * resolve pra alguma posição.
 */
export function positionAtCoord(coord: FieldCoord): Position {
  const positions = Object.keys(POSITION_ZONES) as Position[];
  const containing = positions.filter((p) => containsCoord(POSITION_ZONES[p], coord));
  const candidates = containing.length > 0 ? containing : positions;

  let best = candidates[0];
  let bestDistance = distanceToAnchor(best, coord);
  for (const position of candidates.slice(1)) {
    const distance = distanceToAnchor(position, coord);
    if (distance < bestDistance) {
      best = position;
      bestDistance = distance;
    }
  }
  return best;
}
