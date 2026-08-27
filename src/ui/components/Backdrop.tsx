import type { ReactNode } from 'react';
import './Backdrop.css';

/** Casca de página reutilizável: glow de refletor + textura de gramado + coluna central. */
export function Backdrop({ children }: { children: ReactNode }) {
  return (
    <div className="backdrop">
      <div className="backdrop__container">{children}</div>
    </div>
  );
}
