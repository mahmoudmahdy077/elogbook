import type { CaseTemplate } from '../types/database';

export interface TemplateWithMeta extends CaseTemplate {
  is_favorite: boolean;
  usage_count: number;
}

export function sortTemplates(
  templates: CaseTemplate[],
  favoriteIds: Set<string>,
  personalCounts: Map<string, number>,
  tenantCounts: Map<string, number>,
): TemplateWithMeta[] {
  const withMeta: TemplateWithMeta[] = templates.map((t) => ({
    ...t,
    is_favorite: favoriteIds.has(t.id),
    usage_count: personalCounts.get(t.id) ?? 0,
  }));

  return withMeta.sort((a, b) => {
    const aFav = a.is_favorite ? 1 : 0;
    const bFav = b.is_favorite ? 1 : 0;

    if (aFav !== bFav) return bFav - aFav;

    const aPersonal = personalCounts.get(a.id) ?? 0;
    const bPersonal = personalCounts.get(b.id) ?? 0;
    if (aPersonal !== bPersonal) return bPersonal - aPersonal;

    const aTenant = tenantCounts.get(a.id) ?? 0;
    const bTenant = tenantCounts.get(b.id) ?? 0;
    if (aTenant !== bTenant) return bTenant - aTenant;

    return a.name.localeCompare(b.name);
  });
}
