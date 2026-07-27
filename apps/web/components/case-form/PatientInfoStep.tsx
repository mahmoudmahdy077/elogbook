'use client';

import HelpPopover from '@/components/HelpPopover';

interface PatientInfoStepProps {
  isDeidentified: boolean;
  patientMrn: string;
  patientDob: string;
  patientAgeYears: string;
  onIsDeidentifiedChange: (value: boolean) => void;
  onMrnChange: (value: string) => void;
  onDobChange: (value: string) => void;
  onAgeChange: (value: string) => void;
}

/* Apple-style toggle switch */
function Toggle({ checked, onChange, label: _label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        checked ? 'bg-primary' : 'bg-black/15'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-surface-solid shadow-sm transition-transform duration-200 ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

/* Apple-style input field */
function FormField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required,
  ariaLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-text-primary">
        {label}
        {required && <span className="text-danger ml-0.5">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        aria-label={ariaLabel || label}
        className="w-full rounded-xl border border-border bg-surface-solid px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted transition-colors duration-200 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
      />
    </div>
  );
}

export default function PatientInfoStep({
  isDeidentified,
  patientMrn,
  patientDob,
  patientAgeYears,
  onIsDeidentifiedChange,
  onMrnChange,
  onDobChange,
  onAgeChange,
}: PatientInfoStepProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold text-text-primary tracking-[-0.02em] font-sans">
          Patient Information
        </h3>
        <HelpPopover>
          <p className="mb-2">
            <strong>De-identified mode</strong> keeps your case suitable for portfolio logging, research, and accreditation tracking. No protected health information (PHI) is stored — only age and an encoded reference number.
          </p>
          <p>
            <strong>PII mode</strong> stores full patient identifiers for hospital record-keeping. Use this only when your institution requires it, and ensure you comply with data protection policies.
          </p>
        </HelpPopover>
      </div>

      <div className="flex items-center gap-3 p-4 rounded-2xl bg-black/[0.03] border border-border">
        <Toggle
          checked={isDeidentified}
          onChange={onIsDeidentifiedChange}
          label="De-identify Patient Data"
        />
        <span className="text-sm font-medium text-text-primary">
          De-identify Patient Data
        </span>
      </div>

      {isDeidentified ? (
        <>
          <div className="flex items-center gap-3 mb-3">
            <span className="badge-approved text-xs px-2.5 py-1 rounded-full">Safe Harbor Compliant</span>
            <span className="text-xs text-approved font-medium">No PHI stored</span>
          </div>
          <div className="warning-banner text-xs rounded-xl p-3">
            De-identified mode: safe for portfolio logging. No PHI is stored. Patient hash will be computed server-side.
          </div>
          <FormField
            label="Patient MRN (for reference only — not stored)"
            value={patientMrn}
            onChange={onMrnChange}
            placeholder="Enter MRN for local hashing"
            ariaLabel="Patient MRN reference"
          />
          <FormField
            label="Patient Age (years)"
            value={patientAgeYears}
            onChange={onAgeChange}
            type="number"
            placeholder="0-150"
            required
            ariaLabel="Patient age in years"
          />
        </>
      ) : (
        <>
          <div className="danger-banner text-xs rounded-xl p-3">
            PII mode: patient MRN and Date of Birth will be stored on the server. Only use this for hospital record-keeping. Ensure compliance with your institution&apos;s data protection policies before submitting.
          </div>
          <FormField
            label="Patient MRN"
            value={patientMrn}
            onChange={onMrnChange}
            required
            ariaLabel="Patient MRN"
          />
          <FormField
            label="Patient DOB"
            value={patientDob}
            onChange={onDobChange}
            type="date"
            required
            ariaLabel="Patient date of birth"
          />
        </>
      )}
    </div>
  );
}
