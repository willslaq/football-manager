import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes } from 'react';
import './Card.css';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  accentColor?: string;
}

export function Card({ accentColor, className, style, ...props }: CardProps) {
  const classes = ['card', accentColor && 'card--accent', className].filter(Boolean).join(' ');
  return (
    <div
      className={classes}
      style={{ ...(accentColor ? { '--accent-color': accentColor } : {}), ...style } as CSSProperties}
      {...props}
    />
  );
}

interface CardButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  accentColor?: string;
}

/** Mesma superfície do Card, porém como botão clicável inteiro (ex.: escolher um save ou um clube). */
export function CardButton({ accentColor, className, style, ...props }: CardButtonProps) {
  const classes = ['card', 'card--interactive', accentColor && 'card--accent', className].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={classes}
      style={{ ...(accentColor ? { '--accent-color': accentColor } : {}), ...style } as CSSProperties}
      {...props}
    />
  );
}
