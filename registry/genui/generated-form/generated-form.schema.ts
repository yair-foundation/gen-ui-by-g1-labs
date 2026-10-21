import { z } from "zod";

import {
  currencyDigits,
  extractMentions,
  isPlausiblePhone,
  normalizeTags,
  parseMoney,
  tooPrecise,
} from "./generated-form-utils";

/**
 * Generated Form: the agent's contract.
 *
 * A short form the agent builds to collect structured input, such as a new
 * contact or a shipping address. Fields marked DATA-BOUND must come from a
 * tool result, never from model free text.
 */

export const formFieldOptionSchema = z.object({
  value: z.string().describe("Returned in the result when chosen."),
  label: z.string(),
});

export const formFieldValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
]);

export const formFieldSchema = z.object({
  id: z
    .string()
    .describe("Stable key. Used as the key in the result's values."),
  label: z.string().describe("Field name, e.g. 'Work email'."),
  type: z
    .enum([
      "text",
      "email",
      "number",
      "textarea",
      "select",
      "checkbox",
      "date",
      "money",
      "phone",
      "tags",
      "mention",
    ])
    .default("text")
    .describe(
      "'money': an amount the user chooses (a budget, a price), as a number in `currency`; never card or account numbers. 'phone': a phone number. 'tags': a list of short labels, returned as an array. 'mention': text where typing @ picks from `options` (people or records you fetched).",
    ),
  currency: z
    .string()
    .length(3)
    .optional()
    .describe("ISO 4217 code for type 'money', e.g. 'EUR'. Default 'USD'."),
  required: z.boolean().default(false),
  placeholder: z
    .string()
    .optional()
    .describe("An example value, e.g. 'dana@northwind.example'."),
  description: z
    .string()
    .optional()
    .describe("One line of help for the field. Screen readers only."),
  default: formFieldValueSchema
    .optional()
    .describe(
      "Prefilled value. DATA-BOUND when it comes from a record (e.g. the saved address). Dates as 'YYYY-MM-DD'.",
    ),
  options: z
    .array(formFieldOptionSchema)
    .optional()
    .describe(
      "DATA-BOUND. Required for type 'select' and 'mention'. Real choices from the system, e.g. lifecycle stages, countries it ships to, or the people who can be mentioned (value: their id, label: their name).",
    ),
  min: z
    .union([z.number(), z.string()])
    .optional()
    .describe(
      "number/money: smallest value. text/textarea: fewest characters. tags: fewest tags. date: earliest 'YYYY-MM-DD'.",
    ),
  max: z
    .union([z.number(), z.string()])
    .optional()
    .describe(
      "number/money: largest value. text/textarea: most characters. tags: most tags. date: latest 'YYYY-MM-DD'.",
    ),
  pattern: z
    .string()
    .optional()
    .describe(
      "Regular expression the whole value must match, e.g. '[0-9]{5}'. Set patternMessage with it.",
    ),
  patternMessage: z
    .string()
    .optional()
    .describe("Shown when the pattern fails, e.g. 'Use 5 digits'."),
});

export const generatedFormSchema = z.object({
  title: z.string().describe("What the form is for, e.g. 'New contact'."),
  description: z.string().optional(),
  fields: z.array(formFieldSchema).min(1).max(10),
  submitLabel: z
    .string()
    .optional()
    .describe("Verb for the submit button, e.g. 'Create contact'."),
});

export type FormFieldOption = z.infer<typeof formFieldOptionSchema>;
export type FormField = z.input<typeof formFieldSchema>;
export type GeneratedFormInput = z.input<typeof generatedFormSchema>;

/** A submitted value. Empty optional fields are null. Tags are an array. */
export type FormValue = string | number | boolean | string[] | null;

/** What the component sends back to the agent. A closed set of actions. */
export type GeneratedFormResult =
  | {
      action: "submit";
      /**
       * Keyed by field id. number and money fields are numbers, checkboxes
       * booleans, tags an array of strings.
       */
      values: Record<string, FormValue>;
      /** 'mention' fields: the ids mentioned in each, keyed by field id. Only fields with mentions. */
      mentions?: Record<string, string[]>;
    }
  /** The user closed the form. Don't ask again unless they bring it up. */
  | { action: "cancel" };

/** Usage guidance the agent reads before choosing this component. */
export const generatedFormGuidance = {
  useWhen: [
    "You need several pieces of structured data from the user to create or update a record: a new contact, a shipping address, an event RSVP.",
    "The values are the user's to provide and you cannot look them up.",
  ],
  avoidWhen: [
    "You need one or two decisions. Use the question stepper or ask in a sentence.",
    "You can find the values yourself in data, files or earlier messages. Look them up and prefill or skip them.",
    "The user is choosing among records you fetched. Use an entity picker.",
  ],
  rules: [
    "Never ask for passwords, payment card numbers, bank details or government IDs. Send the user to the system's own secure page instead.",
    "Keep it to 10 fields or fewer, in the order the user thinks about them; put required fields first.",
    "Prefill default from real records when you have them, and mark only truly necessary fields required.",
    "select options must come from the system you will write to, never invented.",
    "Use pattern only for real format rules, always with a patternMessage.",
    "Use money for an amount the user decides (a budget, a price cap), with currency set; use phone for a contact number; use tags for a free list of short labels; use mention only with options you fetched, and read result.mentions for the ids.",
    "Do nothing with the data until you receive action 'submit'; on 'cancel', stop and ask in text if needed.",
  ],
} as const;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Checks one field's raw input against its rules. Returns an error message,
 * or null when the value is valid. Raw values are strings, or booleans for
 * checkboxes, exactly as the inputs hold them.
 */
export function validateFormField(
  field: Pick<
    FormField,
    | "label"
    | "type"
    | "required"
    | "options"
    | "min"
    | "max"
    | "pattern"
    | "patternMessage"
    | "currency"
  >,
  raw: string | boolean | string[] | undefined,
): string | null {
  const type = field.type ?? "text";
  const label = field.label;

  if (type === "tags") {
    const tags = normalizeTags(Array.isArray(raw) ? raw : []);
    if (tags.length === 0)
      return field.required ? `${label} is required.` : null;
    if (typeof field.min === "number" && tags.length < field.min) {
      return `Add at least ${field.min}.`;
    }
    if (typeof field.max === "number" && tags.length > field.max) {
      return `Use ${field.max} or fewer.`;
    }
    return null;
  }

  if (type === "checkbox") {
    return field.required && raw !== true
      ? `Check "${label}" to continue.`
      : null;
  }

  const value = typeof raw === "string" ? raw.trim() : "";
  if (value === "") {
    if (!field.required) return null;
    return `${label} is required.`;
  }

  const min = field.min;
  const max = field.max;

  switch (type) {
    case "email":
      if (!emailPattern.test(value)) return "Enter a valid email address.";
      break;
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) return "Enter a number.";
      if (typeof min === "number" && n < min) return `Use ${min} or more.`;
      if (typeof max === "number" && n > max) return `Use ${max} or less.`;
      break;
    }
    case "money": {
      const n = parseMoney(value);
      if (n === null) return "Enter an amount.";
      if (n < 0 && !(typeof min === "number" && min < 0)) {
        return "Enter an amount of zero or more.";
      }
      if (tooPrecise(n, currencyDigits(field.currency))) {
        return `Use at most ${currencyDigits(field.currency)} decimal places.`;
      }
      if (typeof min === "number" && n < min) return `Use ${min} or more.`;
      if (typeof max === "number" && n > max) return `Use ${max} or less.`;
      break;
    }
    case "phone":
      if (!isPlausiblePhone(value)) return "Enter a valid phone number.";
      break;
    case "date":
      if (!isoDate.test(value) || Number.isNaN(Date.parse(value))) {
        return "Enter a valid date.";
      }
      // ISO dates compare correctly as strings.
      if (typeof min === "string" && isoDate.test(min) && value < min) {
        return `Choose ${min} or later.`;
      }
      if (typeof max === "string" && isoDate.test(max) && value > max) {
        return `Choose ${max} or earlier.`;
      }
      break;
    case "select":
      if (field.options && !field.options.some((o) => o.value === value)) {
        return `Choose one of the options for ${label}.`;
      }
      break;
    default:
      if (typeof min === "number" && value.length < min) {
        return `Use at least ${min} characters.`;
      }
      if (typeof max === "number" && value.length > max) {
        return `Use ${max} characters or fewer.`;
      }
  }

  if (field.pattern) {
    let re: RegExp | null = null;
    try {
      re = new RegExp(`^(?:${field.pattern})$`);
    } catch {
      // An invalid pattern from the agent is ignored rather than blocking the user.
    }
    if (re && !re.test(value))
      return field.patternMessage ?? "Check the format.";
  }

  return null;
}

/** Converts raw input to the value sent to the agent. */
export function toFormValue(
  field: Pick<FormField, "type">,
  raw: string | boolean | string[] | undefined,
): FormValue {
  if (field.type === "tags") {
    const tags = normalizeTags(Array.isArray(raw) ? raw : []);
    return tags.length ? tags : null;
  }
  if (field.type === "checkbox") return raw === true;
  const value = typeof raw === "string" ? raw.trim() : "";
  if (value === "") return null;
  if (field.type === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (field.type === "money") return parseMoney(value);
  return value;
}

/** The ids mentioned in each 'mention' field, for the result. Empty fields are left out. */
export function collectMentions(
  fields: Pick<FormField, "id" | "type" | "options">[],
  values: Record<string, FormValue>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of fields) {
    if (f.type !== "mention") continue;
    const text = values[f.id];
    if (typeof text !== "string" || !f.options) continue;
    const ids = extractMentions(text, f.options);
    if (ids.length) out[f.id] = ids;
  }
  return out;
}

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(generatedFormSchema)`.
 */
export const generatedFormTool = {
  name: "fill_form",
  description: [
    "Show the user a short form to fill in and wait for the submitted values.",
    `Use when: ${generatedFormGuidance.useWhen.join(" ")}`,
    `Avoid when: ${generatedFormGuidance.avoidWhen.join(" ")}`,
    `Rules: ${generatedFormGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: generatedFormSchema,
} as const;
