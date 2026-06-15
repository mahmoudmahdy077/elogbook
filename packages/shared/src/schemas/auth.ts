import { z } from 'zod';

export const profileSchema = z.object({
  full_name: z.string().min(1).max(100),
  specialty: z.string().max(100).nullable().optional(),
});

export const inviteUserSchema = z.object({
  email: z.string().email(),
  role: z.enum(['resident', 'supervisor', 'director', 'institution_admin', 'admin']),
  full_name: z.string().min(1),
  specialty: z.string().optional(),
});

export const complianceConfigSchema = z.object({
  region: z.enum(['us-east-1', 'eu-west-1', 'me-central-1', 'ap-southeast-1']),
  data_retention_days: z.number().int().min(365).max(3650),
  consent_required: z.boolean(),
  compliance_frameworks: z.array(
    z.enum(['hipaa', 'gdpr', 'scfhs', 'gmc', 'pipeda', 'australian_privacy'])
  ),
});
