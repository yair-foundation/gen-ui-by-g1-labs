/**
 * Inspiration Cards: pure helpers (no React, no DOM), so they can be
 * unit-tested.
 *
 * - safeHttpUrl / safeImageSrc: what may load or be linked.
 * - gridColumns: 2 or 3 columns for the grid.
 * - readyItems: cards ready to draw while the call streams.
 * - toggleSelection & co: single/multiple picking with a max.
 * - selectionSummary / chosenLabel: words for the footer.
 */

import type {
  InspirationItem,
  InspirationSelectable,
} from "./inspiration-cards.schema";

export const MAX_ITEMS = 8;
export const MAX_LINE = 90;

// ---- URLs ----------------------------------------------------------------

/** The normalized URL if it is http(s); anything else is null. */
export function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Raster and SVG data URIs a host may pass for its own or demo images. */
const SAFE_DATA_IMAGE =
  /^data:image\/(?:png|jpeg|webp|svg\+xml)(?:;[a-z0-9=.+-]+)*,/i;

/**
 * The src if it is safe to load in an <img>: http(s), a same-origin path that
 * starts with a single "/", or a data: URI of type png, jpeg, webp or
 * svg+xml. Everything else (javascript:, blob:, protocol-relative URLs, other
 * data: types) is null.
 */
export function safeImageSrc(src: unknown): string | null {
  if (typeof src !== "string") return null;
  const value = src.trim();
  if (!value) return null;
  if (/^data:/i.test(value)) return SAFE_DATA_IMAGE.test(value) ? value : null;
  if (/^\/(?![/\\])/.test(value)) return value;
  return safeHttpUrl(value);
}

// ---- Layout --------------------------------------------------------------

/**
 * Columns on wider screens: 3 only when asked for and there are at least 3
 * cards; otherwise 2. (Phones always show 2.)
 */
export function gridColumns(columns: unknown, count: number): 2 | 3 {
  return columns === 3 && count >= 3 ? 3 : 2;
}

// ---- Items ---------------------------------------------------------------

const isString = (v: unknown): v is string => typeof v === "string";

function truncate(text: string, max: number) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** The card if it has an id, a title and an image with alt text; else null. */
export function normalizeItem(item: unknown): InspirationItem | null {
  if (!item || typeof item !== "object") return null;
  const i = item as Record<string, unknown>;
  const image = i.image as Record<string, unknown> | undefined;
  if (!isString(i.id) || !i.id) return null;
  if (!isString(i.title) || !i.title.trim()) return null;
  if (!image || !isString(image.src) || !isString(image.alt)) return null;
  if (!image.alt.trim()) return null;
  const line = isString(i.line) ? truncate(i.line, MAX_LINE) : "";
  return {
    id: i.id,
    image: { src: image.src, alt: image.alt.trim() },
    title: i.title.trim(),
    line: line || undefined,
    url: isString(i.url) && i.url ? i.url : undefined,
  };
}

/**
 * Cards ready to draw, at most 8. While streaming, the last card may still be
 * arriving (a half-written URL or title), so it's held back until the next
 * one starts. Duplicate ids keep the first.
 */
export function readyItems(
  items: unknown,
  streaming: boolean,
): InspirationItem[] {
  if (!Array.isArray(items)) return [];
  const complete = streaming ? items.slice(0, -1) : items;
  const seen = new Set<string>();
  const out: InspirationItem[] = [];
  for (const raw of complete) {
    const item = normalizeItem(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length === MAX_ITEMS) break;
  }
  return out;
}

// ---- Selection -----------------------------------------------------------

/** How many cards can be picked: 1 for single, `max` (or no limit) for multiple. */
export function selectionLimit(
  mode: InspirationSelectable,
  max?: number,
): number {
  if (mode === "none") return 0;
  if (mode === "single") return 1;
  return typeof max === "number" && max >= 1 ? Math.floor(max) : Infinity;
}

/**
 * The selection after toggling `id`. Single replaces the pick; multiple adds
 * until the max is reached, then ignores new picks (removing always works).
 */
export function toggleSelection(
  selected: readonly string[],
  id: string,
  mode: InspirationSelectable,
  max?: number,
): string[] {
  if (mode === "none") return [...selected];
  if (selected.includes(id)) return selected.filter((s) => s !== id);
  if (mode === "single") return [id];
  if (selected.length >= selectionLimit(mode, max)) return [...selected];
  return [...selected, id];
}

/** True when another card can't be added (multiple mode at its max). */
export function isSelectionFull(
  selected: readonly string[],
  mode: InspirationSelectable,
  max?: number,
): boolean {
  return mode === "multiple" && selected.length >= selectionLimit(mode, max);
}

/** Ids in card order, dropping any that aren't cards (stale or restored ids). */
export function orderSelection(
  selected: readonly string[],
  items: readonly { id: string }[],
): string[] {
  const set = new Set(selected);
  return items.filter((s) => set.has(s.id)).map((s) => s.id);
}

/** Footer status: "2 selected", or the instruction when nothing is picked. */
export function selectionSummary(
  count: number,
  mode: InspirationSelectable,
  max?: number,
): string {
  const limit = selectionLimit(mode, max);
  if (count === 0) {
    if (mode === "single") return "Pick one";
    return Number.isFinite(limit) ? `Pick up to ${limit}` : "Pick one or more";
  }
  const tail =
    mode === "multiple" && Number.isFinite(limit) ? ` of ${limit}` : "";
  return `${count}${tail} selected`;
}

/** "Warm oak", "Warm oak and Soft arches", or "3 ideas". */
export function chosenLabel(
  ids: readonly string[],
  items: readonly { id: string; title: string }[],
): string {
  const titles = orderSelection(ids, items).map(
    (id) => items.find((i) => i.id === id)?.title ?? id,
  );
  if (titles.length === 0) return "nothing";
  if (titles.length === 1) return titles[0];
  if (titles.length === 2) return `${titles[0]} and ${titles[1]}`;
  return `${titles.length} ideas`;
}
