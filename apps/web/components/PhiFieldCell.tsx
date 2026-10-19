'use client';

import { useState } from 'react';
import { revealCasePhiField } from '@/lib/cases/phi-reveal-actions';

interface PhiFieldCellProps {
  field: 'mrn' | 'dob';
  entryId: string;
  className?: string;
  /** Prefix for the compact rendering, e.g. "MRN". */
  label?: string;
  /**
   * Called after the disclosure is recorded. An editor uses it to move the value
   * into an editable field, so a stored identifier only ever reaches a visible
   * input through the audited path.
   */
  onReveal?: (value: string) => void;
}

const PLACEHOLDER = '—';

function maskValue(field: 'mrn' | 'dob'): string {
  return field === 'mrn' ? '***-**-****' : '****-**-**';
}

const REASON_MESSAGE: Record<string, string> = {
  deidentified: 'This case is de-identified; no patient identifier is stored.',
  audit_failed: 'Could not record this access. The value stays hidden — try again.',
  not_found: 'No identifier is stored for this case.',
  unauthorized: 'You do not have access to this case.',
};

/**
 * A direct patient identifier, masked until its disclosure is audited.
 *
 * The value is not passed in and is not part of any page payload. It is fetched
 * one field at a time through `revealCasePhiField`, which records the disclosure
 * before returning, so a page that lists twenty cases ships no MRN and produces
 * no audit row until someone actually asks to see one.
 *
 * Fail closed: when the disclosure cannot be recorded the value is withheld and
 * the reason is shown, rather than the field quietly appearing.
 */
export function PhiFieldCell({ field, entryId, className, label, onReveal }: PhiFieldCellProps) {
  const [value, setValue] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reveal = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await revealCasePhiField(entryId, field);
      if (result.value === null) {
        setError(REASON_MESSAGE[result.reason ?? ''] ?? REASON_MESSAGE.not_found);
        return;
      }
      setValue(result.value);
      onReveal?.(result.value);
    } catch {
      setError('Could not load this value. Try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={className}>
      <span className="text-sm text-text-secondary tabular-nums">
        {label ? `${label}: ` : ''}
        {value ?? maskValue(field)}
      </span>{' '}
      {!value && (
        <button
          type="button"
          onClick={reveal}
          disabled={pending}
          className="text-xs text-fg-primary hover:underline disabled:opacity-60"
        >
          {pending ? 'Loading…' : 'Reveal'}
        </button>
      )}
      {error && (
        <span role="alert" className="block text-xs text-text-muted">
          {error}
        </span>
      )}
    </div>
  );
}

export { PLACEHOLDER };
