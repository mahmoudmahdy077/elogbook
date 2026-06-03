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
