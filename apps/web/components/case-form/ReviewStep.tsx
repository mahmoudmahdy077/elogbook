'use client';

interface TemplateField {
  key?: string;
  name?: string;
  label: string;
  type: string;
  options?: string[];
  required?: boolean;
}

interface Template {
  id: string;
  specialty: string;
  name: string;
  fields: TemplateField[];
}

interface ReviewStepProps {
  template: Template | undefined;
  isDeidentified: boolean;
  patientMrn: string;
  patientDob: string;
  patientAgeYears: string;
  fieldValues: Record<string, unknown>;
  caseDate: string;
  getFieldKey: (f: TemplateField) => string;
}

export default function ReviewStep({
  template,
  isDeidentified,
  patientMrn,
  patientDob,
  patientAgeYears,
  fieldValues,
  caseDate,
  getFieldKey,
}: ReviewStepProps) {
  const fields = template?.fields || [];

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-heading)' }}>
        Review
      </h3>
      <p className="text-sm text-neutral-light/60">
        Review your entry before submitting.
      </p>

      <div className="space-y-2 divide-y divide-border">
        <div className="flex justify-between py-2">
          <span className="text-sm text-neutral-light/60">Template</span>
          <span className="text-sm font-medium">
            {template?.specialty} - {template?.name}
          </span>
        </div>
        <div className="flex justify-between py-2">
          <span className="text-sm text-neutral-light/60">De-identified</span>
          <span className="text-sm font-medium">{isDeidentified ? 'Yes' : 'No'}</span>
        </div>
        {isDeidentified ? (
          <>
            <div className="flex justify-between py-2">
              <span className="text-sm text-neutral-light/60">Patient Age</span>
              <span className="text-sm font-medium">{patientAgeYears} years</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-sm text-neutral-light/60">MRN</span>
              <span className="text-xs text-neutral-light/50">
                Hashed server-side — not stored
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-between py-2">
              <span className="text-sm text-neutral-light/60">Patient MRN</span>
              <span className="text-sm font-medium" style={{ fontFamily: 'var(--font-mono)' }}>{patientMrn || '-'}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-sm text-neutral-light/60">Patient DOB</span>
              <span className="text-sm font-medium" style={{ fontFamily: 'var(--font-mono)' }}>{patientDob || '-'}</span>
            </div>
          </>
        )}
        <div className="flex justify-between py-2">
          <span className="text-sm text-neutral-light/60">Case Date</span>
          <span className="text-sm font-medium" style={{ fontFamily: 'var(--font-mono)' }}>{caseDate || '-'}</span>
        </div>
        {Object.entries(fieldValues).length > 0 && (
          <div className="py-2">
            <span className="text-sm text-neutral-light/60 block mb-2">Template Fields</span>
            {fields.map((field) => {
              const key = getFieldKey(field);
              const value = fieldValues[key];
              let display: string;
              if (field.type === 'checkbox') {
                display = value ? 'Yes' : 'No';
              } else if (value !== undefined && value !== '') {
                display = String(value);
              } else {
                display = '-';
              }
              return (
                <div key={key} className="flex justify-between py-1">
                  <span className="text-xs text-neutral-light/50">{field.label}</span>
                  <span className="text-xs font-medium">{display}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}