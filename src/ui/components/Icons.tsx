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
