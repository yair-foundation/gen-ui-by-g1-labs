import type { StylePin } from "./style-board.schema";

export const MAX_PINS = 12;
export const MAX_FILTERS = 5;
/** Used when a pin gives no aspect: a gentle 4:5 portrait. */
export const DEFAULT_ASPECT = 0.8;
/** The caption under an image, as a share of the pin's width, for balancing columns. */
const CAPTION_WEIGHT = 0.3;

/** http(s) only; anything else is dropped. */
export function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Image src: http(s), or a same-origin path with a single leading slash. */
export function safeImageSrc(src: unknown): string | null {
  if (typeof src !== "string") return null;
  const s = src.trim();
  if (/^\/(?![/\\])/.test(s)) return s;
  return safeHttpUrl(s);
}

/** The pin's width over height, clamped; a missing or bad value falls back. */
export function pinAspect(aspect: unknown): number {
  if (typeof aspect !== "number" || !Number.isFinite(aspect) || aspect <= 0) {
    return DEFAULT_ASPECT;
  }
  return Math.min(1.6, Math.max(0.5, aspect));
}

/** A pin as it may arrive while the tool call streams. */
export type PartialPin = Partial<Omit<StylePin, "image">> & {
  image?: Partial<StylePin["image"]>;
};

/** Only pins that are complete enough to draw; while streaming, partial ones wait. */
export function readyPins(pins: readonly PartialPin[] | undefined): StylePin[] {
  const out: StylePin[] = [];
  const seen = new Set<string>();
  for (const p of pins ?? []) {
    if (
      typeof p?.id !== "string" ||
      seen.has(p.id) ||
      typeof p.title !== "string" ||
      typeof p.image?.src !== "string" ||
      typeof p.image.alt !== "string"
    ) {
      continue;
    }
    seen.add(p.id);
    out.push({
      id: p.id,
      title: p.title,
      image: {
        src: p.image.src,
        alt: p.image.alt,
        ...(typeof p.image.aspect === "number" ? { aspect: p.image.aspect } : {}),
      },
      ...(p.price ? { price: p.price } : {}),
      ...(p.category ? { category: p.category } : {}),
      ...(p.url ? { url: p.url } : {}),
    });
    if (out.length === MAX_PINS) break;
  }
  return out;
}

/** The categories in first-seen order, capped so the filter row stays one short row. */
export function categoriesOf(pins: readonly StylePin[]): string[] {
  const out: string[] = [];
  for (const p of pins) {
    const c = p.category?.trim();
    if (c && !out.includes(c)) out.push(c);
  }
  return out.slice(0, MAX_FILTERS - 1);
}

/** The pins to show for a filter; null means all. */
export function filterPins(
  pins: readonly StylePin[],
  category: string | null,
): StylePin[] {
  if (!category) return [...pins];
  return pins.filter((p) => p.category?.trim() === category);
}

/** How many columns fit: the requested count, but 2 on narrow containers. */
export function boardColumns(requested: unknown, width: number | null): 2 | 3 {
  const want = requested === 2 ? 2 : 3;
  if (width !== null && width < 460) return 2;
  return want;
}

/**
 * Lays pins into columns like a masonry board: each pin, in reading order,
 * goes to the currently shortest column (the left one on a tie). Heights come
 * from each pin's aspect plus a fixed caption, so the columns end level and
 * earlier pins never move when later ones stream in.
 */
export function distribute(
  pins: readonly StylePin[],
  columns: number,
): StylePin[][] {
  const count = Math.max(1, Math.floor(columns));
  const cols: StylePin[][] = Array.from({ length: count }, () => []);
  const heights = new Array<number>(count).fill(0);
  for (const pin of pins) {
    let target = 0;
    for (let i = 1; i < count; i++) {
      if (heights[i] < heights[target]) target = i;
    }
    cols[target].push(pin);
    heights[target] += 1 / pinAspect(pin.image.aspect) + CAPTION_WEIGHT;
  }
  return cols;
}

/** Adds or removes an id. */
export function toggleSaved(saved: readonly string[], id: string): string[] {
  return saved.includes(id) ? saved.filter((s) => s !== id) : [...saved, id];
}

/** Saved ids in board order, dropping any that aren't on the board. */
export function orderSaved(
  saved: readonly string[],
  pins: readonly StylePin[],
): string[] {
  return pins.filter((p) => saved.includes(p.id)).map((p) => p.id);
}

/** "3 looks saved", or the empty instruction. */
export function savedSummary(count: number): string {
  if (count === 0) return "Tap the heart on the looks you like";
  return `${count} ${count === 1 ? "look" : "looks"} saved`;
}

/** "Saved Linen trench and Denim layers" for the locked footer. */
export function savedLabel(
  ids: readonly string[],
  pins: readonly StylePin[],
): string {
  const titles = ids
    .map((id) => pins.find((p) => p.id === id)?.title)
    .filter((t): t is string => Boolean(t));
  if (titles.length === 0) return "nothing";
  if (titles.length <= 2) return titles.join(" and ");
  return `${titles.slice(0, 2).join(", ")} and ${titles.length - 2} more`;
}
