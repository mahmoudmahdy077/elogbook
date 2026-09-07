/**
 * Tenant branding application (T21/F11).
 *
 * White-label settings are saved via the admin form but previously had no
 * consumer: this module parses the stored `custom_branding` JSON into
 * validated values and maps them to CSS variables applied by the tenant
 * layout on initial server render (no flash, no client fetch).
 *
 * Validation is strict by design: hex colors only, https logos only,
 * bounded text. Anything else falls back to platform defaults. Values
 * are safe to interpolate into a `style` attribute (no quotes/semicolons
 * survive validation).
 */

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const MAX_TEXT = 160;

export interface ParsedBranding {
  logoUrl: string | null;
  primaryColor: string | null;
  footerText: string;
  institutionName: string;
}

const EMPTY: ParsedBranding = { logoUrl: null, primaryColor: null, footerText: '', institutionName: '' };

function cleanText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.slice(0, MAX_TEXT);
}

function cleanLogoUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function cleanHex(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const v = value.trim();
  return HEX_RE.test(v) ? v : null;
}

export function parseBranding(input: unknown): ParsedBranding {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ...EMPTY };
  const record = input as Record<string, unknown>;
  return {
    logoUrl: cleanLogoUrl(record.logo_url),
    primaryColor: cleanHex(record.primary_color),
    footerText: cleanText(record.footer_text),
    institutionName: cleanText(record.institution_name),
  };
}

/** CSS variables for the tenant shell root (initial server render). */
export function brandingCssVars(branding: ParsedBranding): Record<string, string> {
  const vars: Record<string, string> = {};
  if (branding.primaryColor) vars['--color-primary'] = branding.primaryColor;
  return vars;
}
