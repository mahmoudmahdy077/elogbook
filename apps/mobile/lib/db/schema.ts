import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'case_entries',
      columns: [
        { name: 'tenant_id', type: 'string' },
        { name: 'resident_id', type: 'string' },
        { name: 'template_id', type: 'string' },
        { name: 'patient_mrn', type: 'string', isOptional: true },
        { name: 'patient_dob', type: 'string', isOptional: true },
        { name: 'patient_age_years', type: 'number', isOptional: true },
        { name: 'patient_hash', type: 'string', isOptional: true },
        { name: 'case_date', type: 'string' },
        { name: 'field_values', type: 'string' },
        { name: 'accreditation_mappings', type: 'string' },
        { name: 'is_deidentified', type: 'boolean' },
        { name: 'status', type: 'string' },
        { name: 'local_sync_status', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'case_templates',
      columns: [
        { name: 'tenant_id', type: 'string' },
        { name: 'specialty', type: 'string' },
        { name: 'name', type: 'string' },
        { name: 'fields', type: 'string' },
        { name: 'required_fields', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
  ],
});
