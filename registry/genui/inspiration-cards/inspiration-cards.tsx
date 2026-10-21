"use client";

import * as React from "react";
import { CheckIcon } from "lucide-react";
import { MotionConfig, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { WhyDisabled } from "@/components/genui/hint";
import { Button } from "@/components/ui/button";
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering";
import {
  Skeleton,
  Surface,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface";
import { CheckMark } from "@/components/genui/genui-motion";

import type {
  InspirationCardsInput,
  InspirationCardsResult,
  InspirationItem,
} from "./inspiration-cards.schema";
import {
  chosenLabel,
  gridColumns,
  isSelectionFull,
  orderSelection,
  readyItems,
  safeHttpUrl,
  safeImageSrc,
  selectionSummary,
  toggleSelection,
} from "./inspiration-cards-utils";

export type InspirationCardsStatus = "streaming" | "ready" | "selected";

type PartialItem = Partial<Omit<InspirationItem, "image">> & {
  image?: Partial<InspirationItem["image"]>;
};

export type InspirationCardsProps = Partial<
  Omit<InspirationCardsInput, "items">
> & {
  /** Cards may be partial while the tool call streams. */
  items?: PartialItem[];
  /** Lifecycle, controlled by the host. */
  status?: InspirationCardsStatus;
  /** Called once with the pick (selectable), or on each link open. */
  onResult?: (result: InspirationCardsResult) => void;
  /** A pick from history. Restores it read-only; never calls onResult. */
  result?: InspirationCardsResult;
  className?: string;
};

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** The image, or a neutral tile with its alt text when it can't load. */
function CardImage({
  image,
  decorative,
}: {
  image: InspirationItem["image"];
  /** Inside a button or link the visible title names it; alt becomes a description. */
  decorative?: boolean;
}) {
  const src = safeImageSrc(image.src);
  const [failed, setFailed] = React.useState<string | null>(null);

  if (!src || failed === src) {
    return (
      <span className="flex size-full items-center justify-center p-3 text-center">
        <span
          aria-hidden={decorative}
          className="line-clamp-4 text-[13px] text-muted-foreground"
        >
          {image.alt}
        </span>
      </span>
    );
  }

  return (
    // biome-ignore lint/performance/noImgElement: agent-provided remote URLs; next/image would need every host configured
    <img
      src={src}
      alt={decorative ? "" : image.alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(src)}
      className="size-full object-cover transition-transform duration-300 ease-out select-none group-hover/card:scale-[1.02] group-disabled/card:scale-100 motion-reduce:transition-none"
    />
  );
}

function CardBody({
  item,
  selectable,
  selected,
  external,
  describedBy,
  cols,
}: {
  item: InspirationItem;
  cols: 2 | 3;
  selectable: boolean;
  selected: boolean;
  external?: boolean;
  /** Set on interactive cards, whose image alt becomes a description. */
  describedBy?: string;
}) {
  return (
    <>
      <span
        className={cn(
          "relative block overflow-hidden rounded-[10px] bg-muted transition-shadow",
          // Wide tiles keep a two-row grid inside the stage.
          cols === 3 ? "aspect-[4/3]" : "aspect-[8/5]",
          selected && "ring-2 ring-choice ring-offset-2 ring-offset-background",
        )}
      >
        <CardImage image={item.image} decorative={Boolean(describedBy)} />
        {selectable && (
          <span
            aria-hidden
            className={cn(
              "absolute top-2.5 right-2.5 flex size-7 items-center justify-center rounded-full shadow-sm dark:shadow-none transition-colors",
              selected
                ? "bg-choice text-background"
                : "bg-background/85 ring-1 ring-border",
            )}
          >
            {selected && <CheckMark className="size-3.5" />}
          </span>
        )}
      </span>
      <span className="mt-2 flex flex-col gap-0.5">
        <span className={genuiType.title}>{item.title}</span>
        {item.line && (
          <span className={cn(genuiType.body, "text-muted-foreground")}>
            {item.line}
          </span>
        )}
        {external && <span className="sr-only"> (opens in a new tab)</span>}
      </span>
    </>
  );
}

export function InspirationCards({
  title,
  items,
  columns,
  selectable = "none",
  max,
  submitLabel,
  status: statusProp,
  onResult,
  result,
  className,
}: InspirationCardsProps) {
  const [decision, setDecision] = React.useState<"selected" | null>(() =>
    result?.action === "select" ? "selected" : null,
  );
  const [picked, setPicked] = React.useState<string[]>(() =>
    result?.action === "select" ? result.ids : [],
  );

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: InspirationCardsStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready");
  const streaming = status === "streaming";
  const locked = status !== "ready";

  const ready = React.useMemo(
    () => readyItems(items, streaming),
    [items, streaming],
  );
  // While streaming, trust the requested columns so the grid doesn't jump.
  const cols = gridColumns(columns, streaming ? 3 : ready.length);
  const baseId = React.useId();
  const label = title ?? "Ideas";

  // ---- Selection
  const isSelectable = selectable !== "none";
  const selectedIds = orderSelection(picked, ready);
  const full = isSelectionFull(selectedIds, selectable, max);
  const toggle = (id: string) => {
    if (locked) return;
    setPicked((prev) =>
      toggleSelection(orderSelection(prev, ready), id, selectable, max),
    );
  };
  const submit = () => {
    if (locked || selectedIds.length === 0) return;
    setDecision("selected");
    onResult?.({ action: "select", ids: selectedIds });
  };

  const placeholders = streaming ? (ready.length === 0 ? cols : 1) : 0;

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        variant="flush"
        data-slot="inspiration-cards"
        data-status={status}
        aria-busy={streaming}
        aria-label={label}
        className={cn("flex flex-col gap-4", className)}
      >
        {title && (
          <h3
            className={cn(
              genuiType.title,
              "text-[16px] font-bold sm:text-[20px]",
            )}
          >
            {title}
          </h3>
        )}

        <div className="@container">
          <ul
            className={cn(
              "grid grid-cols-2 gap-x-4 gap-y-5",
              cols === 3 && "@lg:grid-cols-3",
            )}
          >
            {ready.map((item, index) => {
              const selected = selectedIds.includes(item.id);
              const href = isSelectable ? null : safeHttpUrl(item.url);
              // Index, not id: ids from data may contain spaces.
              const describedBy = `${baseId}-d${index}`;
              return (
                <motion.li
                  key={item.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={genuiMotion.fade}
                  className="min-w-0"
                >
                  {isSelectable ? (
                    <button
                      type="button"
                      aria-pressed={selected}
                      aria-describedby={describedBy}
                      disabled={locked || (!selected && full)}
                      onClick={() => toggle(item.id)}
                      className={cn(
                        "group/card flex w-full flex-col rounded-[10px] text-left disabled:cursor-default",
                        // After the pick, the chosen cards stay forward.
                        status === "selected" && !selected && "opacity-50",
                        focusRing,
                      )}
                    >
                      <CardBody
                        item={item}
                        selectable
                        selected={selected}
                        cols={cols}
                        describedBy={describedBy}
                      />
                    </button>
                  ) : href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      aria-describedby={describedBy}
                      onClick={() =>
                        onResult?.({ action: "open", id: item.id })
                      }
                      className={cn(
                        "group/card flex flex-col rounded-[10px]",
                        focusRing,
                      )}
                    >
                      <CardBody
                        item={item}
                        selectable={false}
                        selected={false}
                        cols={cols}
                        external
                        describedBy={describedBy}
                      />
                    </a>
                  ) : (
                    <div className="flex flex-col">
                      <CardBody
                        item={item}
                        cols={cols}
                        selectable={false}
                        selected={false}
                      />
                    </div>
                  )}
                  {(isSelectable || href) && (
                    // Outside the control, so it describes rather than names it.
                    <span id={describedBy} className="sr-only">
                      {item.image.alt}
                    </span>
                  )}
                </motion.li>
              );
            })}
            {Array.from({ length: placeholders }, (_, i) => `ph-${i}`).map(
              (key) => (
                <li key={key} aria-hidden className="flex flex-col">
                  <Skeleton
                    className={cn(
                      "rounded-[10px]",
                      cols === 3 ? "aspect-[4/3]" : "aspect-[8/5]",
                    )}
                  />
                  <Skeleton className="mt-2 h-4 w-2/3" />
                  <Skeleton className="mt-1.5 h-3.5 w-11/12" />
                </li>
              ),
            )}
          </ul>
        </div>

        {isSelectable && (
          <footer
            aria-live="polite"
            className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            {status === "selected" ? (
              <p className={cn(genuiType.body, "flex items-center gap-1.5")}>
                <CheckIcon aria-hidden className="size-4 shrink-0" />
                Chose {chosenLabel(selectedIds, ready)}
              </p>
            ) : (
              <>
                <p
                  className={cn(
                    genuiType.meta,
                    "tabular-nums",
                    // The instruction is for screen readers; the count is real state.
                    !streaming && selectedIds.length === 0 && "sr-only",
                  )}
                >
                  {streaming ? (
                    <ShimmeringText
                      text="Loading ideas…"
                      color="var(--muted-foreground)"
                      shimmeringColor="var(--foreground)"
                    />
                  ) : (
                    selectionSummary(selectedIds.length, selectable, max)
                  )}
                </p>
                <WhyDisabled reason={!locked && selectedIds.length === 0 && "Select at least one"} className="flex w-full sm:ml-auto sm:w-auto">
                  <Button
                    size="sm"
                    onClick={submit}
                    disabled={locked || selectedIds.length === 0}
                    className="w-full sm:ml-auto sm:w-auto"
                  >
                    {submitLabel ??
                      (selectable === "single" ? "Use this" : "Use these")}
                  </Button>
                </WhyDisabled>
              </>
            )}
          </footer>
        )}
      </Surface>
    </MotionConfig>
  );
}
