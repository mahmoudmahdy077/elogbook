import { z } from 'zod';

export const REFLECTION_TYPES = [
  'clinical',
  'procedural',
  'communication',
  'teamwork',
  'ethics',
  'other',
] as const;

export type ReflectionType = (typeof REFLECTION_TYPES)[number];

export const reflectionCreateSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  reflection_type: z.enum(REFLECTION_TYPES),
  body: z
    .string()
    .min(1, 'Reflection body is required')
    .max(10000, 'Reflection body must be 10,000 characters or fewer'),
  case_id: z.string().uuid().nullable().optional(),
  prompt: z.string().max(2000).nullable().optional(),
  shared: z.boolean().default(false),
});

export const reflectionUpdateSchema = reflectionCreateSchema.partial();
