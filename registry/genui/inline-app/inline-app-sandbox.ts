import { FIGURE_FONT_DATA_URI } from "./inline-app-figure-font"
/**
 * Inline App sandbox: the pure parts, shared by the component and its tests.
 *
 * - `buildInlineAppDoc` turns the agent's HTML into a full document: a CSP
 *   meta first, then theme variables, base styles and a small bootstrap
 *   script, then the agent's markup.
 * - `parseInlineAppMessage` is the only gate between the frame and the host:
 *   a closed set of message shapes, clamped and size-limited.
 */

import { INLINE_APP_MAX_HTML, type InlineAppValue } from "./inline-app.schema";

/** The only sandbox token. Never add allow-same-origin, forms, popups, modals or top navigation. */
export const INLINE_APP_SANDBOX = "allow-scripts";

/** No network, no eval, no external anything. Inline scripts and styles only. */
export const INLINE_APP_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** Height the frame may report, in px. */
export const INLINE_APP_MIN_HEIGHT = 80;
export const INLINE_APP_MAX_HEIGHT = 1200;
/** Largest `genui.send` payload, in UTF-8 bytes of its JSON. */
export const INLINE_APP_MAX_RESULT_BYTES = 4096;
/** At most one result message per this many ms. */
export const INLINE_APP_RESULT_INTERVAL_MS = 500;
/** Default height hint before the app reports its own. */
export const INLINE_APP_DEFAULT_HEIGHT = 240;

export const INLINE_APP_MESSAGE = {
  resize: "genui:resize",
  result: "genui:result",
  error: "genui:error",
  theme: "genui:theme",
} as const;

/** Host tokens mirrored into the frame as CSS variables. */
export const INLINE_APP_TOKENS = [
  "--background",
  "--foreground",
  "--card",
  "--muted",
  "--muted-foreground",
  "--border",
  "--primary",
  "--primary-foreground",
  "--brand",
  "--ring",
  "--radius",
] as const;

export type InlineAppToken = (typeof INLINE_APP_TOKENS)[number];

export type InlineAppTheme = {
  scheme: "light" | "dark";
  tokens: Partial<Record<InlineAppToken, string>>;
};

/** Used when the host has no tokens (tests, a bare page). */
export const INLINE_APP_FALLBACK_THEME: InlineAppTheme = {
  scheme: "light",
  tokens: {
    // Halaska light palette, as in the theme CSS (global.css).
    "--background": "#fafafa",
    "--foreground": "#3d3d3d",
    "--card": "#ffffff",
    "--muted": "rgb(0 0 0 / 0.06)",
    "--muted-foreground": "#5d5d5d",
    "--border": "#e5e5e5",
    "--primary": "#121212",
    "--primary-foreground": "#f3f3f3",
    "--brand": "#121212",
    "--ring": "#262626",
    "--radius": "1rem",
  },
};

/**
 * A token value is a colour or length: letters, digits and `# . , % ( ) / + -`
 * and spaces. No quotes, colons, semicolons, braces or angle brackets, so it
 * can't close the rule, the style element or reach a URL.
 */
const SAFE_TOKEN_VALUE = /^[a-zA-Z0-9#.,%()\s/+-]{1,64}$/;
const UNSAFE_TOKEN_WORD = /url|image|expression|attr|import/i;

export function isSafeTokenValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SAFE_TOKEN_VALUE.test(value) &&
    !UNSAFE_TOKEN_WORD.test(value)
  );
}

/** Keeps only known tokens with safe values. */
export function sanitizeThemeTokens(
  raw: Record<string, unknown>,
): InlineAppTheme["tokens"] {
  const out: InlineAppTheme["tokens"] = {};
  for (const key of INLINE_APP_TOKENS) {
    const value = typeof raw[key] === "string" ? raw[key].trim() : undefined;
    if (isSafeTokenValue(value)) out[key] = value;
  }
  return out;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** `:root { color-scheme; --tokens }`, with fallbacks for anything missing. */
export function themeCss(theme: InlineAppTheme): string {
  const tokens = {
    ...INLINE_APP_FALLBACK_THEME.tokens,
    ...sanitizeThemeTokens(theme.tokens),
  };
  const scheme = theme.scheme === "dark" ? "dark" : "light";
  const vars = INLINE_APP_TOKENS.map((k) => `${k}:${tokens[k]}`).join(";");
  return `:root{color-scheme:${scheme};${vars}}`;
}

/**
 * Base styles, all inside `:where()` so any rule the app writes wins. Plain
 * buttons, inputs and sliders look like the host's with no CSS at all.
 */
export const INLINE_APP_BASE_CSS = `
@font-face{font-family:"InstrumentFigure";src:url(${FIGURE_FONT_DATA_URI}) format("woff2");font-weight:400;font-style:normal;font-display:block}
:root{--figure:"InstrumentFigure",ui-serif,Georgia,serif}
:where(*,*::before,*::after){box-sizing:border-box}
:where(html){-webkit-text-size-adjust:100%;overflow:hidden}
:where(body){margin:0;padding:12px;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--foreground);background:var(--card);-webkit-font-smoothing:antialiased}
:where(h1,h2,h3,h4){margin:0 0 .5em;font-weight:600;letter-spacing:-.01em;line-height:1.2}
:where(h1){font-size:1.5rem}:where(h2){font-size:1.125rem}:where(h3,h4){font-size:1rem}
:where(p){margin:0 0 .75em}
:where(small,.muted){color:var(--muted-foreground);font-size:13px}
:where(.display,.figure){font-family:var(--figure);font-size:2.5rem;font-weight:400;letter-spacing:-.01em;line-height:1.05;font-variant-numeric:lining-nums tabular-nums}
:where(.stack){display:flex;flex-direction:column;gap:12px}
:where(.row){display:flex;align-items:center;gap:8px}
:where(.spread){display:flex;align-items:center;justify-content:space-between;gap:12px}
:where(output,.num){font-variant-numeric:tabular-nums}
:where(img,svg,canvas,video){display:block;max-width:100%}
:where(a){color:inherit;text-underline-offset:2px}
:where(label,.label){font-size:13px;font-weight:400;line-height:1.55;color:var(--muted-foreground)}
:where(.sections){display:flex;flex-direction:column;margin:-12px}
:where(.sections>*){padding:12px}
:where(.sections>*+*){border-top:1px solid var(--border)}
:where(.pair){display:grid;grid-template-columns:1fr 1fr;padding:0!important}
:where(.pair>*){display:flex;flex-direction:column;gap:8px;padding:12px;min-width:0}
:where(.pair>*+*){border-left:1px solid var(--border)}
:where(button){display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:0 12px;border:1px solid transparent;border-radius:6px;background:light-dark(var(--primary),rgb(255 255 255/.14));color:light-dark(var(--primary-foreground),var(--foreground));font-family:inherit;font-size:13px;font-weight:500;line-height:1;cursor:pointer;transition:opacity .15s}
:where(button.secondary,button[data-variant=secondary]){background:transparent;border-color:light-dark(var(--border),rgb(255 255 255/.25));color:var(--foreground)}
:where(button.secondary:hover,button[data-variant=secondary]:hover){background:light-dark(var(--muted),rgb(255 255 255/.08))}
:where(button.icon){width:32px;min-height:32px;padding:0;border-radius:999px}
:where(button:disabled){opacity:.5;cursor:default}
:where(input:not([type=range]):not([type=checkbox]):not([type=radio]),select,textarea){width:100%;min-height:36px;padding:6px 12px;border:1px solid var(--border);border-radius:8px;background:transparent;color:var(--foreground);font:inherit}
:where(textarea){min-height:80px;resize:vertical}
:where(input[type=checkbox],input[type=radio]){width:18px;height:18px;margin:0;accent-color:var(--primary)}
:where(input[type=range]){--fill-color:light-dark(#8b5cf6,#a78bfa);-webkit-appearance:none;appearance:none;width:100%;height:24px;margin:0;background:transparent;cursor:pointer}
:where(input[type=range])::-webkit-slider-runnable-track{height:4px;border-radius:999px;background:linear-gradient(to right,var(--fill-color) var(--fill,0%),var(--muted) var(--fill,0%))}
:where(input[type=range])::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:24px;margin-top:-10px;border-radius:999px;background:var(--brand)}
:where(input[type=range])::-moz-range-track{height:4px;border-radius:999px;background:var(--muted)}
:where(input[type=range])::-moz-range-progress{height:4px;border-radius:999px;background:var(--fill-color)}
:where(input[type=range])::-moz-range-thumb{width:12px;height:24px;border:0;border-radius:999px;background:var(--brand)}
:where(.field){display:flex;flex-direction:column;gap:8px}
:where(.stepper){display:flex;align-items:center;justify-content:space-between;gap:8px}
:where(.stepper output){flex:1;text-align:center;font-family:var(--figure);font-size:24px;line-height:1}
:where(.slider){display:flex;align-items:center;gap:12px}
:where(.value){min-width:2rem;text-align:right;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums;color:var(--muted-foreground)}
:where(button,input,select,textarea,a,[tabindex]):focus-visible{outline:2px solid var(--ring);outline-offset:2px}
:where(.sr-only){position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media (prefers-reduced-motion:reduce){:where(*,*::before,*::after){animation-duration:.01ms!important;transition-duration:.01ms!important}}
`
  .trim()
  .replace(/\n/g, "");

/**
 * Runs before the app's code: reports height, reports errors, exposes
 * `window.genui.send(value)` and applies theme updates from the host.
 */
export function inlineAppBootstrap(): string {
  const keys = JSON.stringify(INLINE_APP_TOKENS);
  const safe = JSON.stringify(SAFE_TOKEN_VALUE.source);
  const unsafe = JSON.stringify(UNSAFE_TOKEN_WORD.source);
  const M = INLINE_APP_MESSAGE;
  return `(function(){
var P=window.parent,root=document.documentElement,last=-1;
var KEYS=${keys},SAFE=new RegExp(${safe}),UNSAFE=new RegExp(${unsafe},"i");
function post(m){try{P.postMessage(m,"*")}catch(e){}}
function measure(){var h=Math.ceil(root.getBoundingClientRect().height);if(h===last)return;last=h;root.style.overflowY=h>${INLINE_APP_MAX_HEIGHT}?"auto":"hidden";post({type:"${M.resize}",height:h})}
function theme(d){var t=d.tokens||{};for(var i=0;i<KEYS.length;i++){var v=t[KEYS[i]];if(typeof v==="string"&&SAFE.test(v)&&!UNSAFE.test(v))root.style.setProperty(KEYS[i],v)}if(d.scheme==="dark"||d.scheme==="light")root.style.colorScheme=d.scheme}
window.addEventListener("message",function(e){if(e.source!==P)return;var d=e.data;if(d&&d.type==="${M.theme}")theme(d)});
function fill(el){var mn=+el.min||0,mx=el.max===""?100:+el.max,v=+el.value;el.style.setProperty("--fill",(mx>mn?(v-mn)/(mx-mn)*100:0)+"%")}
function fillAll(){var r=document.querySelectorAll("input[type=range]");for(var i=0;i<r.length;i++)fill(r[i])}
document.addEventListener("input",function(e){var t=e.target;if(t&&t.type==="range")fill(t)},true);
document.addEventListener("DOMContentLoaded",fillAll);window.addEventListener("load",fillAll);
function fail(msg){post({type:"${M.error}",message:String(msg||"Error").slice(0,200)})}
window.addEventListener("error",function(e){fail(e.message)});
window.addEventListener("unhandledrejection",function(e){var r=e.reason;fail(r&&r.message?r.message:r)});
function send(v){var c;try{c=JSON.parse(JSON.stringify(v))}catch(e){fail("genui.send: value is not JSON");return false}if(c===undefined){fail("genui.send: value is not JSON");return false}post({type:"${M.result}",value:c});return true}
try{Object.defineProperty(window,"genui",{value:Object.freeze({send:send}),writable:false,configurable:false})}catch(e){}
function start(){measure();if(window.ResizeObserver){var ro=new ResizeObserver(measure);ro.observe(root);if(document.body)ro.observe(document.body)}window.addEventListener("load",measure)}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start);else start();
})();`;
}

/**
 * The whole document for `srcdoc`. The CSP meta is the first element, so it
 * applies before any of the app's markup is parsed.
 */
export function buildInlineAppDoc({
  html,
  title,
  theme = INLINE_APP_FALLBACK_THEME,
  lang = "en",
}: {
  html: string;
  title: string;
  theme?: InlineAppTheme;
  lang?: string;
}): string {
  const safeLang = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(lang)
    ? lang
    : "en";
  return [
    `<!doctype html><html lang="${safeLang}"><head>`,
    `<meta http-equiv="Content-Security-Policy" content="${INLINE_APP_CSP}">`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<title>${escapeHtml(title)}</title>`,
    `<style>${themeCss(theme)}</style>`,
    `<style>${INLINE_APP_BASE_CSS}</style>`,
    `<script>${inlineAppBootstrap()}</script>`,
    `</head><body>`,
    html,
    `</body></html>`,
  ].join("");
}

export function inlineAppTooLarge(html: string): boolean {
  return html.length > INLINE_APP_MAX_HTML;
}

/** The initial frame height: the agent's hint within 120–800, else 240. */
export function initialAppHeight(hint: unknown): number {
  if (typeof hint !== "number" || !Number.isFinite(hint)) {
    return INLINE_APP_DEFAULT_HEIGHT;
  }
  return Math.round(Math.min(800, Math.max(120, hint)));
}

export function clampAppHeight(height: number): number {
  return Math.round(
    Math.min(INLINE_APP_MAX_HEIGHT, Math.max(INLINE_APP_MIN_HEIGHT, height)),
  );
}

/* Messages from the frame. */

export type InlineAppMessage =
  | { type: "resize"; height: number }
  | { type: "result"; value: InlineAppValue }
  | { type: "error"; message: string };

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isPlainJson(value: unknown, depth: number): boolean {
  if (depth > 12) return false;
  if (value === null) return true;
  switch (typeof value) {
    case "boolean":
    case "string":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object":
      if (Array.isArray(value)) {
        return (
          Object.getPrototypeOf(value) === Array.prototype &&
          value.every((v) => isPlainJson(v, depth + 1))
        );
      }
      if (!isPlainObject(value)) return false;
      return Object.keys(value).every(
        (k) => !FORBIDDEN_KEYS.has(k) && isPlainJson(value[k], depth + 1),
      );
    default:
      return false;
  }
}

/** A fresh copy of `value` if it is plain JSON within the size limit. */
export function toPlainJson(
  value: unknown,
  maxBytes = INLINE_APP_MAX_RESULT_BYTES,
): InlineAppValue | undefined {
  if (!isPlainJson(value, 0)) return undefined;
  const json = JSON.stringify(value);
  if (new TextEncoder().encode(json).length > maxBytes) return undefined;
  return JSON.parse(json) as InlineAppValue;
}

function hasOnlyKeys(data: Record<string, unknown>, allowed: string[]) {
  return Object.keys(data).every((k) => allowed.includes(k));
}

/**
 * Validates a message from the frame. Anything outside the closed set
 * returns null and is ignored. Never evaluates anything.
 */
export function parseInlineAppMessage(data: unknown): InlineAppMessage | null {
  if (!isPlainObject(data)) return null;
  switch (data.type) {
    case INLINE_APP_MESSAGE.resize: {
      if (!hasOnlyKeys(data, ["type", "height"])) return null;
      const h = data.height;
      if (typeof h !== "number" || !Number.isFinite(h)) return null;
      return { type: "resize", height: clampAppHeight(h) };
    }
    case INLINE_APP_MESSAGE.result: {
      if (!hasOnlyKeys(data, ["type", "value"]) || !("value" in data)) {
        return null;
      }
      const value = toPlainJson(data.value);
      return value === undefined ? null : { type: "result", value };
    }
    case INLINE_APP_MESSAGE.error: {
      if (!hasOnlyKeys(data, ["type", "message"])) return null;
      const message =
        typeof data.message === "string" ? data.message.slice(0, 200) : "";
      return { type: "error", message };
    }
    default:
      return null;
  }
}

/** FNV-1a: a short, stable key for a document, so a new one remounts the frame. */
export function hashString(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Returns true at most once per `intervalMs`; extra calls are dropped. */
export function createRateLimiter(intervalMs: number) {
  let last = Number.NEGATIVE_INFINITY;
  return (now: number): boolean => {
    if (now - last < intervalMs) return false;
    last = now;
    return true;
  };
}
