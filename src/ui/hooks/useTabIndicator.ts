import { useLayoutEffect, useRef, useState } from 'react';

export interface TabIndicatorRect {
  left: number;
  right: number;
}

/**
 * Pixel offsets of the currently active item inside a shared track,
 * re-measured whenever the active key or the track's size changes. Feeds
 * the `--fm-indicator-left`/`--fm-indicator-right` clip-path variables used
 * by the sliding tab indicators (see AppShell's tab bar for the CSS side).
 */
export function useTabIndicator<K extends string | number>(activeKey: K) {
  const trackRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<Partial<Record<K, HTMLElement | null>>>({});
  const [indicator, setIndicator] = useState<TabIndicatorRect | null>(null);

  useLayoutEffect(() => {
    const track = trackRef.current;
    const activeEl = itemRefs.current[activeKey];
    if (!track || !activeEl) return;

    const measure = () => {
      const trackRect = track.getBoundingClientRect();
      const itemRect = activeEl.getBoundingClientRect();
      setIndicator({
        left: itemRect.left - trackRect.left,
        right: trackRect.right - itemRect.right,
      });
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [activeKey]);

  const registerItem = (key: K) => (el: HTMLElement | null) => {
    itemRefs.current[key] = el;
  };

  return { trackRef, registerItem, indicator };
}
