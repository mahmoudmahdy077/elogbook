// packages/shared/src/email/templates.ts
import type { TemplateRecord } from './types';
function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
export function render(tpl: TemplateRecord, vars: Record<string, string>): { subject: string; html: string; text?: string } {
  const fill = (src: string, escapeHtml: boolean): string =>
    src.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k: string) => {
      if (!(k in vars)) throw new Error(`template: missing variable ${k}`);
      return escapeHtml ? esc(vars[k]) : vars[k];
    });
  return { subject: fill(tpl.subject, false), html: fill(tpl.html, true), text: tpl.text ? fill(tpl.text, false) : undefined };
}
