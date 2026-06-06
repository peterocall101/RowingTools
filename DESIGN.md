---
name: RowingTools
description: GMT% calculator and club performance browser for UK rowing.
colors:
  blade-red: "#c8472b"
  blade-red-deep: "#b03d26"
  bg: "#f7f7f6"
  bg-surface: "#ffffff"
  bg-elevated: "#eeeeec"
  bg-dark: "#0f0f0e"
  bg-surface-dark: "#1a1a18"
  bg-elevated-dark: "#252523"
  ink: "#111827"
  ink-muted: "#6b7280"
  ink-subtle: "#9ca3af"
  ink-light: "#f0f0ee"
  wbt-blue: "#1d4ed8"
  wbt-blue-bg: "#dbeafe"
  met-purple: "#7c3aed"
  met-purple-bg: "#ede9fe"
  hrr-green: "#059669"
  hrr-green-bg: "#d1fae5"
  hwr-amber: "#d97706"
  hwr-amber-bg: "#fef3c7"
typography:
  display:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "30px"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "23px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.5px"
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    letterSpacing: "0.04em"
rounded:
  sm: "6px"
  default: "10px"
  lg: "14px"
  pill: "999px"
  modal: "20px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  tab-pill:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.pill}"
    padding: "8px 20px"
  tab-pill-active:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "8px 20px"
  card:
    backgroundColor: "{colors.bg-surface}"
    rounded: "{rounded.default}"
    padding: "16px 24px"
  stat-box:
    backgroundColor: "{colors.bg-surface}"
    rounded: "{rounded.default}"
    padding: "14px 18px"
  button-primary:
    backgroundColor: "{colors.blade-red}"
    textColor: "#ffffff"
    rounded: "{rounded.default}"
    padding: "9px 18px"
  button-default:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.default}"
    padding: "7px 14px"
  search-input:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "11px 14px"
  reg-link:
    backgroundColor: "transparent"
    textColor: "{colors.blade-red}"
    rounded: "{rounded.sm}"
    padding: "3px 10px"
---

# Design System: RowingTools

## 1. Overview

**Creative North Star: "The Timing House"**

RowingTools is official infrastructure, not a consumer product. Like the timing house at a regatta - unglamorous, exacting, trusted - it exists to surface the number that matters. Every visual decision either makes a result easier to read or stays out of the way. The design does not draw attention to itself.

The system runs on restraint. Blade Red appears sparingly: in the brand mark, a topbar stripe, a focus ring, a link at the edge of a data table. Its rarity is its authority. Backgrounds are near-neutral: off-white at rest (no warmth tilt), near-black in dark mode. The Fraunces brand mark at 900 weight carries the personality in one letterform; Inter carries the data in every other. Dark mode is a first-class surface, not an afterthought.

This system explicitly rejects the feel of British Rowing's official website (institutional, stiff, committee-authored) and generic sports analytics SaaS dashboards (hero metrics, gradient accents, stock-photo backdrops). RowingTools is independent, handbuilt, and earns trust through precision.

**Key Characteristics:**
- Single-accent palette; the data category colors are informational, not decorative
- Serif brand mark + workhorse sans for all UI and data copy
- Flat-by-default surfaces; shadow is a hover and elevation signal only
- Light/dark mode symmetry: same token names, matched perceptual contrast
- Data density without visual noise; tabular numerics, restrained label uppercase

## 2. Colors: The Timing House Palette

One accent, a neutral stack, and four data-category colors with precisely bounded roles.

### Primary
- **Blade Red** (#c8472b): The brand mark, the 3px topbar stripe, focus states on search inputs, `.reg-link` buttons within data tables, the subscribe CTA. Used on at most 5-10% of any screen. Its scarcity is the point.
- **Blade Red Deep** (#b03d26): Hover state for Blade Red fill elements (the subscribe button at rest uses #c8472b; hover darkens to this).

### Secondary (data-category markers - not general UI accents)
- **WBT Blue** (#1d4ed8 / bg: #dbeafe): World Best Time benchmark. Table column headers, category pills.
- **MET Purple** (#7c3aed / bg: #ede9fe): Metropolitan Regatta ranking tier.
- **HRR Green** (#059669 / bg: #d1fae5): Head of the River Race standard.
- **HWR Amber** (#d97706 / bg: #fef3c7): Head of the Wear time.

Dark mode category colors step up in lightness: WBT (#60a5fa), MET (#a78bfa), HRR (#34d399), HWR (#fbbf24).

### Neutral (light mode)
- **Off-White Ground** (#f7f7f6): Page background (`--bg`). Near-white, no deliberate warmth.
- **Clean Surface** (#ffffff): Cards, inputs, table bodies, modals (`--bg2`).
- **Lifted Ground** (#eeeeec): Pill tab containers, table header rows, elevated backgrounds (`--bg3`).
- **Ink** (#111827): Primary text, headings.
- **Muted Ink** (#6b7280): Secondary text, descriptions, inactive tabs.
- **Subtle Ink** (#9ca3af): Labels, placeholders, tertiary metadata, empty states.

### Neutral (dark mode)
- **Near Black** (#0f0f0e): Page background.
- **Dark Surface** (#1a1a18): Cards, inputs, table bodies.
- **Elevated Dark** (#252523): Tab containers, table header rows.
- **Light Ink** (#f0f0ee): Primary text.
- Muted and Subtle Ink values are shared with light mode (#9ca3af / #6b7280) - they read correctly on dark surfaces.

### Named Rules
**The Blade Red Rule.** Blade Red is one voice. It appears on the brand mark, the topbar stripe, focus states, and `.reg-link` buttons. It is never used as a background fill on content areas, as a gradient input, or as a decorative element. Never more than twice on one screen outside the brand mark and topbar.

**The Data Color Rule.** WBT/MET/HRR/HWR colors are category markers only. They appear in column headers, pills, and badges tied to their specific benchmark. They are never repurposed as general UI accents, hover highlights, or theme colors.

## 3. Typography

**Display Font:** Fraunces (with Georgia, serif fallback)
**Body/UI Font:** Inter (with -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif fallback)

**Character:** Fraunces at 900 weight with -0.04em tracking supplies personality in one letterform - optical, editorial, confident. Inter does everything else: readable at 12px in a table cell, legible at 11px in an uppercase label, clear at 14px in body copy. The two never compete because they never appear at the same scale or in the same role.

### Hierarchy
- **Display** (Fraunces, 900, 28-30px, line-height 1, -0.04em tracking): Brand mark (`.brand-mark`) only. Never for page headings or section titles.
- **Headline** (Inter, 700, 22-23px, line-height 1.2, -0.5px tracking): Page-level titles (`<h1>`).
- **Title** (Inter, 600, 15-16px, line-height 1.4): Section headings, club profile names, table section labels.
- **Body** (Inter, 400, 13-14px, line-height 1.6): Descriptions, metadata, card prose. Line length capped to 65-75ch.
- **Label** (Inter, 500, 11px, 0.04-0.05em tracking, uppercase): Table column headers, small category badges, stat box labels. Uppercase reserved for these short labels only.

### Named Rules
**The Fraunces Ceiling Rule.** Fraunces appears only in `.brand-mark`. A serif heading on a data page reads as editorial decoration, not precision. Keep it bounded.

## 4. Elevation

Flat by default. Cards and table wrappers carry a 1px border at rest; no ambient shadow on the static page. Shadow is earned through state (hover, elevation, modal overlay).

### Shadow Vocabulary
- **Hover ambient** (`0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)`): Applied on card hover and interactive stat boxes. Signals "this element responds to interaction."
- **Elevated** (`0 4px 14px rgba(0,0,0,0.1), 0 12px 32px rgba(0,0,0,0.07)`): Table wrappers at rest, modals at small scale.
- **Modal deep** (`0 24px 80px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.15)`): Chart overlay card. Paired with a blurred backdrop at rgba(0,0,0,0.65) + backdrop-filter: blur(6px).

Dark mode multipliers: ambient and elevated shadows increase to rgba(0,0,0,0.3-0.5). The dark surface tonal stack does the primary depth work; shadows reinforce it.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. The 1px border defines the card; the hover shadow confirms it is interactive. Static cards never carry ambient shadow. Modal depth is a hard cut from the page, not a gradient transition.

## 5. Components

### Pill Tabs (section and year navigation)
RowingTools' primary navigation pattern for switching between sections (calculator/leaderboards) and years.
- **Container:** `--bg3` background, `999px` radius, 3px inner padding.
- **Inactive:** transparent background, `--text2` color, 8px 20px padding, 500 weight, `transition: all 0.18s ease`.
- **Active:** `--bg2` background, `--text` color, `0 1px 5px rgba(0,0,0,0.13)` shadow.

### Underline Tabs (sub-navigation)
Used within sections (e.g. benchmark tabs, data sub-views).
- **Container:** flex row, `1px solid --border` bottom edge.
- **Inactive:** transparent, `--text2` color, `2px solid transparent` bottom border.
- **Active:** `--text` color, `2px solid --text` bottom border, 600 weight.

### Cards
- **Radius:** 10px (`--r`) standard; 14px (`--rl`) for cards that need more visual weight (info blocks).
- **Background:** `--bg2`. **Border:** 1px `--border` at rest.
- **Shadow at rest:** `var(--shadow)` on table wrapper cards; none on plain content cards.
- **Hover:** border shifts to `--border2`; hover shadow if interactive.
- **Padding:** 16px 24px standard; 13px 16px for dense list cards.

### Stat Boxes
The primary display for club-level headline metrics.
- **Radius:** 10px. **Background:** `--bg2`. **Border:** 1px `--border`.
- **Value:** 22px Inter 700.
- **Label:** 12px `--text3`.
- **Interactive variant:** adds `cursor: pointer`, hover border steps to `--border2`, hover shadow applied. Signals it opens a leaderboard overlay.

### Data Tables
The dense core of most RowingTools pages.
- **Wrapper:** `border: 1px solid --border`, `border-radius: 14px`, `overflow: hidden`, `background: --bg2`, `box-shadow: var(--shadow)`. Horizontal scroll on mobile with 4px scrollbar.
- **Header cells:** 11px Inter 500, `--text2` or `--text3`, uppercase, 0.04-0.05em tracking, 7-12px padding.
- **Data cells:** 12-13px Inter 400. Numeric columns: right-aligned, `font-variant-numeric: tabular-nums`.
- **Row hover:** `--bg3` background.
- **Data category headers:** colored with the matching WBT/MET/HRR/HWR color at 600 weight.

### Inputs and Selects
- **Style:** 1.5px border (`--border2`), `--r` radius (10px), `--bg2` background, 14px Inter, 36px height.
- **Focus:** border-color shifts to the context accent (Blade Red on profile search; WBT blue on the GMT calculator). No box-shadow ring; the border shift alone is sufficient.

### Primary Button (CTA)
Used exclusively for the subscribe form submit action.
- **Background:** Blade Red (#c8472b). **Text:** white, 600 weight, 13px.
- **Radius:** `--r`. **Padding:** 9px 18px.
- **Hover:** deep Blade Red (#b03d26).

### Default Button
Used for tool controls (calculate, filter toggles).
- **Background:** `--bg2`. **Border:** 1.5px `--border2`. **Text:** `--text`, 500 weight, 14px.
- **Radius:** `--r`. **Height:** 36px.
- **Hover:** `--bg3` background.

### Ghost Button
Dismiss and inline icon actions.
- **No border, no background.** `--text3` color, font-size 18px.
- **Hover:** `--text` color, `--bg3` background.

### Benchmark Toggle (`.btog`)
Pill-shaped toggles for selecting event categories.
- **Style:** 1.5px border `--border2`, 999px radius, `--bg2` background, `--text2` text, 13px 500.
- **Colored dot:** 8px circle in the matching data-category color.
- **Active/selected state:** handled by JavaScript; border and text shift toward the category color.

### Data Category Pills
Inline badges identifying benchmark tiers.
- **Style:** 11px Inter 600, `999px` radius, 2px 9px padding.
- **Variants:** `.pill-wbt`, `.pill-met`, `.pill-hrr`, `.pill-hwr` - each uses the matching category color for text and its bg variant for background.

### External Table Link (`.reg-link`)
Links to regatta result pages embedded in data tables.
- **Style:** Blade Red text, `1px solid rgba(200,71,43,0.3)` border, 6px radius, 3px 10px padding, 12px font.
- **Hover:** `rgba(200,71,43,0.07)` background.
- **Purpose:** low visual weight, unambiguous intent. Doesn't compete with data cells.

### Modal / Chart Overlay
- **Backdrop:** `rgba(0,0,0,0.65)` + `backdrop-filter: blur(6px)`. `opacity` transition on open.
- **Card:** `--bg2` background, 20px radius, 1.75rem padding, `width: min(580px, 94vw)`.
- **Shadow:** `0 24px 80px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.15)`.
- **Entrance:** `translateY(18px) scale(0.96)` at rest; `translateY(0) scale(1)` when open, `cubic-bezier(0.16,1,0.3,1)` 0.25s.

## 6. Do's and Don'ts

### Do:
- **Do** use Blade Red only on the brand mark, topbar stripe, focus states, and `.reg-link` buttons. If it appears more than twice on a screen (excluding the topbar and brand mark), recount.
- **Do** use `font-variant-numeric: tabular-nums` on every numeric data column. Misaligned digits are a precision failure.
- **Do** step text color up to `--text2` for anything the user needs to scan. Use `--text3` only for labels and truly secondary metadata. Never go lighter than `--text3` on a `--bg2` surface.
- **Do** keep shadow as a hover and elevation signal. The 1px border defines the card; shadow confirms it is interactive.
- **Do** use uppercase Inter 500 at 11px with 0.04-0.05em tracking for table column headers. Short labels only (1-4 words).
- **Do** use the pill tab pattern for section and year switching. It is the established RowingTools navigation convention.
- **Do** apply `overflow: hidden` on the table wrapper card alongside `border-radius` so the table corners clip correctly.

### Don't:
- **Don't** make this look like British Rowing's official site. No institutional layout, no committee fonts, no boxy navy-and-white bureaucratic palette.
- **Don't** add hero metrics, gradient accents, glassmorphism by default, or sports-analytics SaaS dashboard clichés. RowingTools is not selling itself.
- **Don't** use Fraunces for anything other than `.brand-mark`. Serif headings here read as editorial decoration, not data precision.
- **Don't** use `border-left` or `border-right` greater than 1px as a colored accent stripe on cards, alerts, or list items. Use a background tint or full border instead.
- **Don't** use gradient text (`background-clip: text`). A single solid Blade Red is all the accent this system needs.
- **Don't** tilt background colors warm by default. The bg is near-neutral (#f7f7f6). Warmth is carried by Blade Red's hue in small doses, not by tinting the page ground.
- **Don't** use WBT/MET/HRR/HWR category colors outside their benchmark context. They are informational, not decorative. Repurposing them as general UI accents breaks the data encoding.
- **Don't** add ambient shadow to static cards. The hover shadow signals interactivity; a resting shadow flattens that signal.
