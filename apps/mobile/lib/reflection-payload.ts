/**
 * Reflections payload helpers (P0-2 mobile follow-up).
 *
 * Pure logic behind the mobile reflections screen — mirrors the web
 * ReflectionsJournal data model: structured reflective-practice entries
 * (title, ACGME-style category, body) with an author opt-in `shared` flag
 * that exposes the entry to program leadership.
 */

import { REFLECTION_TYPES, type ReflectionType } from '@elogbook/shared';

export type { ReflectionType };

/** DB-valid types ordered for the chip row. */
export const REFLECTION_CHIP_OPTIONS: { key: ReflectionType; label: string }[] = [
  { key: 'clinical', label: 'Clinical' },
  { key: 'procedural', label: 'Procedural' },
  { key: 'communication', label: 'Communication' },
  { key: 'teamwork', label: 'Teamwork' },
  { key: 'ethics', label: 'Ethics' },
  { key: 'other', label: 'Other' },
];

export const LEADERSHIP_ROLES = ['director', 'institution_admin', 'admin'];

export interface ReflectionDraft {
  title: string;
  reflection_type: string;
  body: string;
  shared: boolean;
}

/** Returns the first user-facing validation error, or null when the draft is valid. */
export function validateReflectionDraft(draft: ReflectionDraft): string | null {
  if (draft.title.trim().length === 0) return 'Title is required';
  if (draft.title.trim().length > 200) return 'Title must be 200 characters or fewer';
  if (!REFLECTION_TYPES.includes(draft.reflection_type as ReflectionType)) {
    return 'Choose a reflection category';
  }
  const body = draft.body.trim();
  if (body.length === 0) return 'Reflection body is required';
  if (body.length > 10000) return 'Reflection body must be 10,000 characters or fewer';
  return null;
}

export interface ReflectionProfile {
  id: string;
  tenant_id: string;
}

/** DB insert shape for public.reflections (RLS pins author = self at the column level too). */
export function buildReflectionPayload(
  profile: ReflectionProfile,
  draft: ReflectionDraft
): Record<string, unknown> {
  return {
    tenant_id: profile.tenant_id,
    author_id: profile.id,
    title: draft.title.trim(),
    reflection_type: draft.reflection_type,
    body: draft.body.trim(),
    case_id: null,
    prompt: null,
    shared: draft.shared,
  };
}

/** Author can always delete; leadership can delete opted-in shared entries. */
export function canDeleteReflection(
  reflection: { author_id: string; shared: boolean },
  viewerProfileId: string,
  viewerRole: string
): boolean {
  if (reflection.author_id === viewerProfileId) return true;
  return reflection.shared && LEADERSHIP_ROLES.includes(viewerRole);
}

/** Leadership fetch: RLS already gates shared rows; this only hides an empty section. */
export function isLeadershipRole(role: string): boolean {
  return LEADERSHIP_ROLES.includes(role);
}

/** Word count shown next to the compose box (whitespace-collapsed). */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}
