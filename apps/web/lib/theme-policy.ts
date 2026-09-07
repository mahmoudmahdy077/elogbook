/**
 * Tenant theme publication policy (T22).
 *
 * `tenants.custom_branding` stays the single published pointer (T21
 * consumer); `tenant_theme_revisions` archives every publication for
 * revert. This module validates candidate configs against platform
 * ceilings: allowlisted keys only, strict value shapes, and a hard
 * contrast floor (3.0, large-text/action band) with warnings below 4.5.
 * Low-contrast or disallowed themes cannot publish.
 */

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export interface ThemeCeilings {
  allowedKeys: readonly string[];
  /** Null = any validated hex allowed (subject to contrast floor). */
  allowedPrimaries: readonly string[] | null;
  allowLogos: boolean;
  maxTextLength: number;
  /** Hard floor; below 4.5 warns. */
  minContrast: number;
  warnContrast: number;
}

export const PLATFORM_THEME_CEILINGS: ThemeCeilings = {
  allowedKeys: ['logo_url', 'primary_color', 'footer_text', 'institution_name', 'density'],
  allowedPrimaries: null,
  allowLogos: true,
  maxTextLength: 160,
  minContrast: 3.0,
  warnContrast: 4.5,
};

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h
    .split('')
    .map((c) => c + c)
    .join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG relative-luminance contrast ratio of two hex colors. */
export function contrastRatio(foreground: string, background: string): number {
  const l1 = luminance(foreground);
  const l2 = luminance(background);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export interface ThemeValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Sanitized config safe to persist (validated values only). */
  sanitized: Record<string, string>;
}

export function validateThemePublish(
  candidate: Record<string, unknown>,
  ceilings: ThemeCeilings = PLATFORM_THEME_CEILINGS,
): ThemeValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sanitized: Record<string, string> = {};

  for (const key of Object.keys(candidate)) {
    if (!ceilings.allowedKeys.includes(key)) {
      errors.push(`disallowed theme key: ${key}`);
    }
  }

  const primary = candidate.primary_color;
  if (primary !== undefined && primary !== null && primary !== '') {
    if (typeof primary !== 'string' || !HEX_RE.test(primary.trim())) {
      errors.push('primary_color must be a hex color like #007AFF');
    } else {
      const hex = primary.trim();
      if (ceilings.allowedPrimaries && !ceilings.allowedPrimaries.includes(hex)) {
        errors.push(`primary_color ${hex} is outside the platform palette`);
      } else {
        const ratio = contrastRatio(hex, '#FFFFFF');
        if (ratio < ceilings.minContrast) {
          errors.push(`primary_color contrast ${ratio.toFixed(2)} is below the ${ceilings.minContrast} floor`);
        } else if (ratio < ceilings.warnContrast) {
          warnings.push(`primary_color contrast ${ratio.toFixed(2)} is below 4.5 (large-text use only)`);
        }
        sanitized.primary_color = hex;
      }
    }
  }

  const logo = candidate.logo_url;
  if (logo !== undefined && logo !== null && logo !== '') {
    if (!ceilings.allowLogos) {
      errors.push('logos are disabled by platform policy');
    } else if (typeof logo !== 'string') {
      errors.push('logo_url must be a string');
    } else {
      try {
        const url = new URL(logo);
        if (url.protocol !== 'https:') errors.push('logo_url must be https');
        else sanitized.logo_url = url.toString();
      } catch {
        errors.push('logo_url must be a valid URL');
      }
    }
  }

  for (const key of ['footer_text', 'institution_name'] as const) {
    const value = candidate[key];
    if (typeof value === 'string' && value) {
      sanitized[key] = value.slice(0, ceilings.maxTextLength);
    }
  }

  if (candidate.density !== undefined && candidate.density !== null && candidate.density !== '') {
    if (candidate.density !== 'compact' && candidate.density !== 'comfortable') {
      errors.push('density must be compact or comfortable');
    } else {
      sanitized.density = candidate.density;
    }
  }

  return { ok: errors.length === 0, errors, warnings, sanitized };
}
