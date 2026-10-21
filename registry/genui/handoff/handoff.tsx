"use client";

import * as React from "react";
import {
  BotIcon,
  BuildingIcon,
  CalendarIcon,
  CheckIcon,
  CircleDashedIcon,
  ClockIcon,
  CreditCardIcon,
  FileTextIcon,
  ListChecksIcon,
  type LucideIcon,
  MailIcon,
  MapPinIcon,
  PackageIcon,
  PhoneIcon,
  ShieldIcon,
  StarIcon,
  TagIcon,
  UserIcon,
  UsersIcon,
  WalletIcon,
} from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
} from "@/components/genui/surface";
import {
  CheckMark,
  SwapText,
  genuiEase,
  genuiStepIn,
} from "@/components/genui/genui-motion";

import type {
  HandoffContextRow,
  HandoffIcon,
  HandoffInput,
  HandoffResult,
} from "./handoff.schema";
import { WhyDisabled } from "@/components/genui/hint";
import { ScrollFade } from "@/components/genui/scroll-fade";

export type HandoffStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "confirmed"
  | "kept";

export type HandoffProps = Partial<
  Omit<HandoffInput, "to" | "context" | "done" | "left">
> & {
  /** Every list and object may be partial while the tool call streams. */
  to?: Partial<HandoffInput["to"]>;
  context?: Partial<HandoffContextRow>[];
  done?: (string | undefined)[];
  left?: (string | undefined)[];
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props; 'submitting' while the host acts on the decision.
   * When omitted, the component tracks the user's decision itself.
   */
  status?: HandoffStatus;
  /** Called once with the user's decision. Send it back to the agent. */
  onResult?: (result: HandoffResult) => void;
  /** A decision from history. Renders the record and never calls onResult. */
  result?: HandoffResult;
  className?: string;
};

const NOTE_MAX = 600;

const ICONS: Record<HandoffIcon, LucideIcon> = {
  calendar: CalendarIcon,
  clock: ClockIcon,
  user: UserIcon,
  users: UsersIcon,
  "map-pin": MapPinIcon,
  wallet: WalletIcon,
  "credit-card": CreditCardIcon,
  tag: TagIcon,
  package: PackageIcon,
  mail: MailIcon,
  phone: PhoneIcon,
  "file-text": FileTextIcon,
  building: BuildingIcon,
  shield: ShieldIcon,
  star: StarIcon,
  "list-checks": ListChecksIcon,
};

function RowIcon({ name }: { name: HandoffIcon }) {
  const Icon = ICONS[name];
  return <Icon aria-hidden className="size-3.5 shrink-0" />;
}

const isRow = (r: Partial<HandoffContextRow>): r is HandoffContextRow =>
  typeof r.label === "string" && typeof r.value === "string";

const strings = (list?: (string | undefined)[]) =>
  (list ?? []).filter((s): s is string => typeof s === "string" && s !== "");

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Rows and sections arrive one after another as the call streams. */
const rowIn = (i: number) => ({
  initial: genuiStepIn.initial,
  animate: genuiStepIn.animate,
  transition: { ...genuiStepIn.transition, delay: Math.min(i, 6) * 0.06 },
});

export function Handoff({
  from,
  to,
  title,
  reason,
  context = [],
  done = [],
  left = [],
  note,
  confirmLabel,
  keepLabel,
  status: statusProp,
  onResult,
  result,
  className,
}: HandoffProps) {
  const [final, setFinal] = React.useState<HandoffResult | null>(
    result ?? null,
  );
  const [draft, setDraft] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const baseId = React.useId();
  const titleId = `${baseId}-title`;
  const noteId = `${baseId}-note`;
  const noteHintId = `${baseId}-note-hint`;
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const editButtonRef = React.useRef<HTMLButtonElement>(null);

  const decision = final
    ? final.action === "confirm"
      ? "confirmed"
      : "kept"
    : null;
  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: HandoffStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready");
  const streaming = status === "streaming";
  const finished = status === "confirmed" || status === "kept";
  const interactive = status === "ready";

  const name = typeof to?.name === "string" ? to.name : undefined;
  const isAgent = to?.kind === "agent";
  const sender = from ?? "the agent";
  const rows = context.filter(isRow);
  const doneItems = strings(done);
  const leftItems = strings(left);
  const currentNote = draft ?? note ?? "";
  const edited = draft !== null && draft.trim() !== (note ?? "").trim();
  const shownNote =
    final?.action === "confirm" ? (final.note ?? "") : currentNote;

  React.useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  const finish = (r: HandoffResult) => {
    setEditing(false);
    setFinal(r);
    // History results are restored, never re-sent.
    if (!result) onResult?.(r);
  };

  const confirm = () => {
    if (!interactive || !name) return;
    const text = currentNote.trim();
    finish({
      action: "confirm",
      ...(text ? { note: text } : {}),
      ...(edited ? { edited: true } : {}),
    });
  };

  const stopEditing = () => {
    setEditing(false);
    requestAnimationFrame(() => editButtonRef.current?.focus());
  };

  const primaryText =
    status === "submitting"
      ? "Handing off…"
      : (confirmLabel ??
        (name ? `Hand off to ${firstName(name)}` : "Hand off"));

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="handoff"
        data-status={status}
        aria-busy={streaming || status === "submitting"}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Handoff"}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
          {reason ? (
            <p className={cn(genuiType.meta, "text-muted-foreground")}>
              {reason}
            </p>
          ) : (
            streaming && <Skeleton className="h-3 w-full max-w-xs" />
          )}
        </SurfaceHeader>

        <ScrollFade viewportClassName="flex flex-col">
          {/* Who takes it: the focal element. */}
          {name ? (
            <motion.div
              {...genuiStepIn}
              className="flex items-center gap-3 border-t border-border px-3 py-3"
            >
              <span
                aria-hidden
                className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[13px] font-semibold"
              >
                {isAgent ? <BotIcon className="size-5" /> : initials(name)}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="sr-only">{`From ${sender} to `}</span>
                <span className={cn(genuiType.title, "truncate")}>{name}</span>
                {(to?.role || isAgent) && (
                  <span className={cn(genuiType.meta, "truncate")}>
                    {[to?.role, isAgent ? "Agent" : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
              </span>
            </motion.div>
          ) : (
            <div className="border-t border-border px-3 py-3">
              <Skeleton className="h-[68px] w-full rounded-[10px]" />
            </div>
          )}

          {/* The context the receiver inherits. */}
          {rows.length > 0 && (
            <dl className="flex flex-col divide-y divide-border border-t border-border px-3">
              {rows.map((r, i) => (
                <motion.div
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional; labels may repeat
                  key={`${r.label}-${i}`}
                  {...rowIn(i)}
                  className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-baseline gap-x-4 py-2.5"
                >
                  <dt
                    className={cn(genuiType.label, "flex items-center gap-1.5")}
                  >
                    {r.icon && ICONS[r.icon] && <RowIcon name={r.icon} />}
                    {r.label}
                  </dt>
                  <dd
                    className={cn(
                      genuiType.body,
                      "font-medium tabular-nums break-words",
                    )}
                  >
                    {r.value}
                  </dd>
                </motion.div>
              ))}
            </dl>
          )}

          {/* Done vs left. */}
          {(doneItems.length > 0 || leftItems.length > 0) && (
            <div className="grid gap-4 border-t border-border px-3 py-3 sm:grid-cols-2">
              {doneItems.length > 0 && (
                <section aria-labelledby={`${baseId}-done`}>
                  <h4
                    id={`${baseId}-done`}
                    className={cn(genuiType.label, "mb-1.5")}
                  >
                    Done
                  </h4>
                  <ul className="flex flex-col gap-1.5">
                    {doneItems.map((item, i) => (
                      <motion.li
                        // biome-ignore lint/suspicious/noArrayIndexKey: positional; items may repeat
                        key={`${item}-${i}`}
                        {...rowIn(i)}
                        className={cn(genuiType.body, "flex gap-2")}
                      >
                        <CheckIcon
                          aria-hidden
                          className="mt-[3px] size-3.5 shrink-0 text-muted-foreground"
                        />
                        <span className="min-w-0 break-words">{item}</span>
                      </motion.li>
                    ))}
                  </ul>
                </section>
              )}
              {leftItems.length > 0 && (
                <section aria-labelledby={`${baseId}-left`}>
                  <h4
                    id={`${baseId}-left`}
                    className={cn(genuiType.label, "mb-1.5")}
                  >
                    Left
                  </h4>
                  <ul className="flex flex-col gap-1.5">
                    {leftItems.map((item, i) => (
                      <motion.li
                        // biome-ignore lint/suspicious/noArrayIndexKey: positional; items may repeat
                        key={`${item}-${i}`}
                        {...rowIn(i)}
                        className={cn(genuiType.body, "flex gap-2")}
                      >
                        <CircleDashedIcon
                          aria-hidden
                          className="mt-[3px] size-3.5 shrink-0 text-muted-foreground"
                        />
                        <span className="min-w-0 break-words">{item}</span>
                      </motion.li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}

          {/* The note that goes with it. */}
          {status !== "kept" &&
            (note !== undefined ||
              draft !== null ||
              (!streaming && !finished)) && (
              <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span
                    id={`${noteId}-label`}
                    className={genuiType.label}
                  >
                    {name ? `Note to ${firstName(name)}` : "Note"}
                    {edited && !finished && (
                      <span className="ml-1.5">
                        · edited
                      </span>
                    )}
                  </span>
                  {!finished && !editing && (
                    <Button
                      ref={editButtonRef}
                      variant="ghost"
                      className="-mr-3 h-11 px-4"
                      disabled={!interactive}
                      onClick={() => setEditing(true)}
                      aria-describedby={`${noteId}-label`}
                    >
                      {currentNote ? "Edit" : "Add a note"}
                    </Button>
                  )}
                  {editing && (
                    <Button
                      variant="ghost"
                      className="-mr-3 h-11 px-4"
                      onClick={stopEditing}
                    >
                      Done
                    </Button>
                  )}
                </div>
                <AnimatePresence mode="wait" initial={false}>
                  {editing ? (
                    <motion.div
                      key="edit"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15, ease: genuiEase.easeOut }}
                      className="flex flex-col gap-1"
                    >
                      <Textarea
                        ref={textareaRef}
                        id={noteId}
                        aria-labelledby={`${noteId}-label`}
                        value={currentNote}
                        maxLength={NOTE_MAX}
                        aria-describedby={noteHintId}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            e.preventDefault();
                            stopEditing();
                          }
                        }}
                        className="min-h-28 rounded-[10px]"
                      />
                      <p
                        id={noteHintId}
                        className={cn(
                          genuiType.meta,
                          "text-right tabular-nums",
                        )}
                      >
                        {currentNote.length}/{NOTE_MAX}
                      </p>
                    </motion.div>
                  ) : shownNote ? (
                    <motion.p
                      key="note"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15, ease: genuiEase.easeOut }}
                      aria-labelledby={`${noteId}-label`}
                      className={cn(
                        genuiType.body,
                        "rounded-[10px] border border-border bg-transparent px-4 py-3 break-words whitespace-pre-line",
                      )}
                    >
                      {shownNote}
                    </motion.p>
                  ) : streaming ? (
                    <Skeleton
                      key="skeleton"
                      className="h-16 w-full rounded-[10px]"
                    />
                  ) : null}
                </AnimatePresence>
              </div>
            )}
        </ScrollFade>

        <SurfaceFooter aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            {finished && final ? (
              <motion.p
                key="record"
                {...genuiStepIn}
                className={cn(
                  final.action === "confirm" ? genuiType.body : genuiType.meta,
                  "flex items-center gap-2",
                )}
              >
                {final.action === "confirm" && (
                  <CheckMark className="size-4 shrink-0" />
                )}
                {final.action === "confirm"
                  ? `Handed to ${name ?? "the receiver"}.`
                  : `Kept with ${sender}.`}
              </motion.p>
            ) : (
              <motion.div
                key="actions"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2, ease: genuiEase.easeOut }}
                className="ml-auto flex flex-wrap justify-end gap-2"
              >
                <Button
                  variant="secondary"
                  className="h-11 px-3"
                  disabled={!interactive}
                  onClick={() => finish({ action: "keep" })}
                >
                  {keepLabel ?? "Keep it here"}
                </Button>
                <WhyDisabled
                  when={interactive && !name}
                  reason="Waiting for who it goes to"
                >
                  <Button
                    className="h-11 px-3"
                    disabled={!interactive || !name}
                    onClick={confirm}
                  >
                    <SwapText value={primaryText} />
                  </Button>
                </WhyDisabled>
              </motion.div>
            )}
          </AnimatePresence>
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  );
}
