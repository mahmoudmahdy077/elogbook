# Mobile Design Token Migration - TODO

## Screens to Update
- [ ] `apps/mobile/app/(tabs)/index.tsx` - Dashboard
- [ ] `apps/mobile/app/(tabs)/log-case.tsx` - Case Logging
- [ ] `apps/mobile/app/(tabs)/approvals.tsx` - Approvals
- [ ] `apps/mobile/app/(tabs)/ai-insights.tsx` - AI Insights
- [ ] `apps/mobile/app/(tabs)/my-cases.tsx` - My Cases
- [ ] `apps/mobile/app/(tabs)/case-detail.tsx` - Case Detail
- [ ] `apps/mobile/app/(tabs)/profile.tsx` - Profile
- [ ] `apps/mobile/app/login.tsx` - Login

## Components to Replace
- [ ] `apps/mobile/components/GlassPanel.tsx` → import from `@elogbook/shared`
- [ ] `apps/mobile/components/StatusBadge.tsx` → import from `@elogbook/shared`
- [ ] `apps/mobile/components/ProgressRing.tsx` → import from `@elogbook/shared`

## Key Replacements
- Colors: `#060814` → `clinicalTokens.colors.backdrop.dark`
- Colors: `#0F172A` → `clinicalTokens.colors.neutral.dark`
- Colors: `#0D9488` → `clinicalTokens.colors.primary.DEFAULT`
- Colors: `#6366F1` → `clinicalTokens.colors.secondary.DEFAULT`
- Fonts: `Geist Mono` → `clinicalTokens.fonts.mono`
- Fonts: `Inter` → `clinicalTokens.fonts.body`
- Fonts: `Outfit` → `clinicalTokens.fonts.heading`
- Components: Local → Shared primitives