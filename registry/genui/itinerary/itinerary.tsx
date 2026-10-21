"use client";

import * as React from "react";
import {
  AnchorIcon,
  ArrowUpRightIcon,
  BedDoubleIcon,
  BinocularsIcon,
  Building2Icon,
  CompassIcon,
  DropletsIcon,
  LandmarkIcon,
  type LucideIcon,
  MapPinIcon,
  MinusIcon,
  MountainIcon,
  SailboatIcon,
  TreesIcon,
  Undo2Icon,
  UtensilsIcon,
  WavesIcon,
} from "lucide-react";
import { MotionConfig, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { WhyDisabled } from "@/components/genui/hint";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number";
import {
  genuiType,
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiMotion,
} from "@/components/genui/surface";

import {
  type ItineraryInput,
  type ItineraryResult,
  type ItineraryStop,
  type ItineraryStopKind,
  readyStops,
  removedCountText,
  safeHttpUrl,
  safeImageSrc,
  stopMetaLine,
  toggleRemoved,
} from "./itinerary.schema";

export type ItineraryStatus = "streaming" | "ready";

export type ItineraryProps = Partial<Omit<ItineraryInput, "stops">> & {
  /** Stops may be partial while the tool call streams. */
  stops?: Partial<ItineraryStop>[];
  /** Lifecycle, controlled by the host. */
  status?: ItineraryStatus;
  /**
   * Called with `change` on every remove or add-back (when editable), and with
   * `open` when the user opens a stop's link.
   */
  onResult?: (result: ItineraryResult) => void;
  /** The last result from history. Restores `removed`; never calls onResult. */
  result?: ItineraryResult;
  /**
   * Removed stop ids, controlled by the host (e.g. to sync with a map). When
   * set, it wins over the list's own state; update it from `change` results.
   */
  removed?: string[];
  className?: string;
};

/** Same icons as the map's stop markers. */
const KIND_ICONS: Record<ItineraryStopKind, LucideIcon> = {
  beach: WavesIcon,
  mountain: MountainIcon,
  city: Building2Icon,
  forest: TreesIcon,
  lake: SailboatIcon,
  waterfall: DropletsIcon,
  harbor: AnchorIcon,
  museum: LandmarkIcon,
  food: UtensilsIcon,
  hotel: BedDoubleIcon,
  viewpoint: BinocularsIcon,
  activity: CompassIcon,
};

const kindIcon = (kind: ItineraryStop["kind"]) =>
  (kind && KIND_ICONS[kind]) || MapPinIcon;

function StopThumb({
  stop,
  removed,
}: {
  stop: ItineraryStop;
  removed: boolean;
}) {
  const src = safeImageSrc(stop.image?.src);
  const [failed, setFailed] = React.useState<string | null>(null);
  const Icon = kindIcon(stop.kind);
  return (
    <span
      className={cn(
        "relative flex size-15 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-transparent transition-[filter] duration-200",
        removed && "grayscale",
      )}
    >
      {src && failed !== src ? (
        // biome-ignore lint/performance/noImgElement: agent-provided remote URLs; next/image would need every host configured
        <img
          src={src}
          alt={stop.image?.alt ?? ""}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailed(src)}
          className="size-full object-cover select-none"
        />
      ) : (
        <Icon aria-hidden className="size-6 text-muted-foreground" />
      )}
    </span>
  );
}

export function Itinerary({
  title,
  stops = [],
  editable = false,
  status: statusProp,
  onResult,
  result,
  removed: removedProp,
  className,
}: ItineraryProps) {
  const [ownRemoved, setOwnRemoved] = React.useState<string[]>(() =>
    result?.action === "change" ? result.removed : [],
  );
  const [announcement, setAnnouncement] = React.useState("");

  const status: ItineraryStatus = statusProp ?? "ready";
  const streaming = status === "streaming";

  const ready = readyStops(stops);
  const order = ready.map((s) => s.id);
  const removed = removedProp ?? ownRemoved;
  const removedSet = new Set(removed);
  const removedCount = ready.filter((s) => removedSet.has(s.id)).length;

  const commit = (next: string[], message: string) => {
    if (removedProp === undefined) setOwnRemoved(next);
    setAnnouncement(message);
    // History results are restored, never re-sent.
    if (!result) onResult?.({ action: "change", removed: next });
  };

  const toggle = (stop: ItineraryStop) => {
    const next = toggleRemoved(removed, stop.id, order);
    const nowRemoved = next.includes(stop.id);
    const count = ready.filter((s) => next.includes(s.id)).length;
    commit(
      next,
      nowRemoved
        ? `${stop.name} removed. ${removedCountText(count)}.`
        : `${stop.name} added back.`,
    );
  };

  const reset = () => {
    const known = new Set(order);
    commit(
      removed.filter((id) => !known.has(id)),
      "All stops are back on the route.",
    );
  };

  const open = (stop: ItineraryStop) => {
    if (!result) onResult?.({ action: "open", stopId: stop.id });
  };

  const renderStop = (stop: ItineraryStop, index: number) => {
    const isRemoved = removedSet.has(stop.id);
    const last = index === ready.length - 1 && !streaming;
    const href = safeHttpUrl(stop.url);
    const meta = stopMetaLine(stop);
    const name = href ? (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        onClick={() => open(stop)}
        className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {stop.name}
        <ArrowUpRightIcon
          aria-hidden
          className="ml-0.5 inline size-3.5 align-[-0.1em] text-muted-foreground"
        />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    ) : (
      stop.name
    );

    return (
      <motion.li
        key={stop.id}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={genuiMotion.fade}
        className="relative flex items-start gap-4 py-3"
      >
        {/* Connector between thumbnails: decorative, the list order carries it. */}
        {!last && (
          <span
            aria-hidden
            className="absolute top-20 -bottom-3 left-[29px] w-0.5 rounded-full bg-border"
          />
        )}
        <div
          className={cn(
            "flex min-w-0 flex-1 items-start gap-4 transition-opacity duration-200",
            isRemoved && "opacity-50",
          )}
        >
          <StopThumb stop={stop} removed={isRemoved} />
          <div className="flex min-h-15 min-w-0 flex-1 flex-col justify-center gap-0.5">
            {stop.time && (
              <span className={cn("font-medium tabular-nums", genuiType.meta)}>
                {stop.time}
              </span>
            )}
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={cn(
                  "text-[14px] font-semibold tracking-tight",
                  isRemoved && "line-through decoration-foreground/60",
                )}
              >
                {name}
              </span>
              {stop.added && (
                <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-border bg-transparent px-2.5 text-[13px] font-medium">
                  Added
                </span>
              )}
              {isRemoved && <span className="sr-only">(removed)</span>}
            </div>
            {meta && (
              <span className="text-[13px] text-muted-foreground">{meta}</span>
            )}
          </div>
        </div>
        {editable && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="mt-3 dark:hover:bg-white/10"
                  disabled={streaming}
                  aria-label={
                    isRemoved
                      ? `Add ${stop.name} back`
                      : `Remove ${stop.name} from the route`
                  }
                  onClick={() => toggle(stop)}
                />
              }
            >
              {isRemoved ? (
                <Undo2Icon aria-hidden className="size-4" />
              ) : (
                <MinusIcon aria-hidden className="size-4" />
              )}
            </TooltipTrigger>
            <TooltipContent>
              {isRemoved
                ? `Add ${stop.name} back`
                : `Remove ${stop.name} from the route`}
            </TooltipContent>
          </Tooltip>
        )}
      </motion.li>
    );
  };

  const skeletonRow = (key: string) => (
    <li key={key} aria-hidden className="flex items-center gap-4 py-3">
      <Skeleton className="size-15 rounded-lg" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </li>
  );

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="itinerary"
        data-status={status}
        aria-busy={streaming}
        aria-label={title ?? "Itinerary"}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle>{title}</SurfaceTitle>
        </SurfaceHeader>

        <ol className="flex flex-col border-t border-border px-3 py-2">
          {ready.map(renderStop)}
          {streaming &&
            (ready.length === 0
              ? ["a", "b", "c"].map((k) => skeletonRow(k))
              : skeletonRow("next"))}
        </ol>

        <span className="sr-only" aria-live="polite">
          {announcement}
        </span>

        {editable && removedCount > 0 && (
          <SurfaceFooter className="justify-between">
            <span className={cn("tabular-nums", genuiType.body)}>
              <span className="sr-only">{removedCountText(removedCount)}</span>
              <span aria-hidden className="inline-flex items-baseline">
                <SlidingNumber number={removedCount} initiallyStable />
                &nbsp;removed
              </span>
            </span>
            <WhyDisabled when={streaming} reason="Still loading…">
              <Button size="sm" disabled={streaming} onClick={reset}>
                Reset
              </Button>
            </WhyDisabled>
          </SurfaceFooter>
        )}
      </Surface>
    </MotionConfig>
  );
}
