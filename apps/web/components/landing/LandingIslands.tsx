'use client';

/**
 * Landing client islands — Chain of Custody v2.
 * Each island is small, framer-motion-free where possible (CSS-first per
 * cycle8 QA), and honest: digits never scramble; states fade in place.
 * Motion tokens come from globals.css (:root custom properties).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getIntent,
  markAccepted,
  markDemoApproved,
  markHashTyped,
  markHeroSeen,
  markOffered,
  markRole,
  markVaultExpanded,
  scoreIntent,
  summarize,
  entryPayload,
  wasOffered,
  type Role,
} from '@/lib/landing/intent-v2';

const DRAWER = 'cubic-bezier(0.32, 0.72, 0, 1)';

/* ---------------- Hero: hash lab (Web Crypto, nothing transmitted) --------------- */

function shortSha(input: string): string {
  // Deterministic non-crypto fallback for SSR/no-JS example rendering only.
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < input.length; i += 1) {
    h1 = (h1 ^ input.charCodeAt(i)) * 0x01000193;
    h2 = (h2 + input.charCodeAt(i) * (i + 7)) >>> 0;
  }
  const part = () => Math.abs(h2 ^ h1).toString(16).padStart(8, '0');
  return `${part()}…${part().slice(0, 4)}`;
}

export function HashLab() {
  const [digest, setDigest] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    markHeroSeen();
    setReady(true);
  }, []);

  const onChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.trim();
    if (!value) {
      setDigest(null);
      return;
    }
    if (value.length >= 12) markHashTyped();
    try {
      const data = new TextEncoder().encode(value);
      const buf = await crypto.subtle.digest('SHA-256', data);
      const hex = Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      setDigest(`${hex.slice(0, 8)}…${hex.slice(-6)}`);
    } catch {
      setDigest(shortSha(value));
    }
  }, []);

  return (
    <div className="rounded-14 border border-border bg-surface-solid p-4" data-testid="hash-lab">
      <label htmlFor="hashlab-mrn" className="text-xs font-medium text-text-muted">
        Hospital MRN — hashed locally
      </label>
      <input
        id="hashlab-mrn"
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder="e.g. 00-84-62"
        onChange={onChange}
        className="mt-2 w-full rounded-8 border border-border bg-backdrop px-3 py-2 font-mono text-sm text-text-primary placeholder:text-default-400 focus:border-primary-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-describedby="hashlab-out-label"
      />
      <p id="hashlab-out-label" className="sr-only">SHA-256 digest output</p>
      <output
        htmlFor="hashlab-mrn"
        aria-live="polite"
        data-testid="hash-output"
        className="mt-2 block font-mono text-sm tabular-nums transition-opacity duration-150"
        style={{ opacity: digest ? 1 : 0.45 }}
      >
        {digest ?? 'a3f9c21d…8e21b'}
      </output>
      <p className="mt-1 text-xs text-text-muted">Computed in your browser. Nothing is sent.</p>
      <a
        href="/signup?role=resident"
        data-testid="hashlab-cta"
        className="mt-3 inline-flex min-h-[44px] items-center rounded-8 bg-primary px-4 text-sm font-medium text-text-on-primary transition-transform active:scale-[0.97] hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        style={{ opacity: ready && digest ? 1 : 0.4, pointerEvents: digest ? undefined : 'none' }}
      >
        Start logging free
      </a>
    </div>
  );
}

/* ---------------- Demo: two-click custody review ---------------------------------- */

interface DemoCase {
  id: string;
  title: string;
  meta: string;
}

const DEMO_CASES: DemoCase[] = [
  { id: 'd1', title: 'Central line insertion', meta: 'SAMPLE · supervised case' },
  { id: 'd2', title: 'Lumbar puncture', meta: 'SAMPLE · supervised case' },
];

export function CustodyDemo() {
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [artifact, setArtifact] = useState<string | null>(null);
  const stamps = useRef<string[]>([]);

  const approve = useCallback(async (id: string) => {
    if (approved[id]) return;
    stamps.current.push(new Date().toISOString());
    markDemoApproved(stamps.current.length as 1 | 2);
    setApproved((prev) => ({ ...prev, [id]: true }));
    if (stamps.current.length === 2) {
      try {
        const data = new TextEncoder().encode(stamps.current.join('|'));
        const buf = await crypto.subtle.digest('SHA-256', data);
        const hex = Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        setArtifact(`${hex.slice(0, 16)}…${hex.slice(-8)}`);
      } catch {
        setArtifact(shortSha(stamps.current.join('|')));
      }
    }
  }, [approved]);

  return (
    <div data-testid="custody-demo">
      <ul className="mx-auto max-w-[520px] space-y-3">
        {DEMO_CASES.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-4 rounded-14 border border-border bg-surface px-4 py-3 transition-colors duration-200 hover:border-border-active">
            <div>
              <p className="text-sm font-medium text-text-primary">{c.title}</p>
              <p className="font-mono text-xs uppercase tracking-wide text-text-muted">{c.meta}</p>
            </div>
            <button
              type="button"
              onClick={() => approve(c.id)}
              disabled={!!approved[c.id]}
              data-testid={`approve-${c.id}`}
              className={`min-h-[44px] min-w-[96px] rounded-8 border px-3 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                approved[c.id]
                  ? 'border-approved/40 bg-success-50 text-success-700'
                  : 'border-border-active bg-surface-solid text-text-secondary hover:border-primary-glow'
              }`}
              style={approved[c.id] ? { opacity: 1 } : { opacity: 1 }}
            >
              <span className={approved[c.id] ? 'transition-opacity duration-200' : ''}>
                {approved[c.id] ? 'Approved ✓' : 'Approve'}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div
        data-testid="demo-artifact"
        aria-live="polite"
        className="mx-auto mt-4 max-w-[520px] overflow-hidden rounded-14 border border-border bg-surface-solid transition-all duration-[420ms]"
        style={{
          maxHeight: artifact ? '160px' : '0px',
          opacity: artifact ? 1 : 0,
          transitionTimingFunction: DRAWER,
        }}
      >
        {artifact && (
          <div className="p-4">
            <p className="text-sm font-medium text-text-primary">That took two clicks.</p>
            <p className="mt-1 text-xs text-text-muted">Audit excerpt — generated in your browser, from your clicks.</p>
            <p className="mt-2 break-all font-mono text-xs tabular-nums text-text-secondary">sha256 {artifact}</p>
            <a href="/signup" className="mt-2 inline-block text-sm font-medium text-primary underline-offset-2 hover:underline">
              Create your first logbook →
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Vault rows ------------------------------------------------------------------ */

const VAULT_ROWS: Array<{ dt: string; dd: string }> = [
  { dt: 'De-identification', dd: 'Patient identifiers hash to SHA-256 before storage. Fail-closed by design.' },
  { dt: 'Offline at rest', dd: 'AES-256-CBC encrypted local store; conflict-safe sync when signal returns.' },
  { dt: 'Immutable audit trail', dd: 'Every approval chains a SHA-256 record. Nothing edits history.' },
  { dt: 'Access control', dd: 'Five roles, least privilege, MFA on every sensitive action.' },
  { dt: 'Abuse resistance', dd: 'Rate-limited endpoints and CSP-hardened headers out of the box.' },
  { dt: 'PHI hygiene', dd: 'Screenshot blocking on mobile; exports carry only what frameworks require.' },
];

export function TrustVault() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <dl data-testid="trust-vault" className="mx-auto max-w-[720px] divide-y divide-divider border-y border-divider">
      {VAULT_ROWS.map((row, i) => (
        <div key={row.dt}>
          <dt>
            <button
              type="button"
              onClick={() => {
                setOpen(open === i ? null : i);
                if (open !== i) markVaultExpanded();
              }}
              aria-expanded={open === i}
              className="flex min-h-[56px] w-full items-center justify-between px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="font-mono text-sm font-medium text-text-primary">{row.dt}</span>
              <span aria-hidden className="text-text-muted">{open === i ? '−' : '+'}</span>
            </button>
          </dt>
          <dd
            className="grid transition-[grid-template-rows,opacity] duration-[240ms]"
            style={{ gridTemplateRows: open === i ? '1fr' : '0fr', opacity: open === i ? 1 : 0, transitionTimingFunction: 'var(--ease-inout, cubic-bezier(0.77, 0, 0.175, 1))' }}
          >
            <span className="overflow-hidden">
              <span className="block px-2 pb-4 text-sm leading-relaxed text-text-secondary">{row.dd}</span>
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------------- Capture sheet ("Your session logbook entry") ------------------ */

export function SessionLogbookEntry({ sampleExportPath }: { sampleExportPath?: string }) {
  const [visible, setVisible] = useState(false);
  const [sent, setSent] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [role] = useState<Role>('resident'); // payload role; radio value is read from the form on submit
  const emailRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const maybeOffer = useCallback(() => {
    const s = getIntent();
    if (s.offeredThisSession || s.acceptedThisSession) return;
    if (scoreIntent(s) >= 4) fire();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fire = useCallback(() => {
    if (wasOffered()) return;
    markOffered();
    setVisible(true);
  }, []);

  useEffect(() => {
    const onIntent = (e: Event) => {
      const detail = (e as CustomEvent).detail as { score: number };
      // Contract Ruling 2: score alone NEVER triggers an offer — Act 4 must be
      // on screen (or exit-intent/keyboard lane fires instead).
      if (detail?.score >= 6) {
        const choose = document.getElementById('choose');
        if (!choose) return;
        const r = choose.getBoundingClientRect();
        if (r.top < window.innerHeight * 0.8) maybeOffer();
      }
    };
    window.addEventListener('elog:intent', onIntent);

    // Exit-intent lane (desktop): mouseout above viewport top.
    const onMouseOut = (e: MouseEvent) => {
      if (e.relatedTarget === null && e.clientY <= 0) maybeOffer();
    };
    document.addEventListener('mouseout', onMouseOut);

    // Keyboard-equivalent trigger so the offer is never pointer-only (cycle 8 gate).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '.' && e.shiftKey && scoreIntent(getIntent()) >= 4) fire();
    };
    document.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('elog:intent', onIntent);
      document.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('keydown', onKey);
    };
  }, [maybeOffer, fire]);

  useEffect(() => {
    if (!visible) return;
    emailRef.current?.focus();
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onEsc);
    // rudimentary focus trap
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !sheetRef.current) return;
      const focusables = sheetRef.current.querySelectorAll<HTMLElement>('button, input, a[href]');
      const list = Array.from(focusables).filter((el) => !el.hasAttribute('disabled'));
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.removeEventListener('keydown', onEsc);
      document.removeEventListener('keydown', trap);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const close = useCallback(() => {
    setVisible(false);
    triggerRef.current?.focus();
  }, []);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const form = new FormData(e.target as HTMLFormElement);
      const email = String(form.get('email') ?? '').trim();
      const chosenRole = (form.get('role') as Role) || role;
      markRole(chosenRole);
      setSent('sending');
      setErrMsg(null);
      try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: chosenRole === 'director' ? 'Session entry (director)' : 'Session entry (resident)',
            email,
            message: entryPayload(chosenRole),
          }),
        });
        if (res.status === 429) {
          setSent('err');
          setErrMsg('Too many attempts. Try again in a minute.');
          return;
        }
        if (!res.ok) {
          setSent('err');
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setErrMsg(body?.error === 'Invalid email address' ? 'Check the email format.' : 'Could not save. Your entry stays here — retry.');
          return;
        }
        markAccepted();
        setSent('ok');
      } catch {
        setSent('err');
        setErrMsg('Could not save. Your entry stays here — retry.');
      }
    },
    [role],
  );

  const lines = summarize(getIntent());

  return (
    <>
      {/* Keyboard-reachable equivalent trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setVisible(true)}
        className="sr-only focus:not-sr-only focus:absolute focus:bottom-4 focus:right-4 focus:z-50 focus:min-h-[44px] focus:rounded-8 focus:border focus:border-border focus:bg-surface-solid focus:px-3 focus:text-sm focus:text-primary"
      >
        Your session logbook entry
      </button>

      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sle-title"
        data-testid="capture-sheet"
        hidden={!visible}
        className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md p-4 sm:bottom-6 sm:p-0"
      >
        <div
          className="rounded-14 border border-border bg-surface-solid p-5 backdrop-blur"
          style={
            visible
              ? { transform: 'translateY(0)', opacity: 1, transition: `transform 420ms ${DRAWER}, opacity 180ms var(--ease-out)` }
              : { transform: 'translateY(100%)', opacity: 0 }
          }
        >
          <h2 id="sle-title" className="text-base font-semibold text-text-primary">Your session logbook entry</h2>
          <p className="mt-1 text-sm text-text-secondary">This page noted what you tried. Here is the record.</p>
          {lines.length > 0 && (
            <ul className="mt-3 space-y-1" data-testid="entry-lines">
              {lines.map((l) => (
                <li key={l} className="font-mono text-xs text-text-secondary">· {l}</li>
              ))}
            </ul>
          )}
          {sent !== 'ok' ? (
            <form onSubmit={submit} className="mt-4 space-y-3">
              <fieldset className="flex gap-2" role="radiogroup" aria-label="I am a">
                <label className="cursor-pointer">
                  <input type="radio" name="role" value="resident" defaultChecked className="peer sr-only" />
                  <span className="inline-flex min-h-[36px] items-center rounded-8 border border-border px-3 text-sm text-text-secondary peer-checked:border-primary peer-checked:text-primary">Resident</span>
                </label>
                <label className="cursor-pointer">
                  <input type="radio" name="role" value="director" className="peer sr-only" />
                  <span className="inline-flex min-h-[36px] items-center rounded-8 border border-border px-3 text-sm text-text-secondary peer-checked:border-primary peer-checked:text-primary">Director</span>
                </label>
              </fieldset>
              <label className="block text-sm">
                <span className="mb-1 block text-text-secondary">Work email</span>
                <input
                  ref={emailRef}
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  className="w-full rounded-8 border border-border bg-backdrop px-3 py-2 text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </label>
              <p className="text-xs text-text-muted">Send my entry and one sample export. No marketing. Unsubscribe anytime.</p>
              {errMsg && (
                <p role="alert" className="text-xs text-danger-600" data-testid="sle-error">
                  {errMsg}
                </p>
              )}
              <div className="flex items-center justify-between gap-3">
                <button type="submit" disabled={sent === 'sending'} className="min-h-[44px] flex-1 rounded-8 bg-primary px-4 text-sm font-medium text-text-on-primary transition-transform active:scale-[0.97] hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60">
                  {sent === 'sending' ? 'Sending…' : 'Send my entry'}
                </button>
                <button type="button" onClick={close} className="min-h-[44px] px-3 text-sm text-text-muted underline-offset-2 hover:underline">
                  Not now
                </button>
              </div>
            </form>
          ) : (
            <div className="mt-4" data-testid="sle-success">
              <p className="text-sm font-medium text-success-700">Saved. Your sample export is unlocked below.</p>
              {sampleExportPath && (
                <a href={sampleExportPath} download className="mt-2 inline-block min-h-[44px] rounded-8 border border-border px-4 text-sm leading-[42px] text-text-secondary hover:border-border-active">
                  Download sample export
                </a>
              )}
              <a href={`/signup?role=${role}`} className="mt-2 block text-sm font-medium text-primary underline-offset-2 hover:underline">
                Continue to signup →
              </a>
              <button type="button" onClick={close} className="mt-2 text-xs text-text-muted underline-offset-2 hover:underline">
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
