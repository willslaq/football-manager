interface IconProps {
  className?: string;
}

/**
 * Marca de gol reaproveitada no feed de eventos e nas listas de artilheiros (MatchResult,
 * MatchLive, MatchHistory), pra não divergir o "ícone de gol" entre as telas.
 */
export function IconBall({ className }: IconProps) {
  return (
    <span className={className} aria-hidden="true">
      ⚽
    </span>
  );
}

/**
 * Cartão de árbitro em miniatura, levemente inclinado (mesma linguagem visual de uma
 * transmissão) — reaproveitado no feed de eventos de partida (MatchLive/MatchResult) e no
 * painel de detalhe do Elenco, pra não divergir o "ícone de cartão" entre as telas.
 */
export function IconCard({ color, className }: IconProps & { color: string }) {
  return (
    <svg width="11" height="15" viewBox="0 0 12 16" aria-hidden="true" className={className}>
      <rect x="1" y="1" width="10" height="14" rx="1.6" fill={color} transform="rotate(-9 6 8)" />
    </svg>
  );
}
