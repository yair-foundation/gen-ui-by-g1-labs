/*
 * Syntax colours for code shown in GenUI components: small tokenizers for
 * SQL and JSON (other code stays plain), the convention colours, and the grey
 * surface code sits on. Shared by Artifact Preview, Article and any component
 * that shows code.
 */


export type TokenType =
  | "keyword"
  | "function"
  | "string"
  | "number"
  | "literal"
  | "comment"
  | "key"
  | "punctuation"
  | "plain"
export type Token = { type: TokenType; text: string }
export type CodeLanguage = "sql" | "json"

/** Which highlighter applies, from the kind, language label and file name. */
export function codeLanguage(
  kind: string | undefined,
  language: string | undefined,
  name: string | undefined,
): CodeLanguage | null {
  if (kind === "json" || /^json/i.test(language ?? "") || /\.json$/i.test(name ?? "")) return "json"
  if (/sql/i.test(language ?? "") || /\.sql$/i.test(name ?? "")) return "sql"
  return null
}

const SQL_KEYWORDS = new Set(
  (
    "select from where and or not in is null as on join left right inner outer full cross " +
    "group by order having limit offset with union all distinct case when then else end " +
    "insert into values update set delete create table view index drop alter add column " +
    "primary key foreign references default unique check between like ilike exists asc desc " +
    "over partition window filter returning using natural lateral recursive interval true false"
  ).split(" "),
)
const SQL_LITERALS = new Set(["null", "true", "false"])

/** Token rules, tried in order at each position; the first match wins. */
type Rule = { re: RegExp; type: (match: string, after: string) => TokenType }

const SQL_RULES: Rule[] = [
  { re: /^'(?:[^']|'')*'?/, type: () => "string" },
  { re: /^"(?:[^"]|"")*"?/, type: () => "plain" },
  { re: /^\d+(?:\.\d+)?(?![A-Za-z_])/, type: () => "number" },
  {
    re: /^[A-Za-z_][A-Za-z0-9_]*/,
    type: (word, after) => {
      const lower = word.toLowerCase()
      if (SQL_LITERALS.has(lower)) return "literal"
      if (SQL_KEYWORDS.has(lower)) return "keyword"
      return /^\s*\(/.test(after) ? "function" : "plain"
    },
  },
  { re: /^[(),;.*=<>!+\-/%|:]+/, type: () => "punctuation" },
]

const JSON_RULES: Rule[] = [
  { re: /^"(?:[^"\\]|\\.)*"?/, type: (_, after) => (/^\s*:/.test(after) ? "key" : "string") },
  { re: /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, type: () => "number" },
  { re: /^(?:true|false|null)\b/, type: () => "literal" },
  { re: /^[{}[\],:]/, type: () => "punctuation" },
]

/** Splits `line` (from `start`) into tokens with `rules`, merging neighbours of one type. */
function tokenizeWith(line: string, rules: Rule[], tokens: Token[], start = 0): Token[] {
  const push = (type: TokenType, text: string) => {
    const last = tokens[tokens.length - 1]
    if (last && last.type === type) last.text += text
    else tokens.push({ type, text })
  }
  let i = start
  while (i < line.length) {
    const rest = line.slice(i)
    let used = 0
    for (const rule of rules) {
      const m = rest.match(rule.re)
      if (m?.[0]) {
        push(rule.type(m[0], rest.slice(m[0].length)), m[0])
        used = m[0].length
        break
      }
    }
    if (!used) {
      push("plain", rest[0])
      used = 1
    }
    i += used
  }
  return tokens
}

/**
 * SQL tokens for one line. `inComment` carries a /* … *\/ block across
 * lines; the returned flag says whether the line ends inside one.
 */
export function tokenizeSql(line: string, inComment = false): { tokens: Token[]; inComment: boolean } {
  const tokens: Token[] = []
  let code = ""
  let comment = inComment
  let i = 0
  // Comments first (they can hide anything), the rest through the rules.
  const flush = () => {
    if (code) tokenizeWith(code, SQL_RULES, tokens)
    code = ""
  }
  while (i < line.length) {
    if (comment) {
      const end = line.indexOf("*/", i)
      const stop = end === -1 ? line.length : end + 2
      tokens.push({ type: "comment", text: line.slice(i, stop) })
      i = stop
      comment = end === -1
    } else if (line.startsWith("--", i) && !inString(code)) {
      flush()
      tokens.push({ type: "comment", text: line.slice(i) })
      i = line.length
    } else if (line.startsWith("/*", i) && !inString(code)) {
      flush()
      comment = true
    } else {
      code += line[i]
      i++
    }
  }
  flush()
  return { tokens, inComment: comment }
}

/** Whether SQL text so far ends inside an open single-quoted string. */
function inString(code: string): boolean {
  return ((code.match(/'/g) ?? []).length % 2) === 1
}

/** JSON tokens for one line of (pretty-printed or raw) JSON. */
export function tokenizeJson(line: string): Token[] {
  return tokenizeWith(line, JSON_RULES, [])
}

/** Tokens for every line of a file in one of the highlighted languages. */
export function tokenizeLines(lines: readonly string[], lang: CodeLanguage): Token[][] {
  if (lang === "json") return lines.map(tokenizeJson)
  let inComment = false
  return lines.map((line) => {
    const out = tokenizeSql(line, inComment)
    inComment = out.inComment
    return out.tokens
  })
}

/*
 * Colours after the usual editor conventions: keywords and JSON keys blue,
 * functions teal, strings green, numbers orange, true/false/null rose,
 * comments and punctuation muted. Darker steps on light cards, lighter on
 * dark, all at least 4.5:1 against the code surface. Never violet: that's
 * reserved for selection.
 */
export const TOKEN_CLASS: Record<TokenType, string> = {
  keyword: "text-sky-700 dark:text-sky-300",
  key: "text-sky-700 dark:text-sky-300",
  function: "text-teal-700 dark:text-teal-300",
  string: "text-emerald-700 dark:text-emerald-300",
  number: "text-orange-700 dark:text-orange-300",
  literal: "text-rose-700 dark:text-rose-300",
  comment: "text-muted-foreground italic",
  punctuation: "text-muted-foreground",
  plain: "",
}

/**
 * The surface code sits on: a clear editor grey on dark cards, a faint grey
 * on light ones. Sets `--scroller-bg`, so a ScrollFade's side fades and a
 * sticky line-number gutter can match it.
 */
export const CODE_BG =
  "[--scroller-bg:color-mix(in_oklab,var(--card),var(--foreground)_5%)] dark:[--scroller-bg:color-mix(in_oklab,var(--card),white_20%)] bg-[var(--scroller-bg)]"
