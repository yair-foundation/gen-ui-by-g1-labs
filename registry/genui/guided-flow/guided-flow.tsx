"use client";

import * as React from "react";
import { CheckIcon, XIcon } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height";
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering";
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
} from "@/components/genui/surface";
import { CheckMark, RadioMark } from "@/components/genui/genui-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/genui/date-picker";
import {
  FormField,
  FormFieldGroup,
  formDateClass,
  formExampleClass,
  formInputClass,
  formTextareaClass,
} from "@/components/genui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import type {
  FlowField,
  FlowOption,
  FlowSlot,
  FlowStep,
  GuidedFlowInput,
  GuidedFlowResult,
  GuidedFlowValue,
} from "./guided-flow.schema";
import { IconTip, WhyDisabled } from "@/components/genui/hint";
import { useGenUILocale } from "@/components/genui/locale";

export type GuidedFlowStatus =
  | "streaming"
  | "ready"
  | "submitted"
  | "cancelled";

/** A step as it may arrive while the tool call streams. */
type PartialStep = {
  id?: string;
  title?: string;
  description?: string;
  type?: FlowStep["type"];
  options?: Partial<FlowOption>[];
  multiple?: boolean;
  fields?: Partial<FlowField>[];
  slots?: Partial<FlowSlot>[];
};

type ReadyStep = PartialStep & {
  id: string;
  title: string;
  type: FlowStep["type"];
};

type Values = Record<string, GuidedFlowValue>;

export type GuidedFlowProps = Partial<Omit<GuidedFlowInput, "steps">> & {
  /** Steps may be partial while the tool call is still streaming. */
  steps?: PartialStep[];
  /**
   * Lifecycle, controlled by the host. While 'streaming', the user can work
   * through the steps that have arrived, but cannot submit.
   * When omitted, the component tracks the user's decision itself.
   */
  status?: GuidedFlowStatus;
  /** Called once with the user's answers. Send it back to the agent. */
  onResult?: (result: GuidedFlowResult) => void;
  /**
   * A result from history (e.g. the tool call's stored output). Renders the
   * read-only summary and never calls onResult.
   */
  result?: GuidedFlowResult;
  className?: string;
};

// ---- Values and validation ----------------------------------------------

function readyOptions(step: PartialStep) {
  return (step.options ?? []).filter(
    (o): o is FlowOption =>
      typeof o.value === "string" && typeof o.label === "string",
  );
}

function readyFields(step: PartialStep) {
  return (step.fields ?? []).filter(
    (f): f is FlowField & { id: string; label: string } =>
      typeof f.id === "string" && typeof f.label === "string",
  );
}

function readySlots(step: PartialStep) {
  return (step.slots ?? []).filter(
    (s): s is FlowSlot & { id: string; label: string } =>
      typeof s.id === "string" && typeof s.label === "string",
  );
}

function selectedOf(value: GuidedFlowValue | undefined): string[] {
  if (Array.isArray(value)) return value;
  return typeof value === "string" && value ? [value] : [];
}

function fieldValues(
  value: GuidedFlowValue | undefined,
): Record<string, string> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function isValidDate(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

/** An inline error message for a field value, or null when it's valid. */
export function validateField(field: Partial<FlowField>, raw: string) {
  const value = raw.trim();
  if (!value)
    return field.required
      ? `${field.label ?? "This field"} is required.`
      : null;
  switch (field.type) {
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
        ? null
        : "Enter a valid email address.";
    case "tel":
      return /^[+\d\s().-]+$/.test(value) &&
        value.replace(/\D/g, "").length >= 7
        ? null
        : "Enter a valid phone number.";
    case "number":
      return Number.isFinite(Number(value)) ? null : "Enter a number.";
    case "date":
      return isValidDate(value) ? null : "Enter a valid date.";
    default:
      return null;
  }
}

/** Whether the user may continue past a step with this value. */
export function isStepValid(
  step: PartialStep,
  value: GuidedFlowValue | undefined,
) {
  switch (step.type) {
    case "choice": {
      const options = readyOptions(step).map((o) => o.value);
      return selectedOf(value).some((v) => options.includes(v));
    }
    case "slots": {
      const id = typeof value === "string" ? value : "";
      return readySlots(step).some((s) => s.id === id && s.available !== false);
    }
    case "fields": {
      const values = fieldValues(value);
      return readyFields(step).every(
        (f) => validateField(f, values[f.id] ?? "") === null,
      );
    }
    default:
      return true;
  }
}

/** "2026-10-16" → "Fri, Oct 16, 2026" in the user's locale. */
export function formatDate(value: string, locale: string) {
  if (!isValidDate(value)) return value;
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(y, m - 1, d));
}

/** One line describing a step's answer, for the review and the summary. */
export function describeValue(
  step: PartialStep,
  value: GuidedFlowValue | undefined,
  locale: string,
) {
  switch (step.type) {
    case "choice": {
      const options = readyOptions(step);
      return selectedOf(value)
        .map((v) => options.find((o) => o.value === v)?.label ?? v)
        .join(", ");
    }
    case "slots": {
      const id = typeof value === "string" ? value : "";
      return readySlots(step).find((s) => s.id === id)?.label ?? id;
    }
    case "fields": {
      const values = fieldValues(value);
      return readyFields(step)
        .map((f) => {
          const v = (values[f.id] ?? "").trim();
          return f.type === "date" && v ? formatDate(v, locale) : v;
        })
        .filter(Boolean)
        .join(" · ");
    }
    default:
      return "";
  }
}

/** The value sent to the agent: trimmed, empty optional fields left out. */
function normalize(step: ReadyStep, value: GuidedFlowValue | undefined) {
  if (step.type === "choice") {
    const selected = selectedOf(value);
    return step.multiple ? selected : (selected[0] ?? "");
  }
  if (step.type === "fields") {
    const values = fieldValues(value);
    return Object.fromEntries(
      readyFields(step)
        .map((f) => [f.id, (values[f.id] ?? "").trim()] as const)
        .filter(([, v]) => v !== ""),
    );
  }
  return typeof value === "string" ? value : "";
}

// ---- Step bodies ---------------------------------------------------------

function OptionRow({
  option,
  checked,
  multi,
  onSelect,
}: {
  option: FlowOption;
  checked: boolean;
  multi: boolean;
  onSelect: () => void;
}) {
  const ariaProps = {
    role: multi ? "checkbox" : "radio",
    "aria-checked": checked,
  };
  return (
    <button
      type="button"
      {...ariaProps}
      onClick={onSelect}
      className={cn(
        "flex w-full cursor-pointer items-start gap-3 rounded-[10px] p-3 text-left transition-colors outline-none",
        "hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-white/5",
        checked && "ring-2 ring-choice ring-inset border-choice hover:bg-transparent dark:hover:bg-transparent",
      )}
    >
      {multi ? (
        <span
          aria-hidden
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-[6px] border border-input transition-colors",
            checked && "border-choice bg-choice text-background",
          )}
        >
          {checked && <CheckMark />}
        </span>
      ) : (
        <RadioMark checked={checked} className="-mt-0.5" />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn(genuiType.body, "font-medium")}>
          {option.label}
        </span>
        {option.description && (
          <span className={genuiType.meta}>{option.description}</span>
        )}
      </span>
    </button>
  );
}

function ChoiceBody({
  step,
  value,
  labelId,
  streaming,
  onChange,
}: {
  step: ReadyStep;
  value: GuidedFlowValue | undefined;
  labelId: string;
  streaming: boolean;
  onChange: (value: GuidedFlowValue) => void;
}) {
  const options = readyOptions(step);
  const selected = selectedOf(value);
  const multi = step.multiple === true;
  return (
    <div
      {...{ role: multi ? "group" : "radiogroup", "aria-labelledby": labelId }}
      className="flex flex-col gap-2"
    >
      {options.map((o) => (
        <OptionRow
          key={o.value}
          option={o}
          multi={multi}
          checked={selected.includes(o.value)}
          onSelect={() =>
            onChange(
              multi
                ? selected.includes(o.value)
                  ? selected.filter((v) => v !== o.value)
                  : [...selected, o.value]
                : o.value,
            )
          }
        />
      ))}
      {streaming && options.length < 2 && (
        <Skeleton className="h-14 rounded-[10px]" />
      )}
    </div>
  );
}

function SlotsBody({
  step,
  value,
  labelId,
  streaming,
  onChange,
}: {
  step: ReadyStep;
  value: GuidedFlowValue | undefined;
  labelId: string;
  streaming: boolean;
  onChange: (value: GuidedFlowValue) => void;
}) {
  const slots = readySlots(step);
  const picked = typeof value === "string" ? value : "";
  const none =
    !streaming && slots.length > 0 && slots.every((s) => s.available === false);
  return (
    <div className="flex flex-col gap-2">
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {slots.map((s) => {
          const available = s.available !== false;
          const checked = picked === s.id;
          return (
            // biome-ignore lint/a11y/useSemanticElements: a button keeps each slot one styled, focusable tap target; it exposes radio semantics via role and aria-checked
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={!available}
              onClick={() => onChange(s.id)}
              className={cn(
                "flex min-h-10 items-center justify-center rounded-full border border-border bg-transparent px-3.5 py-2 text-[13px] tabular-nums transition-colors outline-none",
                "hover:bg-accent focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-white/5",
                "disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:text-muted-foreground disabled:line-through disabled:decoration-muted-foreground/60 disabled:bg-transparent",
                checked && "ring-2 ring-choice ring-inset",
              )}
            >
              {s.label}
              {!available && <span className="sr-only">, unavailable</span>}
            </button>
          );
        })}
        {streaming && slots.length === 0 && (
          <>
            <Skeleton className="h-10 rounded-full" />
            <Skeleton className="h-10 rounded-full" />
          </>
        )}
      </div>
      {none && (
        <p className={cn(genuiType.body, "text-muted-foreground")}>
          Nothing available.
          <span className="sr-only">
            {" "}
            Go back to change an earlier answer, or cancel.
          </span>
        </p>
      )}
    </div>
  );
}

function FieldsBody({
  step,
  value,
  baseId,
  touched,
  streaming,
  onChange,
  onTouch,
}: {
  step: ReadyStep;
  value: GuidedFlowValue | undefined;
  baseId: string;
  touched: Set<string>;
  streaming: boolean;
  onChange: (value: GuidedFlowValue) => void;
  onTouch: (fieldId: string) => void;
}) {
  const fields = readyFields(step);
  const values = fieldValues(value);
  if (fields.length === 0 && !streaming) return null;
  // In a form every field gets its own row (docs/design/components.md, Forms).
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only stops Enter bubbling to the step once the field group has moved focus
    <div
      onKeyDown={(e) => {
        // The group moved Enter to the next field; only the last one continues.
        if (e.key === "Enter" && document.activeElement !== e.target)
          e.stopPropagation();
      }}
    >
      <FormFieldGroup className="border-t border-border px-3 py-3">
        {fields.map((f) => {
          const id = `${baseId}-${step.id}-${f.id}`;
          const v = values[f.id] ?? "";
          const error = touched.has(`${step.id}.${f.id}`)
            ? validateField(f, v)
            : null;
          const common = {
            id,
            name: f.id,
            value: v,
            placeholder: f.placeholder,
            "aria-required": f.required || undefined,
            "aria-invalid": error ? true : undefined,
            "aria-describedby": error ? `${id}-error` : undefined,
            onBlur: () => onTouch(f.id),
            onChange: (
              e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
            ) => onChange({ ...values, [f.id]: e.target.value }),
          };
          return (
            <FormField
              key={f.id}
              htmlFor={id}
              label={f.label}
              required={f.required}
              filled={v !== ""}
              pinned={
                f.type === "textarea" ||
                f.type === "date" ||
                // An example placeholder needs the label up to stay visible.
                Boolean(f.placeholder)
              }
              error={error}
              errorId={`${id}-error`}
            >
              {f.type === "textarea" ? (
                <Textarea {...common} className={formTextareaClass} />
              ) : f.type === "date" ? (
                <DatePicker
                  id={id}
                  type="date"
                  value={v}
                  onValueChange={(nv) => {
                    onChange({ ...values, [f.id]: nv });
                    onTouch(f.id);
                  }}
                  className={formDateClass}
                />
              ) : (
                <Input
                  {...common}
                  type={
                    f.type === "tel" ||
                    f.type === "email" ||
                    f.type === "number"
                      ? f.type
                      : "text"
                  }
                  inputMode={
                    f.type === "number"
                      ? "decimal"
                      : f.type === "tel"
                        ? "tel"
                        : f.type === "email"
                          ? "email"
                          : undefined
                  }
                  autoComplete={
                    f.type === "email"
                      ? "email"
                      : f.type === "tel"
                        ? "tel"
                        : undefined
                  }
                  className={cn(
                    formInputClass,
                    f.placeholder && formExampleClass,
                  )}
                />
              )}
            </FormField>
          );
        })}
        {streaming && fields.length === 0 && (
          <Skeleton className="h-14 w-full rounded-[24px]" />
        )}
      </FormFieldGroup>
    </div>
  );
}

function ReviewBody({
  steps,
  values,
  onEdit,
}: {
  steps: ReadyStep[];
  values: Values;
  onEdit: (stepId: string) => void;
}) {
  const locale = useGenUILocale();
  return (
    <dl className="flex flex-col divide-y divide-border">
      {steps.map((s) => {
        const text = describeValue(s, values[s.id], locale);
        return (
          <div
            key={s.id}
            className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-center gap-x-3 py-2.5 first:pt-0 last:pb-0"
          >
            <dt className={genuiType.label}>{s.title}</dt>
            <dd
              className={cn(
                genuiType.body,
                "font-medium break-words",
                !text && "font-normal text-muted-foreground",
              )}
            >
              {text || "Not answered"}
            </dd>
            <Button
              size="sm"
              variant="secondary"
              aria-label={`Edit ${s.title}`}
              onClick={() => onEdit(s.id)}
              className="-mr-2 shrink-0"
            >
              Edit
            </Button>
          </div>
        );
      })}
    </dl>
  );
}

// ---- Component -----------------------------------------------------------

export function GuidedFlow({
  title,
  steps = [],
  submitLabel,
  status: statusProp,
  onResult,
  result,
  className,
}: GuidedFlowProps) {
  const locale = useGenUILocale();
  const [index, setIndex] = React.useState(0);
  // 1 = forward, -1 = back; drives the slide direction between steps.
  const [direction, setDirection] = React.useState(1);
  // Set when the user jumps from the review to edit a step.
  const [returnTo, setReturnTo] = React.useState<number | null>(null);
  // Restored from `result` when the flow is already in history.
  const [values, setValues] = React.useState<Values>(() =>
    result?.action === "submit" ? result.values : {},
  );
  const [touched, setTouched] = React.useState<Set<string>>(() => new Set());
  const [decision, setDecision] = React.useState<
    "submitted" | "cancelled" | null
  >(() =>
    result ? (result.action === "submit" ? "submitted" : "cancelled") : null,
  );
  const baseId = React.useId();
  const stepLineRef = React.useRef<HTMLParagraphElement>(null);
  const moved = React.useRef(false);

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: GuidedFlowStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready");
  const streaming = status === "streaming";
  const done = status === "submitted" || status === "cancelled";

  const ready = steps.filter(
    (s): s is ReadyStep =>
      typeof s.id === "string" &&
      typeof s.title === "string" &&
      typeof s.type === "string",
  );
  const answerable = ready.filter((s) => s.type !== "review");
  const position = Math.min(index, Math.max(ready.length - 1, 0));
  const current = ready[position] as ReadyStep | undefined;
  const value = current ? values[current.id] : undefined;
  const valid = !!current && isStepValid(current, value);
  const isLast = !streaming && position >= ready.length - 1;
  const hasNext = position < ready.length - 1;

  // Move focus to the step line after navigating, so the new step is announced.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on step change only
  React.useEffect(() => {
    if (moved.current) stepLineRef.current?.focus();
  }, [position]);

  const setValue = (v: GuidedFlowValue) => {
    if (!current) return;
    const id = current.id;
    setValues((prev) => ({ ...prev, [id]: v }));
  };

  const touch = (fieldId: string) => {
    if (!current) return;
    const key = `${current.id}.${fieldId}`;
    setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  };

  const goTo = (i: number) => {
    moved.current = true;
    setDirection(i >= position ? 1 : -1);
    setIndex(i);
  };

  const submit = () => {
    setDecision("submitted");
    onResult?.({
      action: "submit",
      values: Object.fromEntries(
        answerable.map((s) => [s.id, normalize(s, values[s.id])]),
      ),
    });
  };

  const next = () => {
    if (!current) return;
    if (!valid) {
      // Reveal every error on the step, e.g. after pressing Enter early.
      const keys = readyFields(current).map((f) => `${current.id}.${f.id}`);
      setTouched((prev) => new Set([...prev, ...keys]));
      return;
    }
    if (returnTo !== null && returnTo !== position) {
      setReturnTo(null);
      goTo(returnTo);
    } else if (isLast) submit();
    else if (hasNext) goTo(position + 1);
  };

  const cancel = () => {
    setDecision("cancelled");
    onResult?.({ action: "cancel" });
  };

  const editStep = (stepId: string) => {
    const i = ready.findIndex((s) => s.id === stepId);
    if (i < 0) return;
    setReturnTo(position);
    goTo(i);
  };

  // First child in both layouts, so React keeps the same live region node
  // and the outcome is announced when the flow finishes.
  const announcer = (
    <p aria-live="polite" className="sr-only">
      {status === "submitted"
        ? "Submitted."
        : status === "cancelled"
          ? "Cancelled. Nothing was sent."
          : ""}
    </p>
  );

  // Finished: a compact, read-only record for the chat history.
  if (done) {
    return (
      <MotionConfig reducedMotion="user">
        <Surface
          data-slot="guided-flow"
          data-status={status}
          aria-label={title ?? "Guided flow"}
          className={className}
        >
          {announcer}
          <SurfaceHeader
            className={cn("flex-row items-center justify-between gap-3 pb-3")}
          >
            <SurfaceTitle>{title}</SurfaceTitle>
            <Badge
              variant={status === "submitted" ? "success" : "outline"}
              className="shrink-0"
            >
              {status === "submitted" ? (
                <>
                  <CheckIcon aria-hidden />
                  Submitted
                </>
              ) : (
                <>
                  <XIcon aria-hidden />
                  Cancelled
                </>
              )}
            </Badge>
          </SurfaceHeader>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            {status === "cancelled" ? null : (
              <dl className="flex flex-col divide-y divide-border border-t border-border px-3 py-1">
                {answerable.map((s) => {
                  const text = describeValue(s, values[s.id], locale);
                  return (
                    <div
                      key={s.id}
                      className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 py-2.5"
                    >
                      <dt className={genuiType.label}>{s.title}</dt>
                      <dd
                        className={cn(
                          genuiType.body,
                          "font-medium break-words",
                          !text && "font-normal text-muted-foreground",
                        )}
                      >
                        {text || "Not answered"}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </motion.div>
        </Surface>
      </MotionConfig>
    );
  }

  const total = streaming ? Math.max(ready.length, position + 1) : ready.length;
  const titleId = `${baseId}-step-title`;
  const returning = returnTo !== null && returnTo !== position;

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="guided-flow"
        data-status={status}
        aria-busy={streaming}
        aria-label={title ?? "Guided flow"}
        className={className}
      >
        {announcer}
        <SurfaceHeader className="flex-row items-center gap-3 pb-3">
          {/* The flow title restates the request, so it's read, not shown. */}
          {title && <h3 className="sr-only">{title}</h3>}
          {/* Progress: one segment per step. The step line is the accessible value. */}
          <div aria-hidden className="flex flex-1 gap-1">
            {Array.from({ length: Math.max(total, 1) }, (_, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: static positional list
                key={i}
                className={cn(
                  "h-1.5 flex-1 rounded-full bg-muted transition-colors",
                  i > position && "dark:bg-white/10",
                  i < position && "bg-choice/40",
                  i === position && "bg-choice",
                )}
              />
            ))}
          </div>
          <IconTip label={title ? `Cancel: ${title}` : "Cancel"}>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={title ? `Cancel: ${title}` : "Cancel"}
              onClick={cancel}
              className="-mr-2"
            >
              <XIcon />
            </Button>
          </IconTip>
        </SurfaceHeader>

        {/* Height follows the step; steps slide in their direction. */}
        <AutoHeight>
          <AnimatePresence mode="popLayout" initial={false} custom={direction}>
            {current ? (
              <motion.div
                key={current.id}
                custom={direction}
                variants={{
                  enter: (d: number) => ({ opacity: 0, x: d * 16 }),
                  center: { opacity: 1, x: 0 },
                  exit: (d: number) => ({ opacity: 0, x: d * -16 }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.18, ease: "easeOut" }}
                onKeyDown={(e: React.KeyboardEvent) => {
                  // Enter in a single-line input continues, like a form.
                  if (
                    e.key === "Enter" &&
                    e.target instanceof HTMLInputElement &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    next();
                  }
                }}
                className="flex flex-col"
              >
                <div className="flex flex-col gap-1 border-t border-border px-3 py-3">
                  <p
                    ref={stepLineRef}
                    tabIndex={-1}
                    className={cn(genuiType.title, "outline-none")}
                  >
                    <span className="sr-only">
                      Step {position + 1} of {streaming ? `${total}…` : total}:{" "}
                    </span>
                    <span id={titleId}>{current.title}</span>
                  </p>
                  {current.description && (
                    <p className={genuiType.meta}>{current.description}</p>
                  )}
                </div>
                {current.type === "choice" ? (
                  <div className="border-t border-border px-3 py-3">
                    <ChoiceBody
                      step={current}
                      value={value}
                      labelId={titleId}
                      streaming={streaming}
                      onChange={setValue}
                    />
                  </div>
                ) : current.type === "slots" ? (
                  <div className="border-t border-border px-3 py-3">
                    <SlotsBody
                      step={current}
                      value={value}
                      labelId={titleId}
                      streaming={streaming}
                      onChange={setValue}
                    />
                  </div>
                ) : current.type === "fields" ? (
                  <FieldsBody
                    step={current}
                    value={value}
                    baseId={baseId}
                    touched={touched}
                    streaming={streaming}
                    onChange={setValue}
                    onTouch={touch}
                  />
                ) : (
                  <div className="border-t border-border px-3 py-3">
                    <ReviewBody
                      steps={answerable.filter(
                        (s) => ready.indexOf(s) < position,
                      )}
                      values={values}
                      onEdit={editStep}
                    />
                  </div>
                )}
              </motion.div>
            ) : (
              <div
                key="loading"
                className="flex flex-col gap-2 border-t border-border px-3 py-3"
              >
                <ShimmeringText
                  text="Preparing the steps…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                  className={genuiType.body}
                />
                <Skeleton className="h-14 rounded-[10px]" />
                <Skeleton className="h-14 rounded-[10px]" />
              </div>
            )}
          </AnimatePresence>
        </AutoHeight>

        <SurfaceFooter>
          <WhyDisabled reason={position === 0 && "This is the first step"}>
            <Button
              size="sm"
              variant="secondary"
              disabled={position === 0 || !current}
              onClick={() => goTo(position - 1)}
            >
              Back
            </Button>
          </WhyDisabled>
          <WhyDisabled reason={!valid ? "Complete this step first" : !returning && !isLast && !hasNext && "Waiting for the next step"} className="ml-auto inline-flex">
            <Button
              size="sm"
              className="ml-auto"
              onClick={next}
              disabled={!valid || (!returning && !isLast && !hasNext)}
            >
              {returning
                ? "Back to review"
                : isLast
                  ? (submitLabel ?? "Submit")
                  : "Next"}
            </Button>
          </WhyDisabled>
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  );
}
