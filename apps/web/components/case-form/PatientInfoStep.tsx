'use client';

import { Switch, TextField, Label, Input } from '@heroui/react';
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
        <h3 className="text-lg font-semibold font-heading">
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

      <div className="flex items-center gap-3 p-3 rounded-lg bg-neutral-dark/50 border border-border">
        <Switch isSelected={isDeidentified} onChange={onIsDeidentifiedChange}>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Switch.Content>
            <span className="text-sm font-medium ml-3">De-identify Patient Data</span>
          </Switch.Content>
        </Switch>
      </div>

      {isDeidentified ? (
        <>
          <div className="flex items-center gap-3 mb-3">
            <span className="badge-approved text-xs px-2.5 py-1 rounded-full">Safe Harbor Compliant</span>
            <span className="text-xs text-approved">No PHI stored</span>
          </div>
          <div className="warning-banner text-xs rounded-lg p-2.5">
            De-identified mode: safe for portfolio logging. No PHI is stored. Patient hash will be computed server-side.
          </div>
          <TextField value={patientMrn} onChange={onMrnChange}>
            <Label>Patient MRN (for reference only — not stored)</Label>
            <Input placeholder="Enter MRN for local hashing" aria-label="Patient MRN reference" />
          </TextField>
          <TextField
            type="number"
            value={patientAgeYears}
            onChange={onAgeChange}
            isRequired
          >
            <Label>Patient Age (years)</Label>
            <Input placeholder="0-150" aria-label="Patient age in years" />
          </TextField>
        </>
      ) : (
        <>
          <div className="danger-banner text-xs rounded-lg p-2.5">
            PII mode: patient MRN and Date of Birth will be stored on the server. Only use this for hospital record-keeping. Ensure compliance with your institution&apos;s data protection policies before submitting.
          </div>
          <TextField
            value={patientMrn}
            onChange={onMrnChange}
            isRequired
          >
            <Label>Patient MRN</Label>
            <Input aria-label="Patient MRN" />
          </TextField>
          <TextField
            type="date"
            value={patientDob}
            onChange={onDobChange}
            isRequired
          >
            <Label>Patient DOB</Label>
            <Input aria-label="Patient date of birth" />
          </TextField>
        </>
      )}
    </div>
  );
}