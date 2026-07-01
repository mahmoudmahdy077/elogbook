'use client';

import ImpactDialog from '@/components/ImpactDialog';

interface Template {
  specialty: string;
  name: string;
}

interface ConfirmDialogProps {
  isOpen: boolean;
  isDeidentified: boolean;
  caseDate: string;
  template: Template | undefined;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog(props: ConfirmDialogProps) {
  const { isOpen, loading, onConfirm, onCancel } = props;
  return (
    <ImpactDialog
      isOpen={isOpen}
      title="Confirm Submission"
      message="You are about to submit this case entry. Please verify the information below is correct."
      impact={(() => {
        const templateStr = props.template
          ? `Template: ${props.template.specialty} — ${props.template.name}`
          : '';
        const mode = props.isDeidentified ? 'De-identified' : 'PII';
        const date = props.caseDate || '-';
        return `${templateStr} | Mode: ${mode} | Date: ${date}`;
      })()}
      severity="info"
      confirmLabel="Confirm & Submit"
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
