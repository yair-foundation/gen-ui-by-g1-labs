"use client";

import * as React from "react";
import { CheckIcon, HeartIcon } from "lucide-react";
import { MotionConfig, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { WhyDisabled } from "@/components/genui/hint";
import { Button } from "@/components/ui/button";
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering";
import {
  Skeleton,
  Surface,
  genuiHit,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface";

import type {
  StyleBoardInput,
  StyleBoardResult,
  StylePin,
} from "./style-board.schema";
import {
  type PartialPin,
  boardColumns,
  categoriesOf,
  distribute,
  filterPins,
  orderSaved,
  pinAspect,
  readyPins,
  safeHttpUrl,
  safeImageSrc,
  savedLabel,
  savedSummary,
  toggleSaved,
} from "./style-board-utils";

export type StyleBoardStatus = "streaming" | "ready" | "saved";

export type StyleBoardProps = Partial<Omit<StyleBoardInput, "pins">> & {
  /** Pins may be partial while the tool call streams. */
  pins?: PartialPin[];
  /** Lifecycle, controlled by the host. */
  status?: StyleBoardStatus;
  /** Called once with the saved looks, or on each link open. */
  onResult?: (result: StyleBoardResult) => void;
  /** Saved looks from history. Restores them read-only; never calls onResult. */
  result?: StyleBoardResult;
  className?: string;
};

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Watches a container's width, so the column count can follow it. Null until mounted. */
function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = React.useState<number | null>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.getBoundingClientRect().width);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** The image at its aspect, or a neutral tile with its alt text when it can't load. */
function PinImage({ pin }: { pin: StylePin }) {
  const src = safeImageSrc(pin.image.src);
  const [failed, setFailed] = React.useState<string | null>(null);

  if (!src || failed === src) {
    return (
      <span className="flex size-full items-center justify-center p-3 text-center">
        <span className="line-clamp-5 text-[13px] text-muted-foreground">
          {pin.image.alt}
        </span>
      </span>
    );
  }
  return (
    // biome-ignore lint/performance/noImgElement: agent-provided remote URLs; next/image would need every host configured
    <img
      src={src}
      alt={pin.image.alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(src)}
      className="size-full object-cover transition-transform duration-300 ease-out select-none group-hover/pin:scale-[1.03] motion-reduce:transition-none"
    />
  );
}

function Pin({
  pin,
  saveable,
  saved,
  locked,
  onToggle,
  onOpen,
}: {
  pin: StylePin;
  saveable: boolean;
  saved: boolean;
  locked: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const href = safeHttpUrl(pin.url);
  const frame = (
    <span
      className={cn(
        "relative block overflow-hidden rounded-[10px] bg-muted transition-shadow",
        saved && "ring-2 ring-choice ring-offset-2 ring-offset-background",
      )}
      style={{ aspectRatio: pinAspect(pin.image.aspect) }}
    >
      <PinImage pin={pin} />
    </span>
  );

  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={genuiMotion.fade}
      className="group/pin relative min-w-0"
    >
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          onClick={onOpen}
          className={cn("block rounded-[10px]", focusRing)}
        >
          {frame}
          <span className="sr-only">{`Open ${pin.title} (opens in a new tab)`}</span>
        </a>
      ) : (
        frame
      )}

      {saveable && (
        <button
          type="button"
          aria-pressed={saved}
          aria-label={`Save ${pin.title}`}
          disabled={locked}
          onClick={onToggle}
          className={cn(
            "absolute top-2 right-2 flex size-8 items-center justify-center rounded-full shadow-sm transition-colors dark:shadow-none",
            genuiHit,
            saved
              ? "bg-choice text-background"
              : "bg-background/85 text-foreground ring-1 ring-border hover:bg-background",
            "disabled:cursor-default",
            focusRing,
          )}
        >
          <motion.span
            key={saved ? "on" : "off"}
            initial={saved ? { scale: 0.6 } : false}
            animate={{ scale: 1 }}
            transition={genuiMotion.snappy}
            className="flex"
          >
            <HeartIcon
              aria-hidden
              className={cn("size-4", saved && "fill-current")}
            />
          </motion.span>
        </button>
      )}

      <span className="mt-2 flex flex-col gap-0.5">
        <span className={genuiType.title}>{pin.title}</span>
        {pin.price && (
          <span className={cn(genuiType.body, "text-muted-foreground tabular-nums")}>
            {pin.price}
          </span>
        )}
      </span>
    </motion.li>
  );
}

function PinSkeleton({ aspect }: { aspect: number }) {
  return (
    <li aria-hidden className="flex flex-col">
      <Skeleton className="rounded-[10px]" style={{ aspectRatio: aspect }} />
      <Skeleton className="mt-2 h-4 w-2/3" />
    </li>
  );
}

/** Heights for the placeholders while the first pins arrive. */
const SKELETON_ASPECTS = [0.7, 1, 0.8, 0.6, 0.9, 0.75];

export function StyleBoard({
  title,
  pins,
  columns,
  saveable = true,
  submitLabel,
  status: statusProp,
  onResult,
  result,
  className,
}: StyleBoardProps) {
  const [decision, setDecision] = React.useState<"saved" | null>(() =>
    result?.action === "save" ? "saved" : null,
  );
  const [saved, setSaved] = React.useState<string[]>(() =>
    result?.action === "save" ? result.ids : [],
  );
  const [category, setCategory] = React.useState<string | null>(null);
  const boardRef = React.useRef<HTMLDivElement>(null);
  const width = useWidth(boardRef);

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: StyleBoardStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready");
  const streaming = status === "streaming";
  const locked = status !== "ready";

  const ready = React.useMemo(() => readyPins(pins), [pins]);
  const categories = categoriesOf(ready);
  const activeCategory =
    category && categories.includes(category) ? category : null;
  const visible = filterPins(ready, activeCategory);
  const cols = boardColumns(columns, width);
  const columnsOfPins = distribute(visible, cols);
  const savedIds = orderSaved(saved, ready);
  const label = title ?? "Style board";

  const toggle = (id: string) => {
    if (locked) return;
    setSaved((prev) => toggleSaved(orderSaved(prev, ready), id));
  };
  const submit = () => {
    if (locked || savedIds.length === 0) return;
    setDecision("saved");
    onResult?.({ action: "save", ids: savedIds });
  };

  const placeholders = streaming ? (ready.length === 0 ? cols * 2 : 1) : 0;

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        variant="flush"
        data-slot="style-board"
        data-status={status}
        aria-busy={streaming}
        aria-label={label}
        className={cn("flex flex-col gap-4", className)}
      >
        {(title || categories.length > 0) && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
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
            {categories.length > 0 && (
              <fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0 sm:ml-auto sm:justify-end">
                <legend className="sr-only">Show</legend>
                {["All", ...categories].map((c) => {
                  const on = (activeCategory ?? "All") === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setCategory(c === "All" ? null : c)}
                      className={cn(
                        "relative inline-flex h-8 items-center rounded-full border px-3.5 text-[13px] font-medium transition-colors",
                        genuiHit,
                        on
                          ? "border-border bg-accent text-foreground ring-2 ring-choice"
                          : "border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground dark:hover:bg-white/5",
                        focusRing,
                      )}
                    >
                      {c}
                    </button>
                  );
                })}
              </fieldset>
            )}
          </div>
        )}

        <div ref={boardRef} className="@container">
          <div className="flex items-start gap-3">
            {columnsOfPins.map((col, i) => (
              <ul
                // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                key={i}
                aria-label={`Column ${i + 1} of ${columnsOfPins.length}`}
                className="flex min-w-0 flex-1 flex-col gap-4"
              >
                {col.map((pin) => (
                  <Pin
                    key={pin.id}
                    pin={pin}
                    saveable={saveable}
                    saved={savedIds.includes(pin.id)}
                    locked={locked}
                    onToggle={() => toggle(pin.id)}
                    onOpen={() => onResult?.({ action: "open", id: pin.id })}
                  />
                ))}
                {i === 0 &&
                  Array.from({ length: placeholders }, (_, k) => k).map((k) => (
                    <PinSkeleton
                      key={`ph-${k}`}
                      aspect={SKELETON_ASPECTS[k % SKELETON_ASPECTS.length]}
                    />
                  ))}
              </ul>
            ))}
          </div>
        </div>

        {saveable && (
          <footer
            aria-live="polite"
            className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            {status === "saved" ? (
              <p className={cn(genuiType.body, "flex items-center gap-1.5")}>
                <CheckIcon aria-hidden className="size-4 shrink-0" />
                Saved {savedLabel(savedIds, ready)}
              </p>
            ) : (
              <>
                <p
                  className={cn(
                    genuiType.meta,
                    "tabular-nums",
                    // The instruction is for screen readers; the count is real state.
                    !streaming && savedIds.length === 0 && "sr-only",
                  )}
                >
                  {streaming ? (
                    <ShimmeringText
                      text="Loading looks…"
                      color="var(--muted-foreground)"
                      shimmeringColor="var(--foreground)"
                    />
                  ) : (
                    savedSummary(savedIds.length)
                  )}
                </p>
                <WhyDisabled
                  reason={!locked && savedIds.length === 0 && "Save at least one look"}
                  className="flex w-full sm:ml-auto sm:w-auto"
                >
                  <Button
                    size="sm"
                    onClick={submit}
                    disabled={locked || savedIds.length === 0}
                    className="w-full sm:ml-auto sm:w-auto"
                  >
                    {submitLabel ?? "Save to board"}
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
