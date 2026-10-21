import { z } from "zod";

/**
 * Inline App: the agent's contract.
 *
 * The escape hatch. When no catalog component fits, the agent writes a small
 * self-contained HTML/CSS/JS app; the host runs it in a sandboxed iframe with
 * no network, themed with the host's tokens and sized to its content.
 */

/** Longest `html` the host will run, in characters. */
export const INLINE_APP_MAX_HTML = 20_000;

export const inlineAppSchema = z.object({
  title: z
    .string()
    .max(80)
    .describe("What the app is, e.g. 'Tip splitter'. Card and frame title."),
  html: z
    .string()
    .max(INLINE_APP_MAX_HTML)
    .describe(
      "Body markup with inline <style> and <script>. No external URLs: there is no network. Base styles and theme variables are already injected. Call genui.send(value) to send plain JSON back.",
    ),
  height: z
    .number()
    .int()
    .min(120)
    .max(800)
    .optional()
    .describe(
      "Expected height in px, used until the app reports its own. Default 240.",
    ),
  description: z
    .string()
    .max(160)
    .optional()
    .describe(
      "One line for screen readers: what the app does, e.g. 'Splits a bill by tip and number of people'.",
    ),
});

export type InlineAppInput = z.input<typeof inlineAppSchema>;

/** Plain JSON: what an app may send back. */
export type InlineAppValue =
  | null
  | boolean
  | number
  | string
  | InlineAppValue[]
  | { [key: string]: InlineAppValue };

/** Sent back each time the app calls `genui.send(value)` (at most every 500 ms). */
export type InlineAppResult = {
  action: "message";
  value: InlineAppValue;
};

/** Usage guidance the agent reads before choosing this component. */
export const inlineAppGuidance = {
  useWhen: [
    "Only when no catalog component fits: a small calculator, a toy simulation, a timer or a one-off interactive explainer.",
  ],
  avoidWhen: [
    "A catalog component covers it (a form, a chart, a timer, a calculator, a checklist). Always prefer the catalog.",
    "It collects personal data, credentials or payment details. Never.",
    "It needs the network, external images, fonts or libraries. There is none.",
    "It is static content. Write text or use a display component.",
  ],
  rules: [
    "Keep it small: one job, a few controls, well under 20,000 characters.",
    "Use the injected defaults: plain <button>, <input>, <label> already look native; colors come from var(--foreground), var(--muted), var(--primary), var(--brand) and friends. Don't hard-code colors.",
    "Label every control (<label for> or aria-label), keep it keyboard operable, and put changing results in an aria-live region.",
    "Don't size with vh units or fixed full-height layouts; the frame grows to fit the content.",
    "Use genui.send(value) only when the result changes what you do next, with small plain JSON.",
    "Never ask for personal data, passwords or payment details, and never imitate a login or checkout.",
    "Never put the user's data in the code: a sandbox can't stop an app from navigating itself, so anything inside it could be sent out in a URL.",
  ],
} as const;

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(inlineAppSchema)`.
 */
export const inlineAppTool = {
  name: "render_inline_app",
  description: [
    "Render a small self-contained HTML/CSS/JS app in a sandboxed frame. The escape hatch for UI the catalog doesn't cover.",
    `Use when: ${inlineAppGuidance.useWhen.join(" ")}`,
    `Avoid when: ${inlineAppGuidance.avoidWhen.join(" ")}`,
    `Rules: ${inlineAppGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: inlineAppSchema,
} as const;
