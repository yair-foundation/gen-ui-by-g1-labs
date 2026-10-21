/**
 * Word-level diff for draft rewrites. Pure, no dependencies.
 *
 *   diffWords("Run farther for less", "Run farther with less effort")
 *   // equal "Run farther ", removed "for", equal " ", added "with",
 *   // equal " less ", added "effort"
 *
 * Words and punctuation are separate tokens, so "effort." vs "effort!" only
 * marks the punctuation. Line breaks are tokens too, so paragraphs line up.
 * Whitespace is never inside an added or removed part: it lives in "equal"
 * parts, so a renderer can style changed runs without underlining spaces.
 * Render the parts in order with `white-space: pre-wrap`.
 */

export type DiffPart = {
  type: "equal" | "added" | "removed"
  text: string
}

type Token = { lead: string; word: string; isBreak?: boolean }

/** Above this many token pairs, skip the LCS and mark the whole text changed. */
const MAX_CELLS = 400_000

const WORDISH = /[\p{L}\p{N}]/u
const TOKEN = /(\s*)([\p{L}\p{N}][\p{L}\p{N}\p{M}'’-]*|\S)/gu

export function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  for (const [, lead, word] of text.trim().matchAll(TOKEN)) {
    if (lead.includes("\n")) {
      // One break token per gap: a paragraph break or a single line break.
      const breaks = lead.split("\n").length - 1
      tokens.push({ lead: "", word: breaks > 1 ? "\n\n" : "\n", isBreak: true })
      tokens.push({ lead: "", word })
    } else {
      tokens.push({ lead, word })
    }
  }
  return tokens
}

/** Number of words (not punctuation) in a text. */
export function countWords(text: string): number {
  return tokenize(text).filter((t) => WORDISH.test(t.word)).length
}

function diffTokens(a: Token[], b: Token[]) {
  const ops: { type: DiffPart["type"]; token: Token }[] = []
  if (a.length * b.length > MAX_CELLS) {
    for (const token of a) ops.push({ type: "removed", token })
    for (const token of b) ops.push({ type: "added", token })
    return ops
  }
  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:].
  const width = b.length + 1
  const lcs = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i].word === b[j].word
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i].word === b[j].word) {
      // Keep the old spacing when the new text starts right after a removal.
      ops.push({
        type: "equal",
        token: { ...b[j], lead: b[j].lead || a[i].lead },
      })
      i++
      j++
    } else if (
      j >= b.length ||
      (i < a.length && lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])
    ) {
      // Removals first, so a replaced phrase reads "old" then "new".
      ops.push({ type: "removed", token: a[i] })
      i++
    } else {
      ops.push({ type: "added", token: b[j] })
      j++
    }
  }
  return ops
}

export function diffWords(before: string, after: string): DiffPart[] {
  const parts: DiffPart[] = []
  const last = () => parts[parts.length - 1]
  const isSpace = (p?: DiffPart): p is DiffPart =>
    p !== undefined && p.type === "equal" && /^\s+$/.test(p.text)

  /** Adds whitespace between tokens: never doubled; a line break wins. */
  const pushSpace = (ws: string) => {
    if (!ws || parts.length === 0) return
    const prev = last()
    if (!isSpace(prev)) parts.push({ type: "equal", text: ws })
    else if (ws.includes("\n") && ws.length > prev.text.length) prev.text = ws
    else if (ws.includes("\n") && !prev.text.includes("\n")) prev.text = ws
  }

  for (const { type, token } of diffTokens(tokenize(before), tokenize(after))) {
    if (token.isBreak) {
      // A removed line break isn't shown: the new text's layout wins.
      pushSpace(type === "removed" ? " " : token.word)
      continue
    }
    pushSpace(token.lead)

    const prev = last()
    const beforePrev = parts[parts.length - 2]
    if (prev && prev.type === type) {
      prev.text += token.word
    } else if (
      prev &&
      type !== "equal" &&
      prev.type !== "equal" &&
      WORDISH.test(prev.text.slice(-1)) &&
      WORDISH.test(token.word[0])
    ) {
      // "Hi" → "Hello" at the very start has no space between the two runs.
      parts.push({ type: "equal", text: " " }, { type, text: token.word })
    } else if (
      type !== "equal" &&
      isSpace(prev) &&
      beforePrev?.type === type &&
      !prev.text.includes("\n")
    ) {
      // Join a run of changed words across the single space between them.
      beforePrev.text += prev.text + token.word
      parts.pop()
    } else if (type === "equal" && isSpace(prev)) {
      prev.text += token.word
    } else {
      parts.push({ type, text: token.word })
    }
  }

  // Drop trailing whitespace and merge neighbouring equal parts.
  while (isSpace(last())) parts.pop()
  return parts.reduce<DiffPart[]>((out, p) => {
    const prev = out[out.length - 1]
    if (prev && prev.type === "equal" && p.type === "equal") prev.text += p.text
    else out.push({ ...p })
    return out
  }, [])
}

/** Counts of added and removed words, for screen reader summaries. */
export function diffStats(parts: DiffPart[]) {
  let added = 0
  let removed = 0
  for (const p of parts) {
    if (p.type === "added") added += countWords(p.text)
    if (p.type === "removed") removed += countWords(p.text)
  }
  return { added, removed }
}
