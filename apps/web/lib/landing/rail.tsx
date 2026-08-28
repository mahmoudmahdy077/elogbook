'use client';

/**
 * Chain of Custody — audit rail controller.
 * Registers sections as they enter the viewport (IntersectionObserver),
 * feeds the intent engine, and mirrors progress for assistive tech.
 * IO guards against double-fire; disconnects after all sections register.
 */
import { useEffect } from 'react';
import { registerTick } from './intent';

const SECTION_ATTR = 'data-custody-section';

export function useCustodyRail(enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return;
    const sections = Array.from(document.querySelectorAll<HTMLElement>(`[${SECTION_ATTR}]`));
    if (sections.length === 0) return;

    const registered = new Set<string>();
    const total = sections.length;

    // Hero pre-endowment: first section counts as tick 1 on load.
    const first = sections[0];
    if (first && !registered.has(first.id)) {
      registered.add(first.id);
      registerTick(1, total);
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.5) continue;
          const el = entry.target as HTMLElement;
          if (registered.has(el.id)) continue;
          registered.add(el.id);
          registerTick(registered.size, total);
          el.setAttribute('data-registered', 'true');
          if (registered.size === total) io.disconnect();
        }
      },
      { threshold: 0.5 },
    );

    for (const s of sections.slice(1)) {
      io.observe(s);
      // safety: already-in-view sections fire synchronously in some browsers
      const r = s.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.5 && r.bottom > 0 && !registered.has(s.id)) {
        registered.add(s.id);
        registerTick(registered.size, total);
        s.setAttribute('data-registered', 'true');
        if (registered.size === total) io.disconnect();
      }
    }

    return () => io.disconnect();
  }, [enabled]);
}

/** SHA-256 via Web Crypto — client-side only, nothing transmitted. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Format a client timestamp as the mono artifact string used by demos/attestation. */
export function custodyTimestamp(d: Date = new Date()): string {
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
