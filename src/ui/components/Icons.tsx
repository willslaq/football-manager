import type { CSSProperties } from 'react';
import bola from '../../assets/bola.png';

interface IconProps {
  className?: string;
  style?: CSSProperties;
}

/**
 * Marca de gol reaproveitada no feed de eventos e nas listas de artilheiros (MatchResult,
 * MatchLive, MatchHistory), pra não divergir o "ícone de gol" entre as telas. `.icon-ball`
 * (tamanho/alinhamento base) vem de theme.css; cada chamador ainda pode empilhar sua própria
 * classe (ex.: flex-shrink) via `className`.
 */
export function IconBall({ className, style }: IconProps) {
  return (
    <img
      src={bola}
      alt=""
      aria-hidden="true"
      className={className ? `icon-ball ${className}` : 'icon-ball'}
      style={style}
    />
  );
}

/**
 * Cartão de árbitro em miniatura, levemente inclinado (mesma linguagem visual de uma
 * transmissão) — reaproveitado no feed de eventos de partida (MatchLive/MatchResult) e no
 * painel de detalhe do Elenco, pra não divergir o "ícone de cartão" entre as telas.
 */
export function IconCard({ color, className, style }: IconProps & { color: string }) {
  return (
    <svg width="11" height="15" viewBox="0 0 12 16" aria-hidden="true" className={className} style={style}>
      <rect x="1" y="1" width="10" height="14" rx="1.6" fill={color} transform="rotate(-9 6 8)" />
    </svg>
  );
}

/**
 * Amarelo(s) pendente(s) de suspensão por acúmulo (regra CBF: 3 amarelos acumulados
 * suspendem — ver `applyCardSuspension` em season.ts). Reaproveita `IconCard`; com 2, o
 * segundo cartão fica deslocado por cima do primeiro (efeito de pilha) — a contagem é
 * sempre visual, nunca número ou texto (Escalação mostra só o ícone).
 */
export function IconCardStack({ count, className }: { count: 1 | 2; className?: string }) {
  if (count === 1) return <IconCard color="var(--floodlight)" className={className} />;
  return (
    <span className={className} style={{ position: 'relative', display: 'inline-block', width: 16, height: 15 }}>
      <IconCard color="var(--floodlight)" style={{ position: 'absolute', left: 0, top: 3 }} />
      <IconCard color="var(--floodlight)" style={{ position: 'absolute', left: 5, top: 0 }} />
    </span>
  );
}

/**
 * Par de setas de substituição (entra/sai) — reaproveitado no feed de eventos (MatchLive/MatchResult)
 * e na lista de jogadores em campo, pra não divergir o "ícone de substituição" entre as telas.
 */
export function IconSub({ className, style }: IconProps) {
  return (
    <svg width="13" height="15" viewBox="0 0 13 16" aria-hidden="true" className={className} style={style}>
      <path
        d="M3.5 1 L3.5 11 M1 8.5 L3.5 11 L6 8.5"
        stroke="var(--pitch)"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 15 L9.5 5 M7 7.5 L9.5 5 L12 7.5"
        stroke="var(--danger)"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
