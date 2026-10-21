/*
 * Categorical colours for charts that tell 2–5 series, groups or parts apart
 * (chart series, scatter groups, composition parts, KPI segments). A single
 * series keeps the one-hue tone ramp (`--chart-1…5`).
 *
 * Muted, editorial hues after Pinterest's 2026 palette: Orange Topaze
 * (vermilion), Cool Blue, Cassis (berry), Vert Sauge (sage), Wasabi
 * (chartreuse), in that order. The references are pastels and inks, so each
 * hue keeps its OKLCH hue at chroma 0.125 with its lightness set per theme to
 * work as a mark on GenUI's cards; the lightness and the order were searched
 * and checked with the dataviz skill's validator (white and black cards):
 * - adjacent pairs (bars, stacks, lines, segments), all 5: every gate passes
 *   in both modes (worst CVD ΔE 14.1 light / 8.9 dark, normal-vision 16.8 /
 *   15.8). Only Wasabi sits below 3:1 on white (2.28), so these charts always
 *   ship visible labels or a legend with values, and an sr-only table.
 * - all pairs (scatter: any two groups can touch): the first 3 pass (CVD ΔE
 *   16.2 / 16.1, normal-vision 21.9 / 17.4). Scatter plots colour at most 3
 *   groups; more fold into a neutral "Other".
 * No violet (reserved for selection). Colour is never the only signal:
 * labels, legends, shapes and dashes stay.
 */

/** How many categorical colours there are; past this, fold into "Other". */
export const SERIES_COUNT = 5
/** Groups that can all touch each other (scatter): only these stay distinct. */
export const SERIES_ALL_PAIRS = 3

export const SERIES_HEX = {
  // Orange Topaze, Cool Blue, Cassis, Vert Sauge, Wasabi
  light: ["#d3745b", "#387ec1", "#8b345b", "#5e8934", "#b3b04a"],
  dark: ["#d6775e", "#4b90d5", "#9e466d", "#4d7720", "#9d9a31"],
} as const

/**
 * Put on a component's root: defines `--series-1…5` for both themes, so
 * marks can use `var(--series-n)` (Recharts colours, inline styles).
 */
export const SERIES_VARS =
  "[--series-1:#d3745b] [--series-2:#387ec1] [--series-3:#8b345b] [--series-4:#5e8934] [--series-5:#b3b04a] dark:[--series-1:#d6775e] dark:[--series-2:#4b90d5] dark:[--series-3:#9e466d] dark:[--series-4:#4d7720] dark:[--series-5:#9d9a31]"

/** The colour of series `index` (0-based), as a CSS value. Needs SERIES_VARS above it. */
export const seriesColor = (index: number) => `var(--series-${(index % SERIES_COUNT) + 1})`

/** Background classes per series (legend swatches, segments, bars). Needs SERIES_VARS. */
export const SERIES_BG = [
  "bg-[var(--series-1)]",
  "bg-[var(--series-2)]",
  "bg-[var(--series-3)]",
  "bg-[var(--series-4)]",
  "bg-[var(--series-5)]",
] as const

/** SVG fill classes per series. Needs SERIES_VARS. */
export const SERIES_FILL = [
  "fill-[var(--series-1)]",
  "fill-[var(--series-2)]",
  "fill-[var(--series-3)]",
  "fill-[var(--series-4)]",
  "fill-[var(--series-5)]",
] as const

/** "Other" and anything folded: a neutral grey, never a sixth hue. */
export const OTHER_COLOR = "color-mix(in oklab, var(--foreground) 28%, var(--card))"

/**
 * Tag classes per series, for a closed list of categories in a table column
 * (D43): a tinted fill like the badges' with text in the same hue, deepened in
 * light and lifted in dark to stay above 4.5:1 at 13px (worst: Wasabi, 5.0:1
 * light; Cassis, 5.3:1 dark). Past the fifth option, tags stay blue. Needs
 * SERIES_VARS.
 */
export const SERIES_TAG = [
  "bg-[color-mix(in_oklab,var(--series-1)_12%,transparent)] text-[color-mix(in_oklab,var(--series-1)_70%,black)] dark:bg-[color-mix(in_oklab,var(--series-1)_14%,transparent)] dark:text-[color-mix(in_oklab,var(--series-1)_75%,white)]",
  "bg-[color-mix(in_oklab,var(--series-2)_12%,transparent)] text-[color-mix(in_oklab,var(--series-2)_70%,black)] dark:bg-[color-mix(in_oklab,var(--series-2)_14%,transparent)] dark:text-[color-mix(in_oklab,var(--series-2)_75%,white)]",
  "bg-[color-mix(in_oklab,var(--series-3)_12%,transparent)] text-[color-mix(in_oklab,var(--series-3)_70%,black)] dark:bg-[color-mix(in_oklab,var(--series-3)_14%,transparent)] dark:text-[color-mix(in_oklab,var(--series-3)_75%,white)]",
  "bg-[color-mix(in_oklab,var(--series-4)_12%,transparent)] text-[color-mix(in_oklab,var(--series-4)_70%,black)] dark:bg-[color-mix(in_oklab,var(--series-4)_14%,transparent)] dark:text-[color-mix(in_oklab,var(--series-4)_75%,white)]",
  "bg-[color-mix(in_oklab,var(--series-5)_12%,transparent)] text-[color-mix(in_oklab,var(--series-5)_70%,black)] dark:bg-[color-mix(in_oklab,var(--series-5)_14%,transparent)] dark:text-[color-mix(in_oklab,var(--series-5)_75%,white)]",
] as const
