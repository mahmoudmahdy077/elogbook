/**
 * Branded primitive types for type safety on the contract layer.
 *
 * These are nominally-distinguishable at the type level but
 * structurally still `string` (TypeScript erased generics). They
 * give us:
 *   - Static prevention of cross-type assignment (e.g. you can't
 *     pass a `PHIString` where a `UUID` is expected, even though
 *     both are `string` at runtime).
 *   - Self-documenting function signatures: a function that takes
 *     a `TenantId` makes it obvious what role the value plays.
 *   - Grep-ability for PHI/tenant scoping in code review.
 *
 * At runtime the brands are erased — they cost zero bytes and zero
 * nanoseconds. The Zod schemas (packages/shared/src/schemas) use
 * `.transform()` to apply the brand after validation.
 *
 * The `__brand` field uses a unique literal type per brand so that
 * `Brand<string, 'UUID'>` and `Brand<string, 'PHIString'>` are
 * mutually incompatible.
 */

declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type UUID = Brand<string, 'UUID'>;
export type IsoDateString = Brand<string, 'IsoDateString'>;
export type DateOnlyString = Brand<string, 'DateOnlyString'>;
export type PHIString = Brand<string, 'PHIString'>;
export type TenantId = Brand<UUID, 'TenantId'>;
export type ResidentId = Brand<UUID, 'ResidentId'>;

/** JSDoc marker for fields that contain PHI. Used by lint and review tools. */
export const PHI_MARKER = '@PHI' as const;

/** Type guard: was this branded UUID constructed at runtime? */
export function isUUID(value: unknown): value is UUID {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Coerce a raw string to UUID if it matches; otherwise return null. */
export function toUUID(raw: string): UUID | null {
  return isUUID(raw) ? (raw as UUID) : null;
}
