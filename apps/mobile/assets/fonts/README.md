# Required Font Files

Place the following font files in this directory:

## Outfit (Headings)
- `Outfit-Regular.ttf` - Regular weight (400)
- `Outfit-SemiBold.ttf` - Semi-bold weight (600)
- `Outfit-Bold.ttf` - Bold weight (700)

## Inter (Body Text)
- `Inter-Regular.ttf` - Regular weight (400)
- `Inter-Medium.ttf` - Medium weight (500)
- `Inter-SemiBold.ttf` - Semi-bold weight (600)

## Geist Mono (Clinical Data - MRN, Dates, Codes)
- `GeistMono-Regular.ttf` - Regular weight (400)
- `GeistMono-Medium.ttf` - Medium weight (500)

## Sources
- **Outfit**: https://github.com/google/fonts/tree/main/ofl/outfit
- **Inter**: https://github.com/rsms/inter
- **Geist Mono**: https://vercel.com/font (requires Vercel account) or use JetBrains Mono as fallback: https://github.com/JetBrains/JetBrainsMono

## Usage in _layout.tsx
The fonts are loaded via `useFonts` from `expo-font`:

```typescript
const [fontsLoaded] = useFonts({
  'Outfit': require('./assets/fonts/Outfit-Regular.ttf'),
  'Outfit-Bold': require('./assets/fonts/Outfit-Bold.ttf'),
  'Outfit-SemiBold': require('./assets/fonts/Outfit-SemiBold.ttf'),
  'Inter': require('./assets/fonts/Inter-Regular.ttf'),
  'Inter-Medium': require('./assets/fonts/Inter-Medium.ttf'),
  'Inter-SemiBold': require('./assets/fonts/Inter-SemiBold.ttf'),
  'GeistMono': require('./assets/fonts/GeistMono-Regular.ttf'),
  'GeistMono-Medium': require('./assets/fonts/GeistMono-Medium.ttf'),
});
```

## Clinical Tokens
Font families are accessed via `clinicalTokens.fonts`:
- `clinicalTokens.fonts.heading` → 'Outfit'
- `clinicalTokens.fonts.body` → 'Inter'
- `clinicalTokens.fonts.mono` → 'GeistMono'