"use client";

import * as React from "react";
import { cn } from "cn";

/**
 * Form fields: labelled fields the user fills in to submit something
 * (docs/design/components.md, Forms). Inside a form, each field is 56px tall
 * with 24px corners and its label sits inside the box: the field's name at
 * rest, a small line at the top once focused or filled. Compact controls
 * (search, filters, steppers, composers) keep the plain Input and Select.
 */

/** Class for an Input inside a FormField. */
export const formInputClass =
  "h-14 w-full rounded-[24px] px-4 pt-5 pb-1 text-[15px] md:text-[15px] sm:w-full focus:border-foreground/80 focus:ring-0 dark:focus:border-foreground/80 placeholder:text-transparent focus:placeholder:text-muted-foreground transition-[border-color,color] duration-200 motion-reduce:transition-none";

/**
 * Add to a field whose placeholder is an example ("Parking, buzzer, pets"),
 * and pin its label: the example stays visible at rest. A format placeholder
 * ("#####") stays hidden until focus.
 */
export const formExampleClass = "placeholder:text-muted-foreground";

/** Class for a Textarea inside a FormField (its label is pinned, so examples show). */
export const formTextareaClass = cn(
  formInputClass,
  formExampleClass,
  "h-auto min-h-28 pt-7 pb-3",
);

/** Class for a SelectTrigger inside a FormField. */
export const formSelectClass =
  "h-14 w-full rounded-[24px] px-4 pt-5 pb-1 text-[15px] data-[size=default]:h-14 sm:w-full focus:border-foreground/80 dark:focus:border-foreground/80 data-placeholder:text-transparent focus:data-placeholder:text-muted-foreground";

/**
 * Add to a control in a FormField with no visible label: the field is already
 * named by what's around it (a question heading, a row name) and gets its
 * accessible name from that context through aria-labelledby or aria-label.
 * No space is kept for a label.
 */
export const formUnlabeledClass = "pt-0 pb-0";

/** The same for a Textarea with no visible label. */
export const formTextareaUnlabeledClass = "pt-3 pb-3";

/** Class for a DatePicker trigger inside a FormField (its label stays up). */
export const formDateClass =
  "h-14 w-full rounded-[24px] px-4 pt-5 pb-1 text-[15px]";

/** The form's single primary action: full width, black in light, white in dark. */
export const formPrimaryClass =
  "h-14 w-full rounded-[24px] text-[15px] dark:bg-foreground dark:text-background dark:hover:bg-foreground/90";

/**
 * A format hint from a digits pattern, shown as the placeholder on focus:
 * "[0-9]{5}(-[0-9]{4})?" becomes "#####". Undefined for other patterns.
 */
export function formatHint(pattern: string | undefined): string | undefined {
  if (!pattern) return undefined;
  const core = pattern.replace(/\([^)]*\)\?/g, "");
  const out = core.replace(/(?:\[0-9\]|\\d)\{(\d+)\}/g, (_, n) =>
    "#".repeat(Number(n)),
  );
  return /^[#\- ]+$/.test(out) ? out : undefined;
}

const GroupContext = React.createContext<string | null>(null);

/**
 * The fields of one form: one per row with an equal gap. While a field has
 * focus the others dim, and Enter in a text field moves to the next field
 * (the last one submits the form).
 */
function FormFieldGroup({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const [focused, setFocused] = React.useState<string | null>(null);
  return (
    <GroupContext.Provider value={focused}>
      <fieldset
        className={cn(
          "m-0 flex min-w-0 flex-col gap-3 border-0 p-0",
          className,
        )}
        onFocusCapture={(e) => {
          const el = (e.target as HTMLElement).closest<HTMLElement>(
            "[data-form-field]",
          );
          setFocused(el?.dataset.formField ?? null);
        }}
        onBlurCapture={(e) => {
          const next = e.relatedTarget as HTMLElement | null;
          if (!next?.closest("[data-form-field]")) setFocused(null);
        }}
        onKeyDown={(e) => {
          const t = e.target as HTMLElement;
          // Leave Enter alone while an input method is composing (Japanese, Chinese…).
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          if (t.tagName !== "INPUT") return;
          const fields = [
            ...e.currentTarget.querySelectorAll<HTMLElement>(
              "[data-form-field]",
            ),
          ];
          const i = fields.findIndex((f) => f.contains(t));
          const next = fields[i + 1]?.querySelector<HTMLElement>(
            "input:not([type=hidden]), textarea, button",
          );
          e.preventDefault();
          if (next) next.focus();
          else t.closest("form")?.requestSubmit();
        }}
      >
        {children}
      </fieldset>
    </GroupContext.Provider>
  );
}

function RequiredMark() {
  return (
    <span aria-hidden className="text-muted-foreground">
      {" "}
      *
    </span>
  );
}

/**
 * One field with its label inside the box. `htmlFor` is the control's id;
 * `filled` floats the label for a value; `pinned` keeps it up (text areas,
 * dates, and controls with their own content). Errors show under the box.
 * Leave `label` out when visible context already names the field: never add
 * a redundant label just for the pattern (D19).
 */
function FormField({
  htmlFor,
  labelId,
  label,
  required,
  filled,
  pinned,
  error,
  errorId,
  className,
  children,
}: {
  htmlFor?: string;
  labelId?: string;
  label?: React.ReactNode;
  required?: boolean;
  filled?: boolean;
  pinned?: boolean;
  error?: React.ReactNode;
  errorId?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const id = React.useId();
  const focused = React.useContext(GroupContext);
  const up = filled || pinned;
  return (
    <div
      data-form-field={id}
      className={cn(
        "flex min-w-0 flex-col gap-1.5 transition-opacity duration-200 motion-reduce:transition-none",
        focused !== null && focused !== id && "opacity-55",
        className,
      )}
    >
      <div className="group/ff relative w-full" data-up={up || undefined}>
        {children}
        {label !== undefined && (
          <label
            id={labelId}
            htmlFor={htmlFor}
            className={cn(
              "pointer-events-none absolute top-[18px] left-4 z-10 max-w-[calc(100%-3rem)] origin-top-left truncate text-[15px] leading-5 text-muted-foreground transition-[translate,scale] duration-150 ease-out motion-reduce:transition-none",
              "group-focus-within/ff:-translate-y-2.5 group-focus-within/ff:scale-80 group-focus-within/ff:font-medium",
              "group-data-[up]/ff:-translate-y-2.5 group-data-[up]/ff:scale-80 group-data-[up]/ff:font-medium",
            )}
          >
            {label}
            {required && <RequiredMark />}
          </label>
        )}
      </div>
      {error && (
        <p id={errorId} className="px-4 text-[13px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export { FormField, FormFieldGroup };
