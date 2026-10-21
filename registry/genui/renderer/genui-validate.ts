import type { ZodType } from "zod"

import { type GenUIRefSources, resolveRefs } from "./genui-context"

/*
 * Validates a tool call's input against the component's schema and, when it
 * fails, words the problems for the model. Return the message as the tool's
 * result (an error result, where the framework has one) so the model can fix
 * the call instead of repeating the mistake. Without this, invalid fields are
 * silently dropped and the model never learns.
 */

export type GenUIValidation<T = unknown> =
  | { ok: true; value: T }
  | {
      ok: false
      /** One line per problem, for the model: "items.0.price: expected number". */
      issues: string[]
      /** The issues joined, ready to send back as the tool's result. */
      message: string
    }

type IssueLike = { path?: PropertyKey[]; message: string }

/** Zod issues as `path: message` lines, deduplicated, at most `max`. */
export function formatIssues(issues: readonly IssueLike[], max = 12): string[] {
  const lines = new Set<string>()
  for (const issue of issues) {
    const path = (issue.path ?? []).map(String).join(".")
    lines.add(path ? `${path}: ${issue.message}` : issue.message)
    if (lines.size >= max) break
  }
  return [...lines]
}

/**
 * Resolves refs, then parses with the schema. On failure, `message` tells the
 * model what to change; unresolved refs are reported too, since a dropped ref
 * leaves a required field empty.
 */
export function validateGenUIInput<T>(
  schema: ZodType<T>,
  input: unknown,
  refs?: GenUIRefSources,
): GenUIValidation<T> {
  const missing: string[] = []
  let value = input
  if (refs) {
    const resolved = resolveRefs(input, refs)
    value = resolved.value
    missing.push(...resolved.missing)
  }
  const parsed = schema.safeParse(value)
  if (parsed.success && missing.length === 0) {
    return { ok: true, value: parsed.data }
  }
  const issues = [
    ...missing.map((ref) => `$ref "${ref}": not found in the tool results`),
    ...(parsed.success ? [] : formatIssues(parsed.error.issues)),
  ]
  return {
    ok: false,
    issues,
    message: [
      "The interface wasn't shown: the call didn't match the component's schema. Fix these and call again:",
      ...issues.map((line) => `- ${line}`),
    ].join("\n"),
  }
}
