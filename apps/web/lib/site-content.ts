/**
 * Editorial structured-content validation (T24).
 *
 * Pages are typed blocks (hero/benefits/workflow/features/faq/cta/
 * contact/text/image) — never arbitrary HTML/MDX. The T25 renderer maps
 * each type to a component and React-escapes all text, so validation here
 * focuses on shape, safe links, and bounds. Rejects (never sanitizes
 * into acceptance): unknown types, script/data URLs, inline HTML in
 * text fields, oversized or over-deep payloads.
 */

const BLOCK_TYPES = [
  'hero',
  'benefits',
  'workflow',
  'features',
  'faq',
  'cta',
  'contact',
  'text',
  'image',
] as const;

const MAX_BLOCKS = 64;
const MAX_DEPTH = 4;
const MAX_JSON_BYTES = 128 * 1024;
const MAX_TEXT = 5000;

const HTML_RE = /<\s*\/?\s*[a-z][^>]*>/i;

function isSafeHref(href: unknown): boolean {
  if (typeof href !== 'string' || !href) return false;
  if (href.startsWith('/')) return !href.startsWith('//');
  if (href.startsWith('mailto:')) return /^mailto:[^\s@]+@[^\s@]+$/.test(href);
  try {
    const url = new URL(href);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isPlainText(value: unknown, max = MAX_TEXT): boolean {
  return typeof value === 'string' && value.length <= max && !HTML_RE.test(value);
}

function checkBlock(block: unknown, depth: number, errors: string[], path: string): void {
  if (depth > MAX_DEPTH) {
    errors.push(`${path}: nesting exceeds depth ${MAX_DEPTH}`);
    return;
  }
  if (typeof block !== 'object' || block === null || Array.isArray(block)) {
    errors.push(`${path}: block must be an object`);
    return;
  }
  const b = block as Record<string, unknown>;
  if (typeof b.type !== 'string' || !(BLOCK_TYPES as readonly string[]).includes(b.type)) {
    errors.push(`${path}: unknown block type ${JSON.stringify(b.type)}`);
    return;
  }
  const need = (field: string) => {
    if (!isPlainText(b[field])) errors.push(`${path}.${field}: required plain text (no HTML)`);
  };
  switch (b.type) {
    case 'hero':
      need('heading');
      if (b.subheading !== undefined && !isPlainText(b.subheading)) errors.push(`${path}.subheading: plain text only`);
      if (b.cta !== undefined) {
        const cta = b.cta as Record<string, unknown>;
        if (typeof cta !== 'object' || cta === null || !isPlainText(cta.label, 80) || !isSafeHref(cta.href)) {
          errors.push(`${path}.cta: label text + safe href required`);
        }
      }
      break;
    case 'faq':
      if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 50) {
        errors.push(`${path}.items: 1-50 entries required`);
      } else {
        (b.items as unknown[]).forEach((item, i) => {
          const it = item as Record<string, unknown>;
          if (typeof it !== 'object' || it === null || !isPlainText(it.q, 500) || !isPlainText(it.a, 2000)) {
            errors.push(`${path}.items[${i}]: plain-text q/a required`);
          }
        });
      }
      break;
    case 'contact':
      if (b.email !== undefined && (typeof b.email !== 'string' || !/^mailto:[^\s@]+@[^\s@]+$/.test(`mailto:${b.email}`) && !/^[^\s@]+@[^\s@]+$/.test(b.email))) {
        errors.push(`${path}.email: valid email required`);
      }
      if (b.heading !== undefined && !isPlainText(b.heading, 200)) errors.push(`${path}.heading: plain text only`);
      break;
    case 'text':
      need('body');
      break;
    case 'image':
      if (!isSafeHref(b.src) || (b.src as string).startsWith('mailto:')) {
        errors.push(`${path}.src: https image URL required`);
      }
      if (b.alt !== undefined && !isPlainText(b.alt, 300)) errors.push(`${path}.alt: plain text only`);
      break;
    case 'benefits':
    case 'workflow':
    case 'features':
      if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 30) {
        errors.push(`${path}.items: 1-30 entries required`);
      } else {
        (b.items as unknown[]).forEach((item, i) => {
          const it = item as Record<string, unknown>;
          if (typeof it !== 'object' || it === null || !isPlainText(it.title, 200)) {
            errors.push(`${path}.items[${i}]: plain-text title required`);
          } else if (it.description !== undefined && !isPlainText(it.description, 2000)) {
            errors.push(`${path}.items[${i}].description: plain text only`);
          }
        });
      }
      break;
    case 'cta':
      need('label');
      if (!isSafeHref(b.href)) errors.push(`${path}.href: safe link required`);
      break;
  }
  if (Array.isArray((b as Record<string, unknown>).children)) {
    ((b as Record<string, unknown>).children as unknown[]).forEach((child, i) =>
      checkBlock(child, depth + 1, errors, `${path}.children[${i}]`),
    );
  }
}

export interface ContentValidation {
  ok: boolean;
  errors: string[];
}

export function validatePageContent(content: unknown): ContentValidation {
  const errors: string[] = [];
  if (typeof content !== 'object' || content === null || Array.isArray(content)) {
    return { ok: false, errors: ['content must be an object with blocks'] };
  }
  const blocks = (content as Record<string, unknown>).blocks;
  if (!Array.isArray(blocks)) return { ok: false, errors: ['content.blocks must be an array'] };
  if (blocks.length > MAX_BLOCKS) {
    return { ok: false, errors: [`too many blocks (max ${MAX_BLOCKS})`] };
  }
  let size = 0;
  try {
    size = new TextEncoder().encode(JSON.stringify(content)).length;
  } catch {
    return { ok: false, errors: ['content is not serializable'] };
  }
  if (size > MAX_JSON_BYTES) {
    return { ok: false, errors: [`content too large (max ${MAX_JSON_BYTES} bytes)`] };
  }
  blocks.forEach((block, i) => checkBlock(block, 1, errors, `blocks[${i}]`));
  return { ok: errors.length === 0, errors };
}
