import type { HTMLAttributes } from 'react';
import './Badge.css';

type Tone = 'neutral' | 'pitch' | 'floodlight';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  const classes = ['badge', tone !== 'neutral' && `badge--${tone}`, className].filter(Boolean).join(' ');
  return <span className={classes} {...props} />;
}
