import { isSafeHref } from '@/lib/site-content';

/**
 * Structured block renderer (T25). Every block type maps to explicit JSX;
 * all text renders through React escaping (no dangerouslySetInnerHTML
 * anywhere in this file). Unknown types render a neutral fallback instead
 * of crashing the page. Links pass the same allowlist as validation.
 */

export interface ContentBlock {
  type: string;
  [key: string]: unknown;
}

function SafeLink({ href, label }: { href: string; label: string }) {
  if (!isSafeHref(href)) return <span>{label}</span>;
  const external = href.startsWith('https://');
  return (
    <a
      href={href}
      className="text-primary underline-offset-2 hover:underline"
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {label}
    </a>
  );
}

function Block({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'hero': {
      const cta = block.cta as { label?: string; href?: string } | undefined;
      return (
        <section className="py-16 text-center" data-block="hero">
          <h1 className="text-4xl font-bold text-text-primary">{String(block.heading ?? '')}</h1>
          {typeof block.subheading === 'string' && block.subheading && (
            <p className="mt-4 text-lg text-text-secondary">{block.subheading}</p>
          )}
          {cta && typeof cta.label === 'string' && typeof cta.href === 'string' && (
            <p className="mt-6">
              <SafeLink href={cta.href} label={cta.label} />
            </p>
          )}
        </section>
      );
    }
    case 'text':
      return (
        <p className="py-4 text-base leading-relaxed text-text-secondary" data-block="text">
          {String(block.body ?? '')}
        </p>
      );
    case 'faq': {
      const items = (Array.isArray(block.items) ? block.items : []) as { q?: string; a?: string }[];
      return (
        <section className="py-8" data-block="faq">
          <h2 className="text-2xl font-semibold text-text-primary mb-4">Questions</h2>
          {items.map((item, i) => (
            <details key={i} className="border-b border-divider py-3">
              <summary className="font-medium text-text-primary cursor-pointer">{item.q}</summary>
              <p className="mt-2 text-sm text-text-secondary">{item.a}</p>
            </details>
          ))}
        </section>
      );
    }
    case 'cta': {
      const href = typeof block.href === 'string' ? block.href : '';
      const label = typeof block.label === 'string' ? block.label : '';
      return (
        <section className="py-10 text-center" data-block="cta">
          <SafeLink href={href} label={label} />
        </section>
      );
    }
    case 'contact': {
      const email = typeof block.email === 'string' ? block.email : '';
      return (
        <section className="py-8" data-block="contact">
          {typeof block.heading === 'string' && block.heading && (
            <h2 className="text-2xl font-semibold text-text-primary mb-2">{block.heading}</h2>
          )}
          {email && (
            <p>
              <SafeLink href={`mailto:${email}`} label={email} />
            </p>
          )}
        </section>
      );
    }
    case 'image': {
      const src = typeof block.src === 'string' ? block.src : '';
      const alt = typeof block.alt === 'string' ? block.alt : '';
      if (!isSafeHref(src) || src.startsWith('mailto:')) return null;
      return <img src={src} alt={alt} className="my-6 rounded-14 max-w-full" data-block="image" loading="lazy" />;
    }
    case 'benefits':
    case 'workflow':
    case 'features': {
      const items = (Array.isArray(block.items) ? block.items : []) as {
        title?: string;
        description?: string;
      }[];
      return (
        <section className="py-8" data-block={block.type}>
          <ul className="grid gap-4 md:grid-cols-3">
            {items.map((item, i) => (
              <li key={i} className="rounded-14 border border-border bg-surface p-5">
                <h3 className="font-semibold text-text-primary">{item.title}</h3>
                {item.description && <p className="mt-2 text-sm text-text-secondary">{item.description}</p>}
              </li>
            ))}
          </ul>
        </section>
      );
    }
    default:
      return (
        <p className="py-4 text-sm text-text-muted" data-block="unknown">
          Unsupported content block.
        </p>
      );
  }
}

export default function SitePageRenderer({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <div className="mx-auto max-w-3xl px-4">
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}
