#!/usr/bin/env python3
"""WCAG 2.1 AA contrast audit for Elogbook light-theme text colors.

Verifies:
1. Light-theme text/bg pairs (body tokens, status badges, banners, tinted
   surfaces) meet 4.5:1, or the large-text 3:1 for the marked pairs.
2. Drift guards: design-tokens.ts and globals.css badge/banner blocks stay in
   sync with the measured AA palette; dark-palette literals stay out of
   light-surface code.

Pre-fix failures that motivated this:
  #FF9500 warning    2.20:1 -> #8F4200
  #34C759 success    2.22:1 -> #186B2E
  #FF3B30  danger    3.55:1 -> #C20012
  #8E8E93 draft      2.89:1 -> #5E5E63
  #6EE7B7 emerald-300 text / #AEAEB2 default-400 text / #E5E5EA neutral-light
  /50 text on white -> replaced with text-text-muted / text-text-secondary.

Run:  python3 apps/web/scripts/wcag-contrast-audit.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WEB = REPO / "apps" / "web"

# ---------------------------------------------------------------- color utils
def _lin(c: float) -> float:
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def parse(hex_str: str) -> tuple[float, float, float]:
    h = hex_str.lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def rel_lum(rgb: tuple[float, float, float]) -> float:
    r, g, b = (_lin(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(fg_hex: str, bg_hex: str) -> float:
    la = rel_lum(parse(fg_hex))
    lb = rel_lum(parse(bg_hex))
    lighter, darker = max(la, lb), min(la, lb)
    return (lighter + 0.05) / (darker + 0.05)


def blend(fg_hex: str, fg_alpha: float, bg_hex: str) -> str:
    """Composite ALPHA-over-BG and return the resulting hex."""
    f, b = parse(fg_hex), parse(bg_hex)
    out = tuple(round(fa * fg_alpha + ba * (1 - fg_alpha)) for fa, ba in zip(f, b))
    return "#{:02X}{:02X}{:02X}".format(*out)  # type: ignore[arg-type]

# ------------------------------------------------------------------- tokens
# Semantic status text colors — Apple accessibility-increased-contrast variants.
STATUS_TEXT = {
    "success": "#186B2E",
    "warning": "#8F4200",
    "danger":  "#C20012",
}
# Raw bright hues: correct on dark surfaces only; also kept as status variants.
STATUS_RAW = {"success": "#34C759", "warning": "#FF9500", "danger": "#FF3B30"}

BACKDROP = "#F2F2F7"
SURFACE_BLEND = blend("#FFFFFF", 0.72, BACKDROP)  # frosted glass over backdrop

PRIMARY = "#007AFF"
SECONDARY = "#5856D6"

# ------------------------------------------------------- which pairs to check
# (label, fg, bg, threshold)
def build_pairs() -> list[tuple[str, str, str, float]]:
    pairs: list[tuple[str, str, str, float]] = []
    surfaces = {
        "backdrop #F2F2F7": BACKDROP,
        "surface #FFFFFF": "#FFFFFF",
        "glass blended #FBFBFC": SURFACE_BLEND,
    }
    # AA status text on its own /10 badge and /08 banner tints over each surface
    for kind, txt in STATUS_TEXT.items():
        for sname, sbg in surfaces.items():
            pairs.append((f"{kind} text on {sname} /10 badge tint", txt,
                          blend(txt, 0.10, sbg), 4.5))
            pairs.append((f"{kind} text on {sname} /08 banner tint", txt,
                          blend(txt, 0.08, sbg), 4.5))
        # dark theme still uses raw bright hues on #1C1C1E / #000 — must pass 4.5
        pairs.append((f"{kind} raw {STATUS_RAW[kind]} on dark surface #1C1C1E",
                      STATUS_RAW[kind], "#1C1C1E", 4.5))

    # neutral / glass text on all light surfaces
    surfaces_all = {"backdrop": BACKDROP, "surface": "#FFFFFF", "glass": SURFACE_BLEND}
    for sname, sbg in surfaces_all.items():
        pairs.append((f"text-primary on {sname}", "#000000", sbg, 4.5))
        pairs.append((f"text-secondary #3C3C43 on {sname}", "#3C3C43", sbg, 4.5))
        pairs.append((f"text-muted #6D6D73 on {sname}", "#6D6D73", sbg, 4.5))

    # on-primary / on-secondary buttons (large text, 3:1 threshold)
    pairs.append(("on-primary white on primary #007AFF (3:1 large-text)", "#FFFFFF", PRIMARY, 3.0))
    pairs.append(("on-primary white on secondary #5856D6 (3:1 large-text)", "#FFFFFF", SECONDARY, 3.0))

    # gray scale text aliases used in components
    pairs.append(("default-500 #6d6d73 on backdrop", "#6D6D73", BACKDROP, 4.5))
    pairs.append(("default-700 #48484a on surface", "#48484A", "#FFFFFF", 4.5))

    # StatusBadge.web draft pre-fix regression guard
    pairs.append(("draft text #5E5E63 on draft /12 bg", "#5E5E63",
                  blend("#8E8E93", 0.12, "#FFFFFF"), 4.5))

    # worst-case: status text over its own tint composited on the LIGHTER gray-50
    gray50 = BACKDROP
    for kind, txt in STATUS_TEXT.items():
        pairs.append((f"{kind} worst-case tint over #F2F2F7", txt, blend(txt, 0.12, gray50), 4.5))
    return pairs


def drift_guards() -> list[str]:
    issues: list[str] = []
    css = (WEB / "app" / "globals.css").read_text()

    # 1. light-theme badge/banner text colors → AA variants
    for light_cls, kind in [("badge-pending", "warning"),
                            ("badge-approved", "success"),
                            ("badge-rejected", "danger"),
                            ("warning-banner", "warning"),
                            ("danger-banner", "danger")]:
        block = re.search(rf"\.{light_cls} \{{[^}}]*\}}", css)
        assert block, f".{light_cls} block not found"
        want = STATUS_TEXT[kind]
        if want not in block.group(0):
            issues.append(f".{light_cls} does not use AA text color {want}")

    # 2. dark-theme overrides must keep the raw bright colors (not the AA ones)
    dark_block = re.search(r"\.dark \.badge-approved \{[^}}]*\}", css)
    assert dark_block, "dark .badge-approved not found"
    if STATUS_TEXT["success"] in dark_block.group(0):
        issues.append("dark .badge-approved wrongly shares light AA color")

    # 3. design-tokens.ts must define status.text variants synced with CSS
    tokens = (REPO / "packages/shared/src/constants/design-tokens.ts").read_text()
    for kind, want in STATUS_TEXT.items():
        if re.search(rf"{kind}:\s*'{want}'", tokens) is None:
            issues.append(f"design-tokens.ts missing status.text.{kind} = {want}")

    # 3b. StatusBadge components must consume status.* tokens (not raw brights)
    for f in ("web", "native"):
        badge = (REPO / f"packages/shared/src/components/StatusBadge.{f}.tsx").read_text()
        if "colors.status.text" not in badge:
            issues.append(f"StatusBadge.{f}.tsx does not consume colors.status.text tokens")

    # 4. dark-palette literals must not appear in light-surface code
    losers = ["text-emerald-300", "text-emerald-900", "bg-emerald-500/20"]
    for f in (WEB / "app").rglob("*.tsx"):
        s = f.read_text()
        for lit in losers:
            if lit in s:
                issues.append(f"{f}: forbidden dark-palette literal {lit}")
    return issues


def main() -> int:
    failures: list[str] = []
    for label, fg, bg, thr in build_pairs():
        r = contrast(fg, bg)
        ok = r >= thr
        mark = "PASS" if ok else "FAIL"
        print(f"[{mark}] {r:5.2f}:1  (need {thr}):1  {label}")
        if not ok:
            failures.append(label)
    issues = drift_guards()
    if failures or issues:
        print()
        for f in failures:
            print(f"[FAIL] contrast: {f}")
        for i in issues:
            print(f"[FAIL] drift-guard: {i}")
        return 1
    print("\nAll contrast pairs + drift guards PASS.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
