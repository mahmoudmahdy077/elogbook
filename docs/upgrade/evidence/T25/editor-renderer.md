# T25 Evidence — Page editor + production renderer

Ticket: T25 (dependencies: T22, T24)
Status: IMPLEMENTED (functional surface below; viewport/accessibility
matrix + shareable preview tokens + metadata/SEO remain G5/T25-full work)

## Delivered

- `components/SitePageRenderer.tsx`: typed block → escaped JSX mapping
  (no dangerouslySetInnerHTML anywhere), safe-link gating, unknown-type
  fallback. 5/5 suite incl. script-escape and javascript:-URL tests.
- Tenant delegation API mirror (`api/[tenant]/admin/pages*`): same
  validation/publication contract, hard tenant scoping (cross-tenant
  rows 404, never 403-reveal). 4/4 suite.
- Public route `app/pub/[slug]`: published-pointer-only reads,
  re-validation at render (invalid → 404), slug-shape guard.
- Platform editor (`app/platform/pages/[id]`): revision list with
  publish (optimistic concurrency via expected pointer), JSON draft
  composer with server-side validation feedback, revert-by-republish.
  Cut/paste reorder in this release (honest v1 for a block model).
- T24 wording corrected (status-lifecycle revert, not new-row revert).

## Verification

- Renderer 5/5, tenant API 4/4, typecheck 0, lint 0 (one real catch:
  repo flat config has no next/no-img rule — removed the disable
  comment instead of adding an unknown-rule suppression).

## Deferred

Signup/contact link proof on live pages, locale/cache/metadata pass,
shareable expiring preview tokens, mobile rendering + accessibility
matrix, drag-and-drop composition.
