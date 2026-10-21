"use client";

import * as React from "react";
import { CheckIcon, XIcon } from "lucide-react";
import { MotionConfig, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/animate-ui/components/base/checkbox";
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height";
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WhyDisabled } from "@/components/genui/hint";
import { useGenUILocale } from "@/components/genui/locale";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DatePicker } from "@/components/genui/date-picker";
import {
  FormField as FieldBox,
  FormFieldGroup,
  formDateClass,
  formExampleClass,
  formInputClass,
  formPrimaryClass,
  formSelectClass,
  formTextareaClass,
  formatHint,
} from "@/components/genui/form-field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Skeleton,
  Surface,
  SurfaceDescription,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface";

import {
  activeMention,
  applyMention,
  formatMoney,
  matchMentions,
  normalizeTags,
  splitTags,
} from "./generated-form-utils";
import {
  collectMentions,
  type FormField,
  type FormValue,
  type GeneratedFormInput,
  type GeneratedFormResult,
  toFormValue,
  validateFormField,
} from "./generated-form.schema";

export type GeneratedFormStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "submitted"
  | "cancelled";

type PartialField = Partial<FormField>;
type ReadyField = PartialField & { id: string; label: string };

/** What an input holds: text for most fields, a boolean for checkboxes, a list for tags. */
type Raw = string | boolean | string[];

export type GeneratedFormProps = Partial<Omit<GeneratedFormInput, "fields">> & {
  /** Fields may be partial while the tool call is still streaming. */
  fields?: PartialField[];
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props; 'submitting' while the host saves the values.
   * When omitted, the component tracks the user's decision itself.
   */
  status?: GeneratedFormStatus;
  /** Called once with the user's decision. Send it back to the agent. */
  onResult?: (result: GeneratedFormResult) => void;
  /**
   * A decision from history (e.g. the tool call's stored output). Renders the
   * submitted values read-only and never calls onResult.
   */
  result?: GeneratedFormResult;
  className?: string;
};

function defaultRaw(field: PartialField): Raw {
  if (field.type === "checkbox") return field.default === true;
  if (field.type === "tags") {
    return typeof field.default === "string" ? splitTags(field.default) : [];
  }
  return field.default === undefined || typeof field.default === "boolean"
    ? ""
    : String(field.default);
}

function rawFromValue(value: FormValue): Raw {
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value;
  return value === null ? "" : String(value);
}

/** 'YYYY-MM-DD' as a local calendar date, so it never shifts a day. */
function formatDate(value: string, locale: string) {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(y, m - 1, d),
  );
}

function displayValue(
  field: ReadyField,
  value: FormValue | undefined,
  locale: string,
) {
  if (field.type === "checkbox") return value === true ? "Yes" : "No";
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) return value.join(", ");
  if (field.type === "money" && typeof value === "number") {
    return formatMoney(value, field.currency, locale);
  }
  if (field.type === "select") {
    return (
      field.options?.find((o) => o.value === value)?.label ?? String(value)
    );
  }
  if (field.type === "date" && typeof value === "string") {
    return formatDate(value, locale);
  }
  if (typeof value === "number")
    return new Intl.NumberFormat(locale).format(value);
  return String(value);
}

function RequiredMark() {
  return (
    <span aria-hidden className="text-muted-foreground">
      {" "}
      *
    </span>
  );
}

/** A list of short labels: type, then Enter or a comma to add; Backspace on an empty box removes the last. */
function TagsInput({
  controlId,
  labelId,
  describedBy,
  invalid,
  disabled,
  tags,
  max,
  placeholder,
  onChange,
  onBlur,
}: {
  controlId: string;
  labelId: string;
  describedBy: string | undefined;
  invalid: boolean;
  disabled: boolean;
  tags: string[];
  max?: number;
  placeholder?: string;
  onChange: (tags: string[]) => void;
  onBlur: () => void;
}) {
  const [draft, setDraft] = React.useState("");
  const [note, setNote] = React.useState("");
  const commit = (text: string) => {
    const added = normalizeTags([...tags, ...text.split(",")]);
    if (added.length !== tags.length) {
      onChange(added);
      setNote(`Added ${added[added.length - 1]}`);
    }
    setDraft("");
  };
  const remove = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
    setNote(`Removed ${tag}`);
  };
  const full = typeof max === "number" && tags.length >= max;

  return (
    <div className="flex flex-col gap-2">
      {tags.length > 0 && (
        <ul aria-labelledby={labelId} className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <li
              key={t}
              className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border bg-transparent py-1 pr-1 pl-3.5 text-[13px]"
            >
              <span className="break-words">{t}</span>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={`Remove ${t}`}
                      onClick={() => remove(t)}
                      className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-white/10"
                    />
                  }
                >
                  <XIcon aria-hidden className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>{`Remove ${t}`}</TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
      <Input
        id={controlId}
        disabled={disabled || full}
        aria-invalid={invalid || undefined}
        aria-describedby={[`${controlId}-hint`, describedBy]
          .filter(Boolean)
          .join(" ")}
        placeholder={
          full ? "Limit reached" : (placeholder ?? "Type, then press Enter")
        }
        value={draft}
        maxLength={40}
        onChange={(e) => {
          const v = e.target.value;
          // A comma ends a tag, including when pasting "a, b, c".
          if (v.includes(",")) commit(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            // Enter adds the tag; it doesn't submit the form.
            e.preventDefault();
            if (draft.trim()) commit(draft);
          } else if (e.key === "Backspace" && draft === "" && tags.length > 0) {
            remove(tags[tags.length - 1]);
          }
        }}
        onBlur={() => {
          if (draft.trim()) commit(draft);
          onBlur();
        }}
      />
      <p id={`${controlId}-hint`} className="sr-only">
        Press Enter or type a comma to add one. Backspace in an empty box
        removes the last.
      </p>
      <p aria-live="polite" className="sr-only">
        {note}
      </p>
    </div>
  );
}

/** A textarea where typing @ offers the field's options; the chosen name is inserted as "@Name ". */
function MentionTextarea({
  field,
  controlId,
  describedBy,
  invalid,
  disabled,
  text,
  onChange,
  onBlur,
}: {
  field: ReadyField;
  controlId: string;
  describedBy: string | undefined;
  invalid: boolean;
  disabled: boolean;
  text: string;
  onChange: (text: string) => void;
  onBlur: () => void;
}) {
  const options = (field.options ?? []).filter(
    (o): o is { value: string; label: string } =>
      typeof o.value === "string" && typeof o.label === "string",
  );
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const listId = `${controlId}-mentions`;
  const [caret, setCaret] = React.useState(0);
  const [active, setActive] = React.useState(0);
  const [dismissed, setDismissed] = React.useState(false);

  const mention = dismissed ? null : activeMention(text, caret);
  const matches = mention ? matchMentions(options, mention.query) : [];
  const open = matches.length > 0;
  const current = Math.min(active, Math.max(matches.length - 1, 0));

  const pick = (label: string) => {
    if (!mention) return;
    const next = applyMention(text, mention.start, caret, label);
    onChange(next.text);
    setCaret(next.caret);
    setActive(0);
    requestAnimationFrame(() => {
      const el = ref.current;
      el?.focus();
      el?.setSelectionRange(next.caret, next.caret);
    });
  };

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        id={controlId}
        disabled={disabled}
        // A textarea can't take role="combobox"; as a textbox it can still
        // point at the suggestions while they're open.
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${current}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-required={field.required || undefined}
        placeholder={field.placeholder ?? "Type @ to mention someone"}
        value={text}
        maxLength={typeof field.max === "number" ? field.max : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart);
          setDismissed(false);
          setActive(0);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((current + 1) % matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((current - 1 + matches.length) % matches.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            pick(matches[current].label);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDismissed(true);
          }
        }}
        onBlur={onBlur}
        className="min-h-24"
      />
      {open && (
        <ul
          id={listId}
          // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the ARIA combobox pattern's popup
          role="listbox"
          aria-label="People to mention"
          className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-[10px] bg-popover p-1 text-popover-foreground shadow-md dark:shadow-none ring-1 ring-foreground/10"
        >
          {matches.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the ARIA combobox pattern's option
              role="option"
              tabIndex={-1}
              aria-selected={i === current}
              onMouseDown={(e) => {
                // Keep focus in the textarea; keys are handled there.
                e.preventDefault();
                pick(o.label);
              }}
              className={cn(
                "cursor-pointer rounded-lg px-3 py-1.5 text-[13px]",
                i === current && "bg-accent",
              )}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
      <p aria-live="polite" className="sr-only">
        {open
          ? `${matches.length} ${matches.length === 1 ? "match" : "matches"}. Use the arrow keys and Enter.`
          : ""}
      </p>
    </div>
  );
}

/** True when a field's placeholder is an example, not a format hint. */
function hasExample(f: { placeholder?: string; pattern?: string }): boolean {
  return Boolean(f.placeholder) && !formatHint(f.pattern);
}

function isBlankValue(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    v === "" ||
    (Array.isArray(v) && v.length === 0)
  );
}

function FieldControl({
  field,
  controlId,
  labelId,
  describedBy,
  value,
  invalid,
  disabled,
  onChange,
  onBlur,
}: {
  field: ReadyField;
  controlId: string;
  labelId: string;
  describedBy: string | undefined;
  value: Raw;
  invalid: boolean;
  disabled: boolean;
  onChange: (value: Raw) => void;
  onBlur: () => void;
}) {
  const common = {
    id: controlId,
    disabled,
    "aria-invalid": invalid || undefined,
    "aria-describedby": describedBy,
    "aria-required": field.required || undefined,
  };
  const text = typeof value === "string" ? value : "";
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);

  switch (field.type) {
    case "tags":
      return (
        <TagsInput
          controlId={controlId}
          labelId={labelId}
          describedBy={describedBy}
          invalid={invalid}
          disabled={disabled}
          tags={Array.isArray(value) ? value : []}
          max={num(field.max)}
          placeholder={field.placeholder}
          onChange={(tags) => onChange(tags)}
          onBlur={onBlur}
        />
      );
    case "mention":
      return (
        <MentionTextarea
          field={field}
          controlId={controlId}
          describedBy={describedBy}
          invalid={invalid}
          disabled={disabled}
          text={text}
          onChange={onChange}
          onBlur={onBlur}
        />
      );
    case "money":
      return (
        <div className="relative w-full">
          {/* The currency sits inside the box and is read with the field. */}
          <span
            id={`${controlId}-currency`}
            className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-[13px] font-medium text-muted-foreground"
          >
            {(field.currency ?? "USD").toUpperCase()}
          </span>
          <Input
            {...common}
            aria-describedby={[`${controlId}-currency`, describedBy]
              .filter(Boolean)
              .join(" ")}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder={field.placeholder ?? "0.00"}
            className={cn(formInputClass, "pr-14")}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
          />
        </div>
      );
    case "phone":
      return (
        <Input
          {...common}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder={field.placeholder ?? "+1 555 0100"}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={formInputClass}
        />
      );
    case "textarea":
      return (
        <Textarea
          {...common}
          placeholder={field.placeholder}
          value={text}
          maxLength={num(field.max)}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={formTextareaClass}
        />
      );
    case "select":
      if (!field.options?.length)
        return <Skeleton className="h-14 w-full rounded-[24px]" />;
      return (
        <Select
          value={text === "" ? null : text}
          onValueChange={(v) => onChange(typeof v === "string" ? v : "")}
          items={field.options}
          disabled={disabled}
        >
          <SelectTrigger
            {...common}
            aria-labelledby={labelId}
            className={formSelectClass}
          >
            <SelectValue
              placeholder={field.placeholder ?? "Choose an option"}
            />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "number":
      return (
        <Input
          {...common}
          type="number"
          inputMode="decimal"
          placeholder={field.placeholder}
          min={num(field.min)}
          max={num(field.max)}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={formInputClass}
        />
      );
    case "date":
      return (
        <DatePicker
          type="date"
          id={controlId}
          min={str(field.min)}
          max={str(field.max)}
          value={text}
          disabled={disabled}
          onValueChange={(v) => {
            onChange(v);
            onBlur();
          }}
          className={formDateClass}
        />
      );
    default:
      return (
        <Input
          {...common}
          type={field.type === "email" ? "email" : "text"}
          autoComplete={field.type === "email" ? "email" : undefined}
          // The keyboard follows the data; a digits pattern opens the keypad.
          inputMode={
            field.type === "email"
              ? "email"
              : formatHint(field.pattern)
                ? "numeric"
                : "text"
          }
          // A format shows on focus; an example placeholder stays visible.
          placeholder={formatHint(field.pattern) ?? field.placeholder}
          className={cn(
            formInputClass,
            !formatHint(field.pattern) && field.placeholder && formExampleClass,
          )}
          maxLength={num(field.max)}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
      );
  }
}

export function GeneratedForm({
  title,
  description,
  fields = [],
  submitLabel,
  status: statusProp,
  onResult,
  result,
  className,
}: GeneratedFormProps) {
  const locale = useGenUILocale();
  // The user's input, layered over each field's default. Restored from history.
  const [edits, setEdits] = React.useState<Record<string, Raw>>(() =>
    result?.action === "submit"
      ? Object.fromEntries(
          Object.entries(result.values).map(([k, v]) => [k, rawFromValue(v)]),
        )
      : {},
  );
  const [touched, setTouched] = React.useState<Set<string>>(() => new Set());
  const [attempted, setAttempted] = React.useState(false);
  const [decision, setDecision] = React.useState<
    "submitted" | "cancelled" | null
  >(() =>
    result ? (result.action === "submit" ? "submitted" : "cancelled") : null,
  );
  const baseId = React.useId();
  const titleId = `${baseId}-title`;

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: GeneratedFormStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready");
  const streaming = status === "streaming";
  const locked = status !== "ready" && status !== "streaming";
  const done = status === "submitted" || status === "cancelled";

  const ready = fields.filter(
    (f): f is ReadyField =>
      typeof f.id === "string" && typeof f.label === "string",
  );
  const raw = (f: ReadyField) => (f.id in edits ? edits[f.id] : defaultRaw(f));
  const controlId = (f: ReadyField) => `${baseId}-${f.id}`;
  const errorFor = (f: ReadyField) =>
    touched.has(f.id) || attempted ? validateFormField(f, raw(f)) : null;
  const invalidCount = attempted
    ? ready.filter((f) => validateFormField(f, raw(f)) !== null).length
    : 0;

  const touch = (id: string) =>
    setTouched((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (locked || streaming) return;
    setAttempted(true);
    const firstInvalid = ready.find((f) => validateFormField(f, raw(f)));
    if (firstInvalid) {
      document.getElementById(controlId(firstInvalid))?.focus();
      return;
    }
    setDecision("submitted");
    const values = Object.fromEntries(
      ready.map((f) => [f.id, toFormValue(f, raw(f))]),
    );
    const mentions = collectMentions(ready, values);
    onResult?.({
      action: "submit",
      values,
      ...(Object.keys(mentions).length ? { mentions } : {}),
    });
  };

  const cancel = () => {
    setDecision("cancelled");
    onResult?.({ action: "cancel" });
  };

  // Submitted or cancelled: a read-only record for the chat history.
  if (done) {
    const values =
      result?.action === "submit"
        ? result.values
        : Object.fromEntries(ready.map((f) => [f.id, toFormValue(f, raw(f))]));
    return (
      <MotionConfig reducedMotion="user">
        <Surface
          data-slot="generated-form"
          data-status={status}
          aria-labelledby={titleId}
          className={className}
        >
          <SurfaceHeader
            className={cn("flex-row items-center justify-between gap-3 pb-3")}
          >
            <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
            <p aria-live="polite" className="shrink-0">
              {status === "submitted" ? (
                <Badge variant="success">
                  <CheckIcon aria-hidden />
                  Submitted
                </Badge>
              ) : (
                <Badge variant="outline">
                  <XIcon aria-hidden />
                  Cancelled
                  <span className="sr-only">. Nothing was sent.</span>
                </Badge>
              )}
            </p>
          </SurfaceHeader>
          {status === "submitted" && (
            <motion.dl
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col divide-y divide-border border-t border-border px-3"
            >
              {ready.map((f) => {
                const shown = displayValue(f, values[f.id], locale);
                return (
                  <div
                    key={f.id}
                    className="grid grid-cols-1 gap-0.5 py-2.5 sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)] sm:gap-4"
                  >
                    <dt className={cn(genuiType.label, "sm:pt-0.5")}>
                      {f.label}
                    </dt>
                    <dd
                      className={cn(
                        genuiType.body,
                        shown === null
                          ? "text-muted-foreground"
                          : "font-medium break-words whitespace-pre-line",
                      )}
                    >
                      {shown ?? "Not provided"}
                    </dd>
                  </div>
                );
              })}
            </motion.dl>
          )}
        </Surface>
      </MotionConfig>
    );
  }

  // Compact fields pair two to a row; everything else gets a full row.
  const compact = (f: (typeof ready)[number]) =>
    f.type === "select" ||
    f.type === "number" ||
    f.type === "date" ||
    f.type === "money";
  const rows: (typeof ready)[] = [];
  for (let i = 0; i < ready.length; i++) {
    const f = ready[i];
    const next = ready[i + 1];
    // In a form every field gets its own row (docs/design/components.md, Forms).
    void compact;
    void next;
    rows.push([f]);
  }

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="generated-form"
        data-status={status}
        aria-busy={streaming || status === "submitting"}
        aria-labelledby={titleId}
        className={className}
      >
        <form noValidate onSubmit={submit} aria-labelledby={titleId}>
          <SurfaceHeader>
            <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
            {description && (
              <SurfaceDescription>{description}</SurfaceDescription>
            )}
          </SurfaceHeader>

          <AutoHeight>
            <FormFieldGroup className="border-t border-border px-3 py-3">
              {rows.map((row) => (
                <div key={row[0].id}>
                  {row.map((f, ci) => {
                    const id = controlId(f);
                    const labelId = `${id}-label`;
                    const descId = `${id}-desc`;
                    const errId = `${id}-error`;
                    const error = errorFor(f);
                    const describedBy =
                      [f.description && descId, error && errId]
                        .filter(Boolean)
                        .join(" ") || undefined;
                    const value = raw(f);
                    const onChange = (v: Raw) => {
                      setEdits((prev) => ({ ...prev, [f.id]: v }));
                      // Choices are complete on change; text waits for blur.
                      if (
                        f.type === "checkbox" ||
                        f.type === "select" ||
                        f.type === "tags"
                      )
                        touch(f.id);
                    };

                    return (
                      <motion.div
                        key={f.id}
                        data-slot="generated-form-field"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={genuiMotion.fade}
                        className="flex min-w-0 flex-col gap-1.5"
                        data-col={ci}
                      >
                        {f.type === "checkbox" ? (
                          // One label for the box and its text: the whole row toggles.
                          <label
                            htmlFor={id}
                            className={cn(
                              "-mx-2 -my-1 flex items-start gap-3 rounded-lg px-2 py-1 transition-colors",
                              locked
                                ? "cursor-default"
                                : "cursor-pointer hover:bg-muted dark:hover:bg-white/5",
                            )}
                          >
                            <Checkbox
                              nativeButton
                              size="sm"
                              id={id}
                              aria-labelledby={labelId}
                              aria-describedby={describedBy}
                              aria-invalid={error ? true : undefined}
                              checked={value === true}
                              disabled={locked}
                              onCheckedChange={(on) => onChange(Boolean(on))}
                              // Larger tap area than the 18px box, without changing its look.
                              className="relative mt-0.5 after:absolute after:-inset-2"
                            />
                            <span className="flex min-w-0 flex-col gap-0.5">
                              <span
                                id={labelId}
                                className={cn(genuiType.body, "font-medium")}
                              >
                                {f.label}
                                {f.required && <RequiredMark />}
                              </span>
                              {/* Helper text is read with the field, not shown. */}
                              {f.description && (
                                <span id={descId} className="sr-only">
                                  {f.description}
                                </span>
                              )}
                            </span>
                          </label>
                        ) : (
                          <>
                            {/* Helper text is read with the field, not shown. */}
                            {f.description && (
                              <p id={descId} className="sr-only">
                                {f.description}
                              </p>
                            )}
                            {f.type === "tags" ? (
                              // Tags label a chip list, not a box, so the label stays above.
                              <>
                                <label
                                  id={labelId}
                                  htmlFor={id}
                                  className={genuiType.label}
                                >
                                  {f.label}
                                  {f.required && <RequiredMark />}
                                </label>
                                <div className="[&_input]:h-14 [&_input]:rounded-[24px] [&_input]:px-4 [&_input]:text-[15px]">
                                  <FieldControl
                                    field={f}
                                    controlId={id}
                                    labelId={labelId}
                                    describedBy={describedBy}
                                    value={value}
                                    invalid={Boolean(error)}
                                    disabled={locked}
                                    onChange={onChange}
                                    onBlur={() => touch(f.id)}
                                  />
                                </div>
                                {error && (
                                  <p id={errId} className="px-4 text-[13px] text-destructive">
                                    {error}
                                  </p>
                                )}
                              </>
                            ) : (
                              <FieldBox
                                htmlFor={id}
                                labelId={labelId}
                                label={f.label}
                                required={f.required}
                                filled={!isBlankValue(value)}
                                pinned={
                                  f.type === "textarea" ||
                                  f.type === "mention" ||
                                  f.type === "date" ||
                                  // An example placeholder needs the label up to stay visible.
                                  (hasExample(f) && f.type !== "select")
                                }
                                error={error}
                                errorId={errId}
                              >
                                <div className="[&_[data-slot=textarea]]:min-h-28 [&_[data-slot=textarea]]:rounded-[24px] [&_[data-slot=textarea]]:px-4 [&_[data-slot=textarea]]:pt-7 [&_[data-slot=textarea]]:text-[15px]">
                                  <FieldControl
                                    field={f}
                                    controlId={id}
                                    labelId={labelId}
                                    describedBy={describedBy}
                                    value={value}
                                    invalid={Boolean(error)}
                                    disabled={locked}
                                    onChange={onChange}
                                    onBlur={() => touch(f.id)}
                                  />
                                </div>
                              </FieldBox>
                            )}
                          </>
                        )}
                        {error && f.type === "checkbox" && (
                          <p
                            id={errId}
                            className="text-[13px] text-destructive"
                          >
                            {error}
                          </p>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              ))}

              {streaming && (
                <div
                  aria-hidden
                  className="flex flex-col gap-1.5"
                >
                  <Skeleton className="h-14 w-full rounded-[24px]" />
                </div>
              )}
            </FormFieldGroup>
          </AutoHeight>

          <SurfaceFooter className="flex-col items-stretch gap-2">
            <p aria-live="polite" className={genuiType.meta}>
              {streaming ? (
                <ShimmeringText
                  text="Preparing form…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                />
              ) : status === "submitting" ? (
                "Submitting…"
              ) : invalidCount > 0 ? (
                <span className="text-destructive">
                  {invalidCount === 1
                    ? "1 field needs attention."
                    : `${invalidCount} fields need attention.`}
                </span>
              ) : null}
            </p>
            {/* One full-width primary action; Cancel is a quiet text button. */}
            <WhyDisabled
              when={streaming && !locked}
              reason="Still loading…"
              className="w-full"
            >
              <Button
                type="submit"
                disabled={locked || streaming}
                className={formPrimaryClass}
              >
                {status === "submitting"
                  ? "Submitting…"
                  : (submitLabel ?? "Submit")}
              </Button>
            </WhyDisabled>
            <Button
              type="button"
              variant="ghost"
              onClick={cancel}
              disabled={locked}
              className="h-11 w-full rounded-[24px] text-muted-foreground"
            >
              Cancel
            </Button>
          </SurfaceFooter>
        </form>
      </Surface>
    </MotionConfig>
  );
}
