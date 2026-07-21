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
      <h3 className="text-lg font-semibold text-text-primary tracking-[-0.02em] font-sans">
        Review
      </h3>
      <p className="text-sm text-text-muted">
        Review your entry before submitting.
      </p>

      <div className="space-y-0 divide-y divide-border bg-surface-solid rounded-2xl border border-border overflow-hidden">
        <div className="flex justify-between py-3 px-4">
          <span className="text-sm text-text-muted">Template</span>
          <span className="text-sm font-medium text-text-primary">
            {template?.specialty} — {template?.name}
          </span>
        </div>
        <div className="flex justify-between py-3 px-4">
          <span className="text-sm text-text-muted">De-identified</span>
          <span className="text-sm font-medium text-text-primary">{isDeidentified ? 'Yes' : 'No'}</span>
        </div>
        {isDeidentified ? (
          <>
            <div className="flex justify-between py-3 px-4">
              <span className="text-sm text-text-muted">Patient Age</span>
              <span className="text-sm font-medium text-text-primary">{patientAgeYears} years</span>
            </div>
            <div className="flex justify-between py-3 px-4">
              <span className="text-sm text-text-muted">MRN</span>
              <span className="text-xs text-text-muted">
                Hashed server-side — not stored
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-between py-3 px-4">
              <span className="text-sm text-text-muted">Patient MRN</span>
              <span className="text-sm font-medium text-text-primary clinical-data">{patientMrn || '-'}</span>
            </div>
            <div className="flex justify-between py-3 px-4">
              <span className="text-sm text-text-muted">Patient DOB</span>
              <span className="text-sm font-medium text-text-primary clinical-data">{patientDob || '-'}</span>
            </div>
          </>
        )}
        <div className="flex justify-between py-3 px-4">
          <span className="text-sm text-text-muted">Case Date</span>
          <span className="text-sm font-medium text-text-primary clinical-data">{caseDate || '-'}</span>
        </div>
        {Object.entries(fieldValues).length > 0 && (
          <div className="py-3 px-4">
            <span className="text-sm text-text-muted block mb-2">Template Fields</span>
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
                  <span className="text-xs text-text-muted">{field.label}</span>
                  <span className="text-xs font-medium text-text-primary">{display}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
