/**
 * Reexport fino: o cálculo de encaixe de posição vive no motor
 * (`engine/simulation/positionFit.ts`) porque agora também alimenta a
 * simulação de partida de verdade, não só o indicador visual da Escalação —
 * o que se vê no campo é o que decide o jogo, uma fonte só.
 */
export { positionFit, effectiveOverall, type PositionFit } from '../engine/simulation/positionFit';
