# Design Consistency Audit: Premium Mobile Logbook

**Purpose**: Measure cross-platform design consistency per SC-005 (target 95%+)
**Feature**: [spec.md](../spec.md)
**Created**: 2026-06-11

## Scoring Rubric

Each item scored: 0 (no match), 0.5 (partial match), 1 (exact match). Total possible: 30 points per platform. Target: 28.5+ (95%).

## Color Tokens (6 tokens × 1pt each)

| Token | Web Value | Mobile Value | Match? | Score (0/0.5/1) |
|-------|-----------|-------------|--------|------------------|
| Backdrop | #060814 | #060814 | | |
| Primary (Teal) | #0D9488 | #0D9488 | | |
| Secondary (Indigo) | #6366F1 | #6366F1 | | |
| Amber (Pending) | #D97706 | #D97706 | | |
| Emerald (Approved) | #059669 | #059669 | | |
| Crimson (Rejected) | #DC2626 | #DC2626 | | |

## Typography (4 items × 1pt each)

| Item | Web | Mobile | Match? | Score |
|------|-----|--------|--------|-------|
| Heading font | Outfit | Outfit | | |
| Body font | Inter | Inter | | |
| Mono font (Clinical Data) | Geist Mono | Geist Mono | | |
| Font weight hierarchy | — | — | | |

## Elevation (3 items × 1pt each)

| Item | Web | Mobile | Match? | Score |
|------|-----|--------|--------|-------|
| Panel background | #0F172A | #0F172A | | |
| Glass-panel blur | 12px | 12px | | |
| Glass-panel border | rgba(255,255,255,0.05) | rgba(255,255,255,0.05) | | |

## Motion (4 items × 1pt each)

| Item | Web | Mobile | Match? | Score |
|------|-----|--------|--------|-------|
| Default transition | 200ms cubic-bezier(0.4,0,0.2,1) | withTiming(200ms) | | |
| Card exit | slide-left + fade | slide-left + fade | | |
| KPI counter animation | count-up 1.5s | count-up | | |
| Spring slide-up | tension:170,damping:26 | tension:170,damping:26 | | |

## Component States (5 items × 1pt each)

| Item | Web | Mobile | Match? | Score |
|------|-----|--------|--------|-------|
| Badge Draft | neutral border | neutral border | | |
| Badge Pending | glowing amber | glowing amber | | |
| Badge Approved | glowing emerald | glowing emerald | | |
| Badge Rejected | glowing crimson | glowing crimson | | |
| Button Primary | teal #0D9488 | teal #0D9488 | | |

## Totals

| Platform | Score | /30 | % |
|----------|-------|-----|---|
| Web | | | |
| Mobile | | | |
| **Overall** | | /60 | |

## Audit Date



## Auditor



## Notes

