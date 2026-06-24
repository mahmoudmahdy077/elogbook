'use client';

import { useState, useEffect, useRef } from 'react';

interface SimpleCounterProps {
  value: number;
  className?: string;
}

export function SimpleCounter({ value, className = '' }: SimpleCounterProps) {
  const [displayed, setDisplayed] = useState(0);
  const prevRef = useRef(0);

  useEffect(() => {
    const start = prevRef.current;
    const diff = value - start;
    const duration = 600;
    const startTime = performance.now();

    function step(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      setDisplayed(Math.round(start + diff * progress));
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
    prevRef.current = value;
  }, [value]);

  return <span className={className}>{displayed}</span>;
}