# Design system — “City Instrument Panel”

Reference for every UI change in this repo. Tokens live in `src/app/globals.css`
(Tailwind v4 `@theme inline`); never hardcode a colour, radius or font in a component.

## Direction

A public-information instrument: warm paper canvas, ink typography, hairline rules,
tabular figures, one signal-red accent. Restraint over decoration — the map is the hero and
chrome must never compete with it. Bilingual by default: English and 繁體中文 are equal
citizens, so nothing may be designed as a first-language-only layout.

## Tokens

| Token | Value | Use |
|---|---|---|
| `--paper` | `#f3f0ea` | app canvas behind floating cards |
| `--surface` / `--surface-2` | `#ffffff` / `#faf8f4` | cards, hover fills |
| `--ink` / `--ink-2` | `#17130f` / `#4b453d` | primary / secondary text |
| `--muted` | `#857e74` | meta text, labels |
| `--line` / `--line-strong` | `#dcd6cc` / `#c2bab0` | 1 px separators, control borders |
| `--accent` | `#c0392b` | focus ring, active states, brand |
| `--c-redlight` | `#d92d20` | red-light camera layer |
| `--c-speed` | `#6d28d9` | speed enforcement layer |
| `--c-snapshot` | `#0e7490` | traffic snapshot layer (+ live) |
| `--ok` / `--warn` / `--err` | `#15803d` / `#b45309` / `#b42318` | status |
| `--radius` / `--shadow-panel` | `14px` / soft two-layer shadow | floating cards |

Layer colours are **double-encoded**: each layer also has its own marker shape
(circle = red-light, diamond = speed, rounded square = snapshot) so hue is never the only
signal.

## Typography

- Display / wordmark: **Instrument Serif** (`font-display`) — editorial counterweight to the map.
- UI + numbers: **Archivo** (`font-sans`, default body font) with tabular figures.
- CJK: `Noto Sans TC → PingFang TC → Microsoft JhengHei → Heiti TC` fallbacks; Chinese text
  is tracked slightly tighter where it sits next to Latin.
- Micro-labels: `.label` = 10 px / uppercase / `0.14em` tracking / 600. Never shout in
  sentence case where a label is required.

## Motion

`rise` (280 ms ease-out) for cards entering, `pulse` for the live indicator, `skeleton`
shimmer for loading, 200 ms colour/transform transitions on controls. Everything respects
`prefers-reduced-motion`.

## Layout rules

- Desktop: map fills the viewport; header top-left, layer panel under it, detail card
  top-right, MapLibre controls bottom-right, freshness chip bottom-centre.
- Mobile: header pinned to the top, layer panel becomes a bottom sheet (collapsed by
  default; it retracts while a detail card is open), detail card is a bottom sheet.
- Floating cards use `.panel` (translucent surface + 14 px blur + hairline + shadow) and one
  of two radii: card `14px`, control `10px`. Cards never position themselves — the parent
  owns layout so the map can inset them.
- Touch targets ≥ 40 px; icon-only buttons carry `aria-label` **and** a `.tip` tooltip.

## Content rules

- Every user-visible string goes through `useI18n().t(key)`; `en` and `zh` dictionaries must
  stay key-for-key identical (checked by script and by `tsc`).
- Numbers are data: show the count, the unit word, and the source revision. Never round away
  a real value.
- Unavailable data is stated, never substituted: status pills, raw upstream error text in
  `font-mono`, and a Retry action.
