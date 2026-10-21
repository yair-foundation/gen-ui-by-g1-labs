/**
 * Inline Editor: pure helpers (no React, no DOM), so they can be unit-tested.
 *
 * - layoutSection: a section's text (plain text with **bold**, *italic* and
 *   "- " lists) as blocks to render, plus a map from rendered characters back
 *   to offsets in the source text.
 * - mapRenderedRange: a selection in the rendered prose → a source range
 *   whose bold/italic markers are always balanced.
 * - toPlainText / normalizeEditedText / documentToMarkdown: markdown ⇄ plain.
 * - Edit history: setEdit, undo, resetAll, dropEdits (an undo stack).
 * - diffWords: word-level diff for "Show changes" (from Draft Options).
 * - validateField / validateSectionText.
 */

// ---- Inline markup with source offsets ----------------------------------

/**
 * `text` nodes are contiguous slices of the source: `value` equals
 * `source.slice(start, start + value.length)`. `outer` includes the markers,
 * `inner` is the formatted content.
 */
export type InlineNode =
  | { type: "text"; value: string; start: number }
  | {
      type: "strong" | "em";
      children: InlineNode[];
      outer: [number, number];
      inner: [number, number];
    };

type Stop = "**" | "*" | null;
type Parsed = { nodes: InlineNode[]; end: number; closed: boolean };

const MAX_DEPTH = 6;
const ESCAPABLE = /[\\*_-]/;

function pushNode(nodes: InlineNode[], node: InlineNode) {
  const last = nodes[nodes.length - 1];
  if (node.type === "text") {
    if (!node.value) return;
    // Merge only when the two slices touch, so offsets stay exact.
    if (
      last?.type === "text" &&
      last.start + last.value.length === node.start
    ) {
      last.value += node.value;
      return;
    }
  } else if (!node.children.length) {
    return;
  }
  nodes.push(node);
}

/** Index of a lone "*" (not part of "**") in [from, limit), or -1. */
function findSingleStar(src: string, from: number, limit: number) {
  for (let j = from; j < limit; j++) {
    if (src[j] !== "*") continue;
    if (src[j + 1] === "*") {
      j++;
      continue;
    }
    if (src[j - 1] !== "*") return j;
  }
  return -1;
}

function hasDoubleStar(src: string, from: number, limit: number) {
  const j = src.indexOf("**", from);
  return j !== -1 && j + 2 <= limit;
}

function parseRange(
  src: string,
  start: number,
  limit: number,
  stop: Stop,
  depth: number,
  partial: boolean,
): Parsed {
  // Unclosed markup is only "still streaming" at the very end of the input.
  const open = partial && limit === src.length;
  const nodes: InlineNode[] = [];
  let buf = "";
  let bufStart = start;
  const flush = () => {
    pushNode(nodes, { type: "text", value: buf, start: bufStart });
    buf = "";
  };
  const take = (from: number, length: number) => {
    if (!buf) bufStart = from;
    buf += src.slice(from, from + length);
  };

  let i = start;
  while (i < limit) {
    const ch = src[i];

    if (stop === "**" && src.startsWith("**", i)) {
      flush();
      return { nodes, end: i + 2, closed: true };
    }
    if (
      stop === "*" &&
      ch === "*" &&
      !(src.startsWith("**", i) && hasDoubleStar(src, i + 2, limit))
    ) {
      flush();
      return { nodes, end: i + 1, closed: true };
    }

    // Escapes: \* stays a literal star. The backslash isn't rendered.
    if (ch === "\\" && i + 1 < limit && ESCAPABLE.test(src[i + 1])) {
      flush();
      take(i + 1, 1);
      flush();
      i += 2;
      continue;
    }

    if (ch === "*") {
      if (src.startsWith("**", i)) {
        if (depth < MAX_DEPTH && (hasDoubleStar(src, i + 2, limit) || open)) {
          const inner = parseRange(src, i + 2, limit, "**", depth + 1, partial);
          if (inner.closed || open) {
            flush();
            pushNode(nodes, {
              type: "strong",
              children: inner.nodes,
              outer: [i, inner.end],
              inner: [i + 2, inner.closed ? inner.end - 2 : inner.end],
            });
            i = inner.end;
            continue;
          }
        }
        // A trailing "**" while streaming is the start of bold: hide it.
        if (open && i + 2 === limit) {
          flush();
          i = limit;
          continue;
        }
        take(i, 2);
        i += 2;
        continue;
      }
      const next = src[i + 1];
      if (
        depth < MAX_DEPTH &&
        next !== undefined &&
        !/\s/.test(next) &&
        (findSingleStar(src, i + 1, limit) !== -1 || open)
      ) {
        const inner = parseRange(src, i + 1, limit, "*", depth + 1, partial);
        if (inner.closed || open) {
          flush();
          pushNode(nodes, {
            type: "em",
            children: inner.nodes,
            outer: [i, inner.end],
            inner: [i + 1, inner.closed ? inner.end - 1 : inner.end],
          });
          i = inner.end;
          continue;
        }
      }
      if (open && i + 1 === limit) {
        flush();
        i = limit;
        continue;
      }
      take(i, 1);
      i++;
      continue;
    }

    take(i, 1);
    i++;
  }
  flush();
  return { nodes, end: limit, closed: false };
}

/** Inline nodes for src[start, end). Offsets are absolute in `src`. */
export function parseInline(
  src: string,
  start = 0,
  end = src.length,
  partial = false,
): InlineNode[] {
  return parseRange(src, start, end, null, 0, partial).nodes;
}

// ---- Blocks ----------------------------------------------------------------

/** A line of a paragraph, or a list item. `start` is its source offset. */
export type Line = { start: number; nodes: InlineNode[] };

export type Block =
  | { type: "paragraph"; start: number; lines: Line[] }
  | { type: "list"; start: number; ordered: boolean; items: Line[] };

/** A contiguous slice of the source that is rendered as-is. */
export type Run = { start: number; text: string };

export type SectionLayout = {
  blocks: Block[];
  /** Text runs in render order. Rendered text = runs joined, no separators. */
  runs: Run[];
  /** Every bold/italic span, for balancing selections. */
  spans: { outer: [number, number]; inner: [number, number] }[];
};

const LIST_ITEM = /^(\s*)([-*•]|\d{1,3}[.)])\s+/;

function collect(nodes: InlineNode[], layout: SectionLayout) {
  for (const n of nodes) {
    if (n.type === "text") layout.runs.push({ start: n.start, text: n.value });
    else {
      layout.spans.push({ outer: n.outer, inner: n.inner });
      collect(n.children, layout);
    }
  }
}

/**
 * Splits a section's text into paragraphs and lists. Blank lines separate
 * blocks; single line breaks inside a paragraph are kept as line breaks.
 * Pass `partial` while the text is still streaming.
 */
export function layoutSection(text: string, partial = false): SectionLayout {
  const layout: SectionLayout = { blocks: [], runs: [], spans: [] };
  if (typeof text !== "string" || !text) return layout;
  let current: Block | null = null;
  let offset = 0;
  for (const line of text.split("\n")) {
    const start = offset;
    const end = start + line.length;
    offset = end + 1;
    if (!line.trim()) {
      current = null;
      continue;
    }
    const m = LIST_ITEM.exec(line);
    if (m) {
      const ordered = /\d/.test(m[2]);
      const nodes = parseInline(text, start + m[0].length, end, partial);
      if (current?.type !== "list" || current.ordered !== ordered) {
        current = { type: "list", start, ordered, items: [] };
        layout.blocks.push(current);
      }
      current.items.push({ start, nodes });
      collect(nodes, layout);
    } else {
      const nodes = parseInline(text, start, end, partial);
      if (current?.type !== "paragraph") {
        current = { type: "paragraph", start, lines: [] };
        layout.blocks.push(current);
      }
      current.lines.push({ start, nodes });
      collect(nodes, layout);
    }
  }
  return layout;
}

/** Length of the rendered text (what Range.toString() returns for the prose). */
export function renderedLength(layout: SectionLayout) {
  return layout.runs.reduce((n, r) => n + r.text.length, 0);
}

function toSource(runs: Run[], rendered: number, edge: "start" | "end") {
  let acc = 0;
  for (const run of runs) {
    const len = run.text.length;
    // At a boundary, a start belongs to the next run and an end to this one.
    const inside =
      edge === "start"
        ? rendered >= acc && rendered < acc + len
        : rendered > acc && rendered <= acc + len;
    if (inside) return run.start + (rendered - acc);
    acc += len;
  }
  if (!runs.length) return 0;
  const lastRun = runs[runs.length - 1];
  return edge === "start" ? runs[0].start : lastRun.start + lastRun.text.length;
}

export type SourceSelection = { start: number; end: number; text: string };

/**
 * Maps a selection in the rendered prose (character offsets into the
 * rendered text) to a range of the source text. Whitespace at the edges is
 * trimmed. A bold or italic span is either fully inside the result (markers
 * included) or the selection lies within its content, so replacing the range
 * never leaves an unbalanced "**". Returns null for an empty selection.
 */
export function mapRenderedRange(
  source: string,
  layout: SectionLayout,
  renderedStart: number,
  renderedEnd: number,
): SourceSelection | null {
  const total = renderedLength(layout);
  const a = Math.max(0, Math.min(renderedStart, renderedEnd));
  const b = Math.min(total, Math.max(renderedStart, renderedEnd));
  if (b <= a) return null;
  let start = toSource(layout.runs, a, "start");
  let end = toSource(layout.runs, b, "end");
  while (start < end && /\s/.test(source[start])) start++;
  while (end > start && /\s/.test(source[end - 1])) end--;
  if (end <= start) return null;

  let changed = true;
  while (changed) {
    changed = false;
    for (const { outer, inner } of layout.spans) {
      const withinContent = start >= inner[0] && end <= inner[1];
      const touches = start < outer[1] && end > outer[0];
      if (touches && !withinContent) {
        if (outer[0] < start || outer[1] > end) {
          start = Math.min(start, outer[0]);
          end = Math.max(end, outer[1]);
          changed = true;
        }
      }
    }
  }
  return { start, end, text: source.slice(start, end) };
}

/** Replaces source[start, end) with `replacement`. */
export function replaceRange(
  source: string,
  start: number,
  end: number,
  replacement: string,
) {
  return source.slice(0, start) + replacement + source.slice(end);
}

// ---- Markdown ⇄ plain ------------------------------------------------------

function nodesToPlain(nodes: InlineNode[]): string {
  return nodes
    .map((n) => (n.type === "text" ? n.value : nodesToPlain(n.children)))
    .join("");
}

/**
 * The section as readable plain text: markers removed, list items as
 * "• item" (or "1. item"), blocks separated by a blank line.
 */
export function toPlainText(text: string): string {
  return layoutSection(text)
    .blocks.map((b) =>
      b.type === "paragraph"
        ? b.lines.map((l) => nodesToPlain(l.nodes)).join("\n")
        : b.items
            .map(
              (item, i) =>
                `${b.ordered ? `${i + 1}.` : "•"} ${nodesToPlain(item.nodes)}`,
            )
            .join("\n"),
    )
    .join("\n\n");
}

/**
 * Tidies text typed or pasted into the editor: Windows line endings, "•"
 * bullets become "- ", trailing spaces go, 3+ line breaks collapse to a
 * blank line.
 */
export function normalizeEditedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^(\s*)[•·▪]\s+/, "$1- ").replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The document as Markdown, for Copy. */
export function documentToMarkdown(
  title: string | undefined,
  sections: { heading?: string; text: string }[],
): string {
  const parts: string[] = [];
  if (title) parts.push(`# ${title.replace(/\s*\n\s*/g, " ")}`);
  for (const s of sections) {
    if (s.heading) parts.push(`## ${s.heading.replace(/\s*\n\s*/g, " ")}`);
    if (s.text.trim()) parts.push(s.text.trim());
  }
  return parts.length ? `${parts.join("\n\n")}\n` : "";
}

// ---- Edit history ----------------------------------------------------------

export type FieldValue = string | number | string[] | null;

/** One value change. `undefined` means "no edit" (the original). */
export type Change<V> = {
  id: string;
  before: V | undefined;
  after: V | undefined;
};
export type HistoryEntry<V> = {
  changes: Change<V>[];
  /** Set while typing into one field, so keystrokes undo as one edit. */
  coalesce?: string;
};
export type EditState<V> = {
  /** Only values that differ from the original. */
  edits: Record<string, V>;
  history: HistoryEntry<V>[];
};

export function emptyEditState<V>(edits: Record<string, V> = {}): EditState<V> {
  return { edits, history: [] };
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

/** The edit to store for `value`: undefined when it matches the original. */
export function editFor<V>(value: V, original: V | undefined): V | undefined {
  return valuesEqual(value, original) ? undefined : value;
}

function withValue<V>(edits: Record<string, V>, id: string, v: V | undefined) {
  const next = { ...edits };
  if (v === undefined) delete next[id];
  else next[id] = v;
  return next;
}

/**
 * Records an edit. With `coalesce`, consecutive changes to the same id merge
 * into one history entry (typing), until `sealHistory` is called.
 */
export function setEdit<V>(
  state: EditState<V>,
  id: string,
  next: V | undefined,
  options: { coalesce?: boolean } = {},
): EditState<V> {
  const before = id in state.edits ? state.edits[id] : undefined;
  if (valuesEqual(before, next)) return state;
  const edits = withValue(state.edits, id, next);
  const last = state.history[state.history.length - 1];
  if (options.coalesce && last?.coalesce === id) {
    const merged = { ...last.changes[0], after: next };
    const history = state.history.slice(0, -1);
    // Typed back to where the entry started: nothing to undo any more.
    if (!valuesEqual(merged.before, merged.after)) {
      history.push({ changes: [merged], coalesce: id });
    }
    return { edits, history };
  }
  return {
    edits,
    history: [
      ...state.history,
      {
        changes: [{ id, before, after: next }],
        coalesce: options.coalesce ? id : undefined,
      },
    ],
  };
}

/** Ends the current typing run, so the next keystroke starts a new undo step. */
export function sealHistory<V>(state: EditState<V>): EditState<V> {
  const last = state.history[state.history.length - 1];
  if (!last?.coalesce) return state;
  return {
    ...state,
    history: [...state.history.slice(0, -1), { changes: last.changes }],
  };
}

/** Reverts the last history entry. */
export function undo<V>(state: EditState<V>): EditState<V> {
  const last = state.history[state.history.length - 1];
  if (!last) return state;
  let edits = state.edits;
  for (const c of [...last.changes].reverse()) {
    edits = withValue(edits, c.id, c.before);
  }
  return { edits, history: state.history.slice(0, -1) };
}

/** Reverts every edit, as one undoable step. */
export function resetAll<V>(state: EditState<V>): EditState<V> {
  const ids = Object.keys(state.edits);
  if (!ids.length) return state;
  return {
    edits: {},
    history: [
      ...state.history,
      {
        changes: ids.map((id) => ({
          id,
          before: state.edits[id],
          after: undefined,
        })),
      },
    ],
  };
}

/**
 * Forgets an id entirely: its edit and its history. Used when the agent
 * replaces a section (a rewrite), so undo never brings back the old text.
 */
export function dropEdits<V>(state: EditState<V>, id: string): EditState<V> {
  if (
    !(id in state.edits) &&
    !state.history.some((e) => e.changes.some((c) => c.id === id))
  ) {
    return state;
  }
  return {
    edits: withValue(state.edits, id, undefined),
    history: state.history
      .map((e) => ({ ...e, changes: e.changes.filter((c) => c.id !== id) }))
      .filter((e) => e.changes.length > 0),
  };
}

/** Edited ids, in the given display order. */
export function editedIds<V>(state: EditState<V>, order: string[]): string[] {
  return order.filter((id) => id in state.edits);
}

// ---- Validation ------------------------------------------------------------

export type FieldRules = {
  type?: "text" | "textarea" | "number" | "select" | "tags";
  required?: boolean;
  maxLength?: number;
  options?: string[];
};

/** Characters used (text fields) or tags used (tags); null when not counted. */
export function fieldLength(
  field: FieldRules,
  value: FieldValue,
): number | null {
  if (field.type === "tags") return Array.isArray(value) ? value.length : 0;
  if (field.type === "text" || field.type === "textarea" || !field.type) {
    return typeof value === "string" ? value.length : 0;
  }
  return null;
}

export function isEmptyValue(value: FieldValue | undefined) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === "number" && Number.isNaN(value);
}

/** An error message for the field, or null when it is valid. */
export function validateField(
  field: FieldRules,
  value: FieldValue | undefined,
): string | null {
  if (isEmptyValue(value)) {
    return field.required
      ? field.type === "tags"
        ? "Add at least one tag."
        : "Required."
      : null;
  }
  switch (field.type) {
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? null
        : "Enter a number.";
    case "select":
      return field.options?.length &&
        typeof value === "string" &&
        !field.options.includes(value)
        ? "Choose one of the options."
        : null;
    case "tags": {
      const n = Array.isArray(value) ? value.length : 0;
      return field.maxLength !== undefined && n > field.maxLength
        ? `Use up to ${field.maxLength} ${field.maxLength === 1 ? "tag" : "tags"}.`
        : null;
    }
    default: {
      const n = typeof value === "string" ? value.length : 0;
      return field.maxLength !== undefined && n > field.maxLength
        ? `Keep it to ${field.maxLength} characters (${n - field.maxLength} over).`
        : null;
    }
  }
}

export function validateSectionText(text: string): string | null {
  return text.trim() ? null : "A section can't be empty.";
}

/** Adds tags from typed or pasted text ("a, b"), skipping duplicates. */
export function addTags(tags: string[], input: string): string[] {
  const next = [...tags];
  for (const raw of input.split(",")) {
    const tag = raw.trim().replace(/\s+/g, " ");
    if (tag && !next.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      next.push(tag);
    }
  }
  return next;
}

// ---- Word diff (from Draft Options) ----------------------------------------

export type DiffPart = {
  type: "equal" | "added" | "removed";
  text: string;
};

type Token = { lead: string; word: string; isBreak?: boolean };

/** Above this many token pairs, skip the LCS and mark the whole text changed. */
const MAX_CELLS = 400_000;

const WORDISH = /[\p{L}\p{N}]/u;
const TOKEN = /(\s*)([\p{L}\p{N}][\p{L}\p{N}\p{M}'’-]*|\S)/gu;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const [, lead, word] of text.trim().matchAll(TOKEN)) {
    if (lead.includes("\n")) {
      const breaks = lead.split("\n").length - 1;
      tokens.push({
        lead: "",
        word: breaks > 1 ? "\n\n" : "\n",
        isBreak: true,
      });
      tokens.push({ lead: "", word });
    } else {
      tokens.push({ lead, word });
    }
  }
  return tokens;
}

/** Number of words (not punctuation) in a text. */
export function countWords(text: string): number {
  return tokenize(text).filter((t) => WORDISH.test(t.word)).length;
}

function diffTokens(a: Token[], b: Token[]) {
  const ops: { type: DiffPart["type"]; token: Token }[] = [];
  if (a.length * b.length > MAX_CELLS) {
    for (const token of a) ops.push({ type: "removed", token });
    for (const token of b) ops.push({ type: "added", token });
    return ops;
  }
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i].word === b[j].word
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].word === b[j].word) {
      ops.push({
        type: "equal",
        token: { ...b[j], lead: b[j].lead || a[i].lead },
      });
      i++;
      j++;
    } else if (
      j >= b.length ||
      (i < a.length && lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])
    ) {
      ops.push({ type: "removed", token: a[i] });
      i++;
    } else {
      ops.push({ type: "added", token: b[j] });
      j++;
    }
  }
  return ops;
}

/**
 * Word-level diff. Whitespace never sits inside an added or removed part, so
 * changed runs can be styled without underlining spaces. Render the parts in
 * order with `white-space: pre-wrap`.
 */
export function diffWords(before: string, after: string): DiffPart[] {
  const parts: DiffPart[] = [];
  const last = () => parts[parts.length - 1];
  const isSpace = (p?: DiffPart): p is DiffPart =>
    p !== undefined && p.type === "equal" && /^\s+$/.test(p.text);

  const pushSpace = (ws: string) => {
    if (!ws || parts.length === 0) return;
    const prev = last();
    if (!isSpace(prev)) parts.push({ type: "equal", text: ws });
    else if (ws.includes("\n") && ws.length > prev.text.length) prev.text = ws;
    else if (ws.includes("\n") && !prev.text.includes("\n")) prev.text = ws;
  };

  for (const { type, token } of diffTokens(tokenize(before), tokenize(after))) {
    if (token.isBreak) {
      pushSpace(type === "removed" ? " " : token.word);
      continue;
    }
    pushSpace(token.lead);

    const prev = last();
    const beforePrev = parts[parts.length - 2];
    if (prev && prev.type === type) {
      prev.text += token.word;
    } else if (
      prev &&
      type !== "equal" &&
      prev.type !== "equal" &&
      WORDISH.test(prev.text.slice(-1)) &&
      WORDISH.test(token.word[0])
    ) {
      parts.push({ type: "equal", text: " " }, { type, text: token.word });
    } else if (
      type !== "equal" &&
      isSpace(prev) &&
      beforePrev?.type === type &&
      !prev.text.includes("\n")
    ) {
      beforePrev.text += prev.text + token.word;
      parts.pop();
    } else if (type === "equal" && isSpace(prev)) {
      prev.text += token.word;
    } else {
      parts.push({ type, text: token.word });
    }
  }

  while (isSpace(last())) parts.pop();
  return parts.reduce<DiffPart[]>((out, p) => {
    const prev = out[out.length - 1];
    if (prev && prev.type === "equal" && p.type === "equal")
      prev.text += p.text;
    else out.push({ ...p });
    return out;
  }, []);
}

/** Counts of added and removed words, for screen reader summaries. */
export function diffStats(parts: DiffPart[]) {
  let added = 0;
  let removed = 0;
  for (const p of parts) {
    if (p.type === "added") added += countWords(p.text);
    if (p.type === "removed") removed += countWords(p.text);
  }
  return { added, removed };
}

export const plural = (n: number, word: string) =>
  `${n} ${word}${n === 1 ? "" : "s"}`;
