import type { CSSProperties } from 'react';

interface IconProps {
  className?: string;
  style?: CSSProperties;
}

/**
 * Marca de gol reaproveitada no feed de eventos e nas listas de artilheiros (MatchResult,
 * MatchLive, MatchHistory), pra não divergir o "ícone de gol" entre as telas.
 */
export function IconBall({ className, style }: IconProps) {
  return (
    <span className={className} style={style} aria-hidden="true">
      ⚽
    </span>
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
