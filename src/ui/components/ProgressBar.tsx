import './ProgressBar.css';

export function ProgressBar({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="progress">
      <div
        className="progress__track"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <div className="progress__fill" style={{ transform: `scaleX(${pct / 100})` }} />
      </div>
      {label && <span className="progress__label numeric">{label}</span>}
    </div>
  );
}
