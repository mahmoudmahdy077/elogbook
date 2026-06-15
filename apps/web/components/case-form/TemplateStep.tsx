'use client';

import { Select, ListBox, ListBoxItem } from '@heroui/react';
import HelpPopover from '@/components/HelpPopover';

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
  tenant_id: string;
  specialty: string;
  name: string;
  fields: TemplateField[];
  required_fields: string[];
}

interface TemplateStepProps {
  templates: Template[];
  selectedTemplateId: string;
  onSelect: (id: string) => void;
  fieldCount: number;
}

export default function TemplateStep({
  templates,
  selectedTemplateId,
  onSelect,
  fieldCount,
}: TemplateStepProps) {
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold" style={{ fontFamily: 'var(--font-heading)' }}>
          Select Case Template
        </h3>
        <HelpPopover>
          <p className="mb-2">
            <strong>Templates</strong> define the fields you need to fill out for a particular type of clinical case.
          </p>
          <p className="mb-2">
            Templates are organized by <strong>specialty</strong> and <strong>case type</strong> — for example, a &ldquo;General Surgery &mdash; Laparoscopic Cholecystectomy&rdquo; template includes fields for operative findings, drain placement, and estimated blood loss.
          </p>
          <p>
            Your program director sets up templates that match your accreditation framework. If you&apos;re unsure which template to use, ask your supervisor.
          </p>
        </HelpPopover>
      </div>
      <p className="text-sm text-neutral-light/60">
        Choose a template for your logbook entry. This determines the required fields for
        documentation.
      </p>
      <Select
        selectedKey={selectedTemplateId || null}
        onSelectionChange={(key) => {
          onSelect(key ? String(key) : '');
        }}
        isRequired
      >
        <Select.Trigger aria-label="Select template">
          <Select.Value />
        </Select.Trigger>
        <Select.Popover>
          <ListBox aria-label="Select a template">
            {templates.map((t) => (
              <ListBoxItem key={t.id} id={t.id}>
                {t.specialty} - {t.name}
              </ListBoxItem>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
      {selectedTemplate && (
        <div className="text-sm text-neutral-light/60">
          {fieldCount} field{fieldCount !== 1 ? 's' : ''} in this template
        </div>
      )}
    </div>
  );
}