# Research: Premium Mobile Logbook

**Feature**: [spec.md](./spec.md) | **Date**: 2026-06-11

## Research Topics

### 1. HeroUI Component Mapping to React Native via NativeWind

**Decision**: Use HeroUI `@heroui/react` on web and replicate component styling on mobile via NativeWind v4 with matching CSS tokens.

**Rationale**: HeroUI does not have a React Native package. However, HeroUI components are styled with Tailwind CSS classes that map 1:1 to NativeWind's React Native implementation. By exporting the clinical design token system (colors, spacing, border-radius, shadows) as Tailwind presets shared between `apps/web/tailwind.config` and `apps/mobile/tailwind.config.js`, visual parity is achieved without duplicating component logic.

**Alternatives considered**:
- **Tamagui**: Full cross-platform UI kit but would require replacing HeroUI entirely — violates "improve existing tech structure" directive.
- **React Native Paper**: Material Design based, conflicts with clinical design system.
- **Custom NativeWind components**: Would reinvent HeroUI patterns, losing design consistency.

**Implementation**: Create a shared `tailwind-preset.ts` in `packages/shared/` exporting the clinical token system. Both web and mobile Tailwind configs import this preset. Mobile recreates key HeroUI patterns (Card, Chip, Badge, Button, Modal) as thin NativeWind wrappers.

### 2. Glass-Panel Effects on React Native

**Decision**: Use `react-native-blur` (`@react-native-community/blur`) for backdrop blur with NativeWind opacity/border utilities for the translucent overlay effect.

**Rationale**: React Native does not support CSS `backdrop-filter: blur()`. `@react-native-community/blur` provides native blur views on both iOS (UIBlurEffect) and Android (RenderScript). Combined with absolute positioning and `rgba()` backgrounds, it reproduces the glass-panel aesthetic.

**Alternatives considered**:
- **Expo BlurView**: Available in Expo SDK 56 but less customizable.
- **Semi-transparent backgrounds only**: Simpler but loses the depth signal glass-panels provide. Violates DESIGN.md.
- **Custom shader**: Over-engineered for this use case.

**Implementation**: Create a `<GlassPanel>` wrapper component in `apps/mobile/components/` using `BlurView` with configurable blur intensity (default 12), border styling (`rgba(255,255,255,0.05)`), and shadow tint matching the clinical backdrop.

### 3. SVG Progress Rings with Glow on Mobile

**Decision**: Use `react-native-svg` for circular progress rings with SVG `feGaussianBlur` filter for glow effects.

**Rationale**: `react-native-svg` is already a transitive dependency of many Expo packages. SVG elements render natively on both platforms. The glow effect is achieved via SVG filters (`<defs>` + `<filter>` + `<feGaussianBlur>`) applied to the progress arc. This avoids Canvas-based rendering which has inconsistent performance on Android.

**Alternatives considered**:
- **react-native-skia**: Google's high-performance 2D graphics library. Better performance but adds 3MB to bundle and requires separate rendering pipeline.
- **victory-native**: Charting library built on Skia. Too heavy for simple rings.
- **CSS border-based rings**: Works on web but not React Native.

**Implementation**: Create a `<ProgressRing>` component in `apps/mobile/components/` that accepts `percentage`, `specialty`, `color`, `glowColor` props. Uses `react-native-svg` `<Circle>` with `strokeDasharray`/`strokeDashoffset` for the arc. Glow via SVG filter. Animation via Reanimated shared values driving `strokeDashoffset`.

### 4. Animation Strategy: Framer Motion (Web) → Reanimated (Mobile)

**Decision**: Web uses Framer Motion (already integrated). Mobile uses React Native Reanimated 4 (already in Expo 56 dependency tree). Create a thin animation abstraction for shared patterns.

**Rationale**: Framer Motion does not support React Native. Reanimated is the industry standard for performant RN animations (runs on UI thread). Both libraries support spring animations, timing curves, and layout animations — making conceptual parity achievable.

**Alternatives considered**:
- **react-native-animatable**: Declarative but less performant (runs on JS thread).
- **LayoutAnimation API**: Built-in but limited control over timing/easing.
- **Shared animation library**: No mature cross-platform animation library exists that bridges web and RN.

**Implementation**: Define animation constants in `packages/shared/src/constants/animations.ts`:
- `DEFAULT_TRANSITION = { duration: 200, easing: [0.4, 0, 0.2, 1] }`
- `SPRING_SLIDE_UP = { tension: 170, friction: 26 }`
- `STAGGER_DELAY = 50` (ms per item)
Web components use these as Framer Motion variants. Mobile components use Reanimated `withTiming()`/`withSpring()` with the same values.

### 5. Haptic Feedback Patterns

**Decision**: Use `expo-haptics` (already installed) for mobile. Web uses no haptics (not available). Define haptic patterns per interaction type.

**Rationale**: `expo-haptics` provides `notificationAsync()`, `impactAsync()`, `selectionAsync()` with platform-native haptic engines. Different patterns communicate different feedback types without visual confirmation.

**Alternatives considered**:
- **react-native-haptic-feedback**: Less maintained, Expo compatibility issues.
- **Vibration API**: Too coarse — only on/off, no pattern control.
- **No haptics**: Loses tactile feedback advantage specified in FR-003.

**Implementation**: Create a `useHaptics()` hook in `apps/mobile/lib/haptics.ts`:
- `submitSuccess()` → `notificationAsync(Success)`
- `submitError()` → `notificationAsync(Error)`
- `offlineSave()` → `notificationAsync(Warning)`
- `approvalAction()` → `impactAsync(Heavy)`
- `selection()` → `selectionAsync()`

### 6. Offline Sync Conflict Resolution

**Decision**: Server-authoritative strategy with draft preservation. WatermelonDB `sync` protocol for bidirectional sync with Supabase as remote. Conflicts detected by `updated_at` timestamps.

**Rationale**: For clinical data, supervisor actions (approve/reject) must always take precedence over resident offline edits. The server-wins approach defined in FR-024 is safest. WatermelonDB's built-in sync protocol supports pull/push with conflict detection via `_changed` fields. Supabase serves as the sync server via a custom `pullChanges`/`pushChanges` implementation.

**Alternatives considered**:
- **Last-write-wins**: Simpler but risks losing supervisor rejections — unacceptable for clinical compliance.
- **CRDT-based (Automerge/Yjs)**: Over-engineered for logbook use case. Adds complexity without clinical benefit.
- **Manual conflict resolution UI**: Better UX but adds complexity and decision burden on residents.

**Implementation**: Complete the existing `SyncService` class in `apps/mobile/lib/sync.ts`:
1. Add `@react-native-community/netinfo` for connectivity detection
2. Wire `pushPendingCases()` to WatermelonDB sync protocol
3. On conflict: preserve server state, create new local draft with `sync_status: 'conflict'`
4. Show conflict notification banner (FR-024)
5. Add periodic sync interval (30s when online) and pull-to-refresh trigger

### 7. AI Response Streaming on Mobile

**Decision**: Use Supabase Edge Function `ai-insights` (existing) with Server-Sent Events (SSE) for streaming responses. Mobile client uses `EventSource` polyfill via `react-native-sse`.

**Rationale**: AI responses can take 5–10 seconds. Streaming provides progressive rendering — critical for perceived performance. SSE is simpler than WebSockets for unidirectional server→client streaming. The existing `ai-insights` edge function already supports streaming via the OpenAI/Anthropic APIs.

**Alternatives considered**:
- **Batch response only**: Simpler but 10-second wait with spinner is poor UX.
- **WebSockets**: Overkill for request-response pattern. Adds connection management complexity.
- **Polling**: Inefficient and adds latency.

**Implementation**: Extend `ai-insights` edge function to accept a `stream: boolean` parameter. When true, return SSE response with `text/event-stream` content type. Mobile client uses `EventSource` to render tokens progressively in a scrollable text view with typing indicator.

### 8. Data Residency Implementation

**Decision**: Tenant-level `region` field on `tenants` table with logical separation within single Supabase project. Region constraints enforced at RLS policy level and backup configuration.

**Rationale**: CHK clarified tenant-level region tagging. Single Supabase project keeps operational complexity manageable. RLS policies ensure queries only return data for the user's tenant (which is region-tagged). Supabase project is hosted in a primary region (e.g., US-East) with read replicas in other regions as needed for latency.

**Alternatives considered**:
- **Per-region Supabase projects**: Full physical separation but requires project-per-region management, cross-region auth federation, and complex deployment pipelines.
- **Multi-cloud**: Spreads risk but multiplies operational burden.

**Implementation**:
1. Add `region TEXT DEFAULT 'us-east-1'` to `tenants` table
2. Add `data_retention_days INTEGER DEFAULT 2555` (7 years) to `tenants`
3. Add `consent_required BOOLEAN DEFAULT true` to `tenants`
4. Update `ComplianceConfiguration` type in `@elogbook/shared`
5. RLS policies already enforce tenant isolation — region is a tenant attribute
