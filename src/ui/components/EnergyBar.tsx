import './EnergyBar.css';

function energyTier(value: number): 'high' | 'mid' | 'low' {
  if (value >= 70) return 'high';
  if (value >= 40) return 'mid';
  return 'low';
}

/**
 * Barrinha compacta de energia em partida (0-100, ver `matchEnergy` em match.ts) — reaproveitada
 * na lista de titulares em campo (OnPitchList) e no diálogo de substituição, pra ajudar a decidir
 * quem está cansado. Muda de cor por faixa (verde/âmbar/vermelho) em vez de gradiente fixo, já que
 * aqui o valor importa mais que a estética.
 */
export function EnergyBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <span
      className={`energy-bar${className ? ` ${className}` : ''}`}
      title={`Energia em partida: ${Math.round(pct)}%`}
    >
      <span className={`energy-bar__track energy-bar__track--${energyTier(pct)}`}>
        <span className="energy-bar__fill" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}
