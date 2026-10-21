"use client";

import * as React from "react";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckIcon,
  MessageSquareIcon,
  PencilIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import { MotionConfig, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/animate-ui/components/base/checkbox";
import { Switch } from "@/components/animate-ui/components/base/switch";
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height";
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface";

import type {
  ChangeItem,
  ChangePreviewInput,
  ChangePreviewResult,
  ChangeValue,
} from "./change-preview.schema";
import { IconTip, WhyDisabled } from "@/components/genui/hint";
import { useGenUILocale } from "@/components/genui/locale";

/** Explains a disabled button. Disabled controls swallow pointer events, so the span takes the hover. */
export type ChangePreviewStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "applied"
  | "rejected"
  | "revised";

type PartialItem = Partial<Omit<ChangeItem, "kind" | "editable">> & {
  kind?: ChangeItem["kind"];
  editable?: boolean;
};

export type ChangePreviewProps = Partial<
  Omit<ChangePreviewInput, "changes">
> & {
  /** Items may be partial while the tool call is still streaming. */
  changes?: PartialItem[];
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props; 'submitting' while the host applies the result.
   * When omitted, the component tracks the user's decision itself.
   */
  status?: ChangePreviewStatus;
  /** Called once with the user's decision. Send it back to the agent. */
  onResult?: (result: ChangePreviewResult) => void;
  /**
   * A decision from history (e.g. the tool call's stored output). Renders the
   * finished state, edits and skips included, and never calls onResult.
   */
  result?: ChangePreviewResult;
  className?: string;
};

type Op = "add" | "remove" | "change" | "none";

function getOp(
  before: ChangeValue | undefined,
  after: ChangeValue | undefined,
): Op {
  if (before === after) return "none";
  if (before === null || before === undefined) return "add";
  if (after === null) return "remove";
  return "change";
}

function formatValue(
  value: ChangeValue | undefined,
  item: PartialItem,
  locale: string,
): string {
  if (value === null || value === undefined || value === "") return "Not set";
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (item.kind === "select") {
    return item.options?.find((o) => o.value === value)?.label ?? String(value);
  }
  if (typeof value === "number") {
    if (item.kind === "currency" && item.currency) {
      try {
        return new Intl.NumberFormat(locale, {
          style: "currency",
          currency: item.currency,
        }).format(value);
      } catch {
        // Fall through for invalid currency codes.
      }
    }
    return new Intl.NumberFormat(locale).format(value);
  }
  return value;
}

/** Field name plus its group, so repeated labels stay distinguishable. */
function accessibleName(item: PartialItem) {
  return item.group ? `${item.label} (${item.group})` : (item.label ?? "field");
}

function ValueEditor({
  item,
  value,
  onChange,
  onDone,
  onCancel,
}: {
  item: PartialItem;
  value: ChangeValue;
  onChange: (value: ChangeValue) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter" && item.kind !== "longtext") {
      e.preventDefault();
      onDone();
    }
  };
  const label = `New value for ${accessibleName(item)}`;

  switch (item.kind) {
    case "boolean":
      return (
        <Switch
          nativeButton
          aria-label={label}
          checked={Boolean(value)}
          onCheckedChange={(checked) => onChange(checked)}
        />
      );
    case "select":
      return (
        <Select
          value={value === null ? null : String(value)}
          onValueChange={(v) => onChange(v as string | null)}
          items={item.options ?? []}
        >
          <SelectTrigger aria-label={label} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {item.options?.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "longtext":
      return (
        <Textarea
          aria-label={label}
          autoFocus
          value={value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="min-h-20 w-full"
        />
      );
    case "number":
    case "currency":
      return (
        <Input
          aria-label={label}
          autoFocus
          type="number"
          inputMode="decimal"
          value={value === null ? "" : String(value)}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) =>
            onChange(e.target.value === "" ? null : Number(e.target.value))
          }
          onKeyDown={onKeyDown}
          className="w-full"
        />
      );
    default:
      return (
        <Input
          aria-label={label}
          autoFocus
          value={value === null ? "" : String(value)}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
      );
  }
}

function ChangeRow({
  item,
  value,
  edited,
  included,
  selectable,
  locked,
  onToggle,
  onEdit,
  onReset,
}: {
  item: PartialItem;
  value: ChangeValue | undefined;
  edited: boolean;
  included: boolean;
  selectable: boolean;
  locked: boolean;
  onToggle: (included: boolean) => void;
  onEdit: (value: ChangeValue) => void;
  onReset: () => void;
}) {
  const locale = useGenUILocale();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<ChangeValue>(value ?? null);
  const op = getOp(item.before, value);
  const canEdit = !locked && item.editable !== false && included;
  const hasWarning = Boolean(item.warning) && included;

  const startEdit = () => {
    setDraft(value ?? null);
    setEditing(true);
  };
  const commit = () => {
    onEdit(draft);
    setEditing(false);
  };

  // The checkbox and the change text form one clickable label, except while
  // the inline editor (its own fields and buttons) is open.
  const Toggle = selectable && !editing ? "label" : "div";

  return (
    <motion.li
      data-slot="change-preview-row"
      data-included={included}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={genuiMotion.fade}
      className="px-3"
    >
      {/* Three columns on every row: setting | value or editor | actions. */}
      <div className="flex items-center gap-3">
        <Toggle
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3",
            "py-3",
            Toggle === "label" && "-mx-2 rounded-lg px-2 transition-colors",
            Toggle === "label" &&
              (locked ? "cursor-default" : "cursor-pointer hover:bg-muted"),
          )}
        >
          {selectable && (
            <Checkbox
              nativeButton
              aria-label={`Include ${accessibleName(item)}`}
              checked={included}
              disabled={locked}
              onCheckedChange={(checked) => onToggle(Boolean(checked))}
              size="sm"
              // Larger tap area than the 18px box, without changing its look.
              className="relative mt-px after:absolute after:-inset-2"
            />
          )}

          <motion.div
            animate={{ opacity: included ? 1 : 0.65 }}
            transition={{ duration: 0.2 }}
            className="flex min-w-0 flex-1 flex-col gap-0.5 @md:flex-row @md:items-center @md:gap-4"
          >
            <div className={cn(genuiType.label, "min-w-0 @md:w-1/3")}>
              {item.label}
              {/* The reason stays available to screen readers, not on screen. */}
              {item.note && <span className="sr-only">. {item.note}</span>}
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {item.before === undefined && item.after === undefined ? (
                // Values haven't streamed in yet ('null' is a real value).
                <Skeleton className="h-4 w-40 max-w-full" />
              ) : editing ? (
                // The editor fills the value column; its actions sit in the row's actions column.
                <div className="flex min-w-0 items-center">
                  <ValueEditor
                    item={item}
                    value={draft}
                    onChange={setDraft}
                    onDone={commit}
                    onCancel={() => setEditing(false)}
                  />
                </div>
              ) : (
                <div
                  className={cn(
                    genuiType.body,
                    "flex flex-wrap items-center gap-x-2 gap-y-1",
                  )}
                >
                  {op !== "add" && (
                    <span
                      className={cn(
                        "break-words text-muted-foreground tabular-nums",
                        op !== "none" &&
                          "line-through decoration-muted-foreground/60",
                      )}
                    >
                      <span className="sr-only">From </span>
                      {formatValue(item.before, item, locale)}
                    </span>
                  )}
                  {(op === "change" || op === "remove") && (
                    <ArrowRightIcon
                      aria-hidden
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                  )}
                  {op === "remove" ? (
                    <span className="font-medium text-destructive">
                      Removed
                    </span>
                  ) : op !== "none" ? (
                    <span className="font-medium break-words tabular-nums">
                      <span className="sr-only">
                        {op === "add" ? "New: " : "to "}
                      </span>
                      {formatValue(value, item, locale)}
                    </span>
                  ) : (
                    <span className={genuiType.meta}>No change</span>
                  )}
                  {edited && <span className={genuiType.meta}>Edited</span>}
                  {locked && !included && (
                    <span className={genuiType.meta}>Skipped</span>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </Toggle>

        {!locked && (
          // A stable, right-aligned actions column on every row while the card
          // can be edited, so values line up whatever each row offers. Row
          // actions stay quieter than the card's final action in the footer.
          <div className="flex shrink-0 items-center justify-end gap-1 @md:w-36">
            {editing ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
                <Button size="sm" variant="secondary" onClick={commit}>
                  Done
                </Button>
              </>
            ) : (
              canEdit && (
                <>
                  {edited && (
                    <IconTip
                      label={`Reset ${accessibleName(item)} to proposed value`}
                    >
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Reset ${accessibleName(item)} to proposed value`}
                        onClick={onReset}
                      >
                        <RotateCcwIcon />
                      </Button>
                    </IconTip>
                  )}
                  <IconTip label={`Edit ${accessibleName(item)}`}>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Edit ${accessibleName(item)}`}
                      onClick={startEdit}
                    >
                      <PencilIcon />
                    </Button>
                  </IconTip>
                </>
              )
            )}
          </div>
        )}
      </div>
      {hasWarning && (
        // Under the value column, so the row's actions center on the value or editor.
        <div className="-mt-2 flex gap-3 pb-3">
          {selectable && <span aria-hidden className="w-5 shrink-0" />}
          <div className="flex min-w-0 flex-1 @md:gap-4">
            <span aria-hidden className="hidden shrink-0 @md:block @md:w-1/3" />
            <p
              className={cn(
                genuiType.meta,
                "flex min-w-0 flex-1 items-start gap-1.5 text-foreground",
              )}
            >
              <AlertTriangleIcon
                aria-hidden
                className="mt-px size-3.5 shrink-0 text-muted-foreground"
              />
              {item.warning}
            </p>
          </div>
          {!locked && (
            <span aria-hidden className="hidden shrink-0 @md:block @md:w-36" />
          )}
        </div>
      )}
    </motion.li>
  );
}

function RowSkeleton() {
  return (
    <li aria-hidden className="flex gap-3 px-3 py-3">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-4 flex-1" />
    </li>
  );
}

export function ChangePreview({
  title,
  description,
  target,
  changes = [],
  mode = "review",
  risk = "low",
  reversible = true,
  confirmLabel,
  status: statusProp,
  onResult,
  result,
  className,
}: ChangePreviewProps) {
  // Restored from `result` when the decision is already in history.
  const [edits, setEdits] = React.useState<Record<string, ChangeValue>>(() =>
    result?.action === "confirm"
      ? Object.fromEntries(
          result.changes.filter((c) => c.edited).map((c) => [c.id, c.value]),
        )
      : {},
  );
  const [skipped, setSkipped] = React.useState<Set<string>>(
    () => new Set(result?.action === "confirm" ? result.skipped : []),
  );
  const [decision, setDecision] = React.useState<
    "applied" | "rejected" | "revised" | null
  >(() =>
    result
      ? (
          { confirm: "applied", reject: "rejected", revise: "revised" } as const
        )[result.action]
      : null,
  );
  const [revising, setRevising] = React.useState(false);
  const [note, setNote] = React.useState(
    result?.action === "revise" ? result.note : "",
  );

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: ChangePreviewStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready");
  const streaming = status === "streaming";
  const locked = status !== "ready";
  const selectable = mode === "review";

  const ready = changes.filter(
    (c): c is PartialItem & { id: string } =>
      typeof c.id === "string" && !!c.label,
  );
  const currentValue = (c: PartialItem & { id: string }) =>
    c.id in edits ? edits[c.id] : c.after;
  const isIncluded = (id: string) => !selectable || !skipped.has(id);

  const includedCount = ready.filter((c) => isIncluded(c.id)).length;

  const groups = React.useMemo(() => {
    const map = new Map<string, (PartialItem & { id: string })[]>();
    for (const c of ready) {
      const key = c.group ?? "";
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return [...map.entries()];
  }, [ready]);

  const confirm = () => {
    const kept = ready.filter((c) => isIncluded(c.id));
    setDecision("applied");
    onResult?.({
      action: "confirm",
      changes: kept.map((c) => ({
        id: c.id,
        value: currentValue(c) ?? null,
        edited: c.id in edits,
      })),
      skipped: ready.filter((c) => !isIncluded(c.id)).map((c) => c.id),
    });
  };

  const reject = () => {
    setDecision("rejected");
    onResult?.({ action: "reject" });
  };

  const requestChanges = () => {
    const text = note.trim();
    if (!text) return;
    setRevising(false);
    setDecision("revised");
    onResult?.({ action: "revise", note: text });
  };

  const highRisk = risk === "high" || !reversible;
  const verb =
    confirmLabel ?? (mode === "overwrite" ? "Replace" : "Apply changes");

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="change-preview"
        data-status={status}
        aria-busy={streaming || status === "submitting"}
        aria-label={title ?? "Proposed changes"}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <SurfaceTitle>{title}</SurfaceTitle>
            {/* One badge for the one thing that changes the decision. */}
            {!reversible ? (
              <Badge variant="destructive">Can't be undone</Badge>
            ) : risk === "high" ? (
              <Badge variant="destructive">High impact</Badge>
            ) : null}
          </div>
          {target && (
            <p className={genuiType.meta}>
              {target.kind && <span className="sr-only">{target.kind}: </span>}
              {target.label}
            </p>
          )}
          {description && <p className="sr-only">{description}</p>}
          {mode === "overwrite" && (
            <p className="sr-only">Applying replaces the current values.</p>
          )}
        </SurfaceHeader>

        {/* Height animates as rows stream in and editors open. */}
        <AutoHeight>
          <div className="flex flex-col gap-5 border-t border-border py-2">
            {groups.map(([group, items]) => (
              <div key={group || "_"}>
                {group && (
                  <div
                    className={cn(
                      genuiType.body,
                      "px-3 pt-1 pb-1 font-semibold",
                    )}
                  >
                    {group}
                  </div>
                )}
                <ul className="@container">
                  {items.map((c) => (
                    <ChangeRow
                      key={c.id}
                      item={c}
                      value={currentValue(c)}
                      edited={c.id in edits}
                      included={isIncluded(c.id)}
                      selectable={selectable}
                      locked={locked}
                      onToggle={(on) =>
                        setSkipped((prev) => {
                          const next = new Set(prev);
                          if (on) next.delete(c.id);
                          else next.add(c.id);
                          return next;
                        })
                      }
                      onEdit={(v) =>
                        setEdits((prev) =>
                          v === c.after
                            ? Object.fromEntries(
                                Object.entries(prev).filter(
                                  ([k]) => k !== c.id,
                                ),
                              )
                            : { ...prev, [c.id]: v },
                        )
                      }
                      onReset={() =>
                        setEdits((prev) =>
                          Object.fromEntries(
                            Object.entries(prev).filter(([k]) => k !== c.id),
                          ),
                        )
                      }
                    />
                  ))}
                </ul>
              </div>
            ))}

            {streaming && (
              <ul className="@container">
                <RowSkeleton />
                {ready.length === 0 && <RowSkeleton />}
              </ul>
            )}
          </div>
        </AutoHeight>

        <SurfaceFooter
          aria-live="polite"
          className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          {status === "applied" ? (
            <p className={cn(genuiType.body, "flex items-center gap-1.5")}>
              <CheckIcon aria-hidden className="size-4" />
              Applied {includedCount}{" "}
              {includedCount === 1 ? "change" : "changes"}
              {ready.length - includedCount > 0 &&
                `, skipped ${ready.length - includedCount}`}
            </p>
          ) : status === "rejected" ? (
            <p
              className={cn(
                genuiType.body,
                "flex items-center gap-1.5 text-muted-foreground",
              )}
            >
              <XIcon aria-hidden className="size-4" />
              Rejected. Nothing changed.
            </p>
          ) : status === "revised" ? (
            <p
              className={cn(
                genuiType.body,
                "flex items-start gap-1.5 text-muted-foreground",
              )}
            >
              <MessageSquareIcon
                aria-hidden
                className="mt-0.5 size-4 shrink-0"
              />
              <span>
                Changes requested
                {note && <span className="text-foreground">: “{note}”</span>}
              </span>
            </p>
          ) : revising ? (
            // "Request changes": the user steers the proposal instead of
            // accepting or rejecting it outright.
            <div className="flex w-full flex-col gap-2">
              <Textarea
                autoFocus
                aria-label="What should change?"
                placeholder="What should change?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                    requestChanges();
                  if (e.key === "Escape") setRevising(false);
                }}
                className="min-h-16"
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setRevising(false)}
                >
                  Cancel
                </Button>
                <WhyDisabled
                  when={!note.trim()}
                  reason="Write what should change"
                >
                  <Button
                    size="sm"
                    onClick={requestChanges}
                    disabled={!note.trim()}
                  >
                    Send request
                  </Button>
                </WhyDisabled>
              </div>
            </div>
          ) : (
            <>
              <p className={genuiType.meta}>
                {streaming ? (
                  <ShimmeringText
                    text="Preparing changes…"
                    color="var(--muted-foreground)"
                    shimmeringColor="var(--foreground)"
                  />
                ) : status === "submitting" ? (
                  "Applying…"
                ) : selectable && includedCount < ready.length ? (
                  // Only worth a line once the user has skipped something.
                  `${includedCount} of ${ready.length} selected`
                ) : null}
              </p>
              <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                <IconTip label="Request changes">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Request changes"
                    onClick={() => setRevising(true)}
                    disabled={locked}
                  >
                    <MessageSquareIcon />
                  </Button>
                </IconTip>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={reject}
                  disabled={locked}
                  className="flex-1 sm:flex-none"
                >
                  Reject
                </Button>
                <WhyDisabled
                  when={!locked && includedCount === 0}
                  reason="Select at least one change"
                  className="flex-1 sm:flex-none"
                >
                  <Button
                    size="sm"
                    variant={highRisk ? "destructive" : "default"}
                    onClick={confirm}
                    disabled={locked || includedCount === 0}
                    className="flex-1 sm:flex-none"
                  >
                    {status === "submitting" ? "Applying…" : verb}
                  </Button>
                </WhyDisabled>
              </div>
            </>
          )}
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  );
}
