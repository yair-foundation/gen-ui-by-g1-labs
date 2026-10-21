"use client";

import * as React from "react";
import { Menu } from "@base-ui/react/menu";
import {
  CheckIcon,
  ArmchairIcon,
  ClockIcon,
  CopyIcon,
  DoorOpenIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  PlaneIcon,
  type LucideIcon,
  QrCodeIcon,
  ScanBarcodeIcon,
  TicketIcon,
  UsersIcon,
} from "lucide-react";
import { MotionConfig, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WhyDisabled } from "@/components/genui/hint";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface";

import {
  boardingText,
  checkInState,
  checkInText,
  dayOffset,
  departsText,
  formatClock,
  formatDate,
  formatDuration,
  journeyMinutes,
  layovers,
  resolveActions,
  resolveNow,
  safeUrl,
  segmentMinutes,
  segmentTimes,
  toInstant,
  zoneLabel,
  type CheckInState,
  type FlightTicketAction,
  type Layover,
} from "./flight-ticket-utils";
import type {
  FlightTicketInput,
  FlightTicketResult,
  TicketAirport,
  TicketPassenger,
  TicketSegment,
} from "./flight-ticket.schema";
import { RollingDigits } from "@/components/genui/genui-motion";
import { useGenUILocale } from "@/components/genui/locale";

export type FlightTicketStatus = "streaming" | "ready" | "submitting" | "done";

type PartialSegment = Partial<Omit<TicketSegment, "from" | "to">> & {
  from?: Partial<TicketAirport>;
  to?: Partial<Omit<TicketAirport, "gate">>;
};

export type FlightTicketProps = Partial<
  Omit<
    FlightTicketInput,
    "airline" | "passengers" | "segments" | "barcode" | "source"
  >
> & {
  /** Everything may be partial while the tool call streams. */
  airline?: {
    name?: string;
    code?: string;
    logo?: string;
    logoDark?: string;
  };
  passengers?: Partial<TicketPassenger>[];
  segments?: PartialSegment[];
  barcode?: { format?: "qr" | "pdf417" | "aztec"; label?: string };
  source?: { label?: string; url?: string };
  /**
   * The moment relative times are measured from ("Check-in opens in 3 h").
   * Defaults to the viewer's clock, read after mount.
   */
  now?: Date | string | number;
  /**
   * Lifecycle, controlled by the host. 'submitting' while the host handles an
   * action. When omitted, the component tracks the user's actions itself.
   */
  status?: FlightTicketStatus;
  /**
   * Called once per action. Each action locks after use; the others stay
   * available. Every action is a handoff to your own flow.
   */
  onResult?: (result: FlightTicketResult) => void;
  /** Actions from history (one or several). Shown as done; never calls onResult. */
  result?: FlightTicketResult | FlightTicketResult[];
  className?: string;
};

type Leg = {
  segment: TicketSegment;
  depart: number;
  arrive: number;
  minutes: number | null;
};

const CLASS_LABEL: Record<NonNullable<TicketPassenger["class"]>, string> = {
  economy: "Economy",
  premium: "Premium economy",
  business: "Business",
  first: "First",
};

const CONFIRMATION: Record<FlightTicketAction, string> = {
  "check-in": "Opening check-in…",
  "add-to-wallet": "Opening your wallet pass…",
  "choose-seat": "Opening the seat map…",
  manage: "Opening your booking…",
  share: "Opening share options…",
};

/** Hatching for layover segments: the one repeating gradient allowed. */
const HATCH =
  "repeating-linear-gradient(135deg, var(--border) 0 1px, transparent 1px 6px)";

/** A logo may be http(s), a same-origin path, or an image data URL; anything else is not loaded. */
const safeLogoSrc = (src?: string) =>
  src &&
  (/^https?:\/\//i.test(src) ||
    /^\/(?!\/)/.test(src) ||
    /^data:image\//i.test(src))
    ? src
    : undefined;

/**
 * Colours of the ticket. Every ticket is drawn on blue in both themes; the
 * theme variables are redefined for everything inside it.
 */
const PASS_THEME =
  "bg-[oklch(0.42_0.1_268)] text-white [--border:oklch(1_0_0/0.22)] [--foreground:#fff] [--muted-foreground:oklch(1_0_0/0.72)] [--muted:oklch(1_0_0/0.12)]";

/** The warning badge, lifted so it reads on the blue ticket in both themes. */
const ON_BLUE_WARNING =
  "bg-orange-300/20 text-orange-200 dark:bg-orange-300/20 dark:text-orange-200";

/** The airline's light wordmark on the blue pass; dropped if it fails to load. */
function AirlineWordmark({ src, onFail }: { src: string; onFail: () => void }) {
  return (
    // biome-ignore lint/performance/noImgElement: agent-provided remote URLs; next/image would need every host configured
    <img
      src={src}
      alt=""
      aria-hidden
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={onFail}
      className="h-auto max-h-5 w-auto max-w-40"
    />
  );
}

function isReadySegment(s: PartialSegment): s is TicketSegment {
  return (
    typeof s.flightNumber === "string" &&
    typeof s.departAt === "string" &&
    typeof s.arriveAt === "string" &&
    typeof s.from?.code === "string" &&
    typeof s.from.city === "string" &&
    typeof s.from.timeZone === "string" &&
    typeof s.to?.code === "string" &&
    typeof s.to.city === "string" &&
    typeof s.to.timeZone === "string"
  );
}

/**
 * The current time: the host's `now`, or the viewer's clock read after mount
 * (so server and client render the same markup) and refreshed every minute.
 */
function useNow(fixed: number | null) {
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (fixed !== null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [fixed]);
  return fixed ?? now;
}

/**
 * Milliseconds left until `target`, ticking every second; null before mount or
 * with no target. With a fixed `now` (demos, tests) it counts down from that
 * moment instead of the viewer's clock.
 */
function useCountdown(target: number | null, fixed: number | null) {
  const [left, setLeft] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (target === null) {
      setLeft(null);
      return;
    }
    const anchor = Date.now();
    const read = () =>
      target - (fixed === null ? Date.now() : fixed + (Date.now() - anchor));
    setLeft(read());
    const id = window.setInterval(() => setLeft(read()), 1000);
    return () => window.clearInterval(id);
  }, [target, fixed]);
  return left;
}

/** '13d 02:14:09', or '02:14:09' under a day. */
function clockText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const pad = (n: number) => String(n).padStart(2, "0");
  const hms = `${pad(Math.floor((total % 86_400) / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  return days > 0 ? `${days}d ${hms}` : hms;
}

function useCopied() {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return [copied, copy] as const;
}

/** A time at an airport: visible '07:40', spoken with the date and zone. */
function LocalTime({
  t,
  airport,
  verb,
  className,
}: {
  t: number;
  airport: { city: string; timeZone: string };
  verb?: string;
  className?: string;
}) {
  const locale = useGenUILocale();
  return (
    <time
      dateTime={new Date(t).toISOString()}
      className={cn("tabular-nums", className)}
    >
      <span aria-hidden>{formatClock(t, airport.timeZone)}</span>
      <span className="sr-only" suppressHydrationWarning>
        {`${verb ? `${verb} ` : ""}${formatDate(t, airport.timeZone, "long", locale)}, ${formatClock(t, airport.timeZone)} ${zoneLabel(airport.city, t, airport.timeZone)}`}
      </span>
    </time>
  );
}

function DayMark({ offset }: { offset: number }) {
  if (offset === 0) return null;
  return (
    <sup aria-hidden className="ml-0.5 text-xs font-medium">
      {offset > 0 ? `+${offset}` : offset}
    </sup>
  );
}

type BarPart =
  | { kind: "leg"; key: string; minutes: number }
  | { kind: "layover"; key: string; minutes: number; code: string };

/**
 * The journey as one bar: a pill per flight (dot at the origin, ring at the
 * destination) and a hatched segment per layover with the connection airport.
 * Widths follow the minutes. Decorative: the itinerary text carries the facts.
 */
function RouteBar({ parts }: { parts: BarPart[] }) {
  return (
    <div aria-hidden className="flex h-5 items-center gap-1">
      {parts.map((p) =>
        p.kind === "leg" ? (
          <div
            key={p.key}
            className="relative flex h-5 min-w-6 items-center"
            style={{ flexGrow: Math.max(p.minutes, 1), flexBasis: 0 }}
          >
            <div className="h-1.5 w-full rounded-full bg-muted dark:bg-border" />
            <span className="absolute top-1/2 left-0 size-2.5 -translate-y-1/2 rounded-full bg-foreground" />
            <span className="absolute top-1/2 right-0 size-2.5 -translate-y-1/2 rounded-full border-2 border-foreground bg-card" />
          </div>
        ) : (
          <div
            key={p.key}
            className="flex h-5 min-w-10 items-center justify-center rounded-full border"
            style={{
              flexGrow: Math.max(p.minutes, 1),
              flexBasis: 0,
              backgroundImage: HATCH,
            }}
          >
            <span className="rounded-sm bg-card px-0.5 text-[13px] leading-none font-medium">
              {p.code}
            </span>
          </div>
        ),
      )}
    </div>
  );
}

function Fact({
  label,
  icon: Icon,
  context,
  children,
  large,
}: {
  label: string;
  icon?: LucideIcon;
  /** Spoken after the label, e.g. ' Lisbon time (GMT+1)'. */
  context?: string;
  children: React.ReactNode;
  large?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className={cn(genuiType.label, Icon && "flex items-center gap-1.5")}>
        {Icon && <Icon aria-hidden className="size-3.5 shrink-0" />}
        {label}
        {context && <span className="sr-only">{context}</span>}
      </dt>
      <dd
        className={cn(
          "font-medium tracking-tight break-words tabular-nums",
          large ? "text-[24px] leading-none" : "text-[16px] leading-tight",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

/** The branch line that joins the itinerary's dots; the rows are stacked with no gap. */
const BRANCH = "absolute left-[4px] w-0.5 bg-foreground/30";

function LayoverRow({ layover }: { layover: Layover }) {
  return (
    <li className="relative flex flex-wrap items-center gap-x-3 gap-y-1 py-1 pl-6">
      <span aria-hidden className={cn(BRANCH, "inset-y-0")} />
      <span
        aria-hidden
        className="absolute top-1/2 left-[1px] size-2 -translate-y-1/2 rounded-full bg-foreground/50"
      />
      <span className={genuiType.meta}>
        {`${formatDuration(layover.minutes)} in ${layover.at.code}`}
        <span className="sr-only">{` (${layover.at.city}), connection`}</span>
      </span>
      {layover.short && (
        <Badge variant="warning" className={ON_BLUE_WARNING}>
          Short connection
        </Badge>
      )}
      {layover.changeTo && (
        <Badge variant="warning" className={ON_BLUE_WARNING}>
          {`Change airports to ${layover.changeTo.code}`}
        </Badge>
      )}
    </li>
  );
}

function LegRow({
  leg,
  hasPrev,
  hasNext,
}: {
  leg: Leg;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  const { segment: s, depart, arrive, minutes } = leg;
  const offset = dayOffset(depart, s.from.timeZone, arrive, s.to.timeZone);
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={genuiMotion.fade}
      className="relative flex flex-col py-1 pl-6"
    >
      {hasPrev && <span aria-hidden className={cn(BRANCH, "top-0 h-[14px]")} />}
      {hasNext && (
        <span aria-hidden className={cn(BRANCH, "top-[14px] bottom-0")} />
      )}
      <span
        aria-hidden
        className="absolute top-[9px] left-0 size-2.5 rounded-full bg-foreground"
      />
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn(genuiType.body, "flex flex-wrap gap-x-3")}>
          <span className="font-medium">{s.flightNumber}</span>
          <span>
            <LocalTime
              t={depart}
              airport={s.from}
              verb={`Departs ${s.from.city} (${s.from.code})`}
            />{" "}
            <span aria-hidden>{s.from.code} – </span>
            <LocalTime
              t={arrive}
              airport={s.to}
              verb={`Arrives ${s.to.city} (${s.to.code})`}
            />
            <DayMark offset={offset} /> <span aria-hidden>{s.to.code}</span>
          </span>
        </span>
        {minutes !== null && (
          <span className={cn(genuiType.meta, "shrink-0 tabular-nums")}>
            {formatDuration(minutes)}
          </span>
        )}
      </div>
      {s.operatedBy && (
        <span className={genuiType.meta}>{`Operated by ${s.operatedBy}`}</span>
      )}
    </motion.li>
  );
}

/** One end of the route: city, big airport code, then the local time and terminal. */
function Endpoint({
  code,
  city,
  terminal,
  time,
  align,
}: {
  code?: string;
  city?: string;
  terminal?: string;
  time?: React.ReactNode;
  align: "start" | "end";
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1",
        align === "end" && "items-end text-right",
      )}
    >
      {city ? (
        <span aria-hidden className={cn(genuiType.label, "truncate")}>
          {city}
        </span>
      ) : (
        <Skeleton className="h-4 w-16" />
      )}
      {code ? (
        <span aria-hidden className={genuiType.display}>
          {code}
        </span>
      ) : (
        <Skeleton className="h-9 w-20" />
      )}
      <div
        className={cn(
          "flex flex-wrap items-baseline gap-x-2",
          align === "end" && "justify-end",
        )}
      >
        {time ?? <Skeleton className="h-5 w-12" />}
        {terminal && (
          <span className={genuiType.meta}>{`Terminal ${terminal}`}</span>
        )}
      </div>
    </div>
  );
}

export function FlightTicket({
  bookingRef,
  airline,
  passengers = [],
  segments = [],
  passType,
  checkInOpensAt,
  checkedIn,
  barcode,
  source,
  actions,
  now: nowProp,
  status: statusProp,
  onResult,
  result,
  className,
}: FlightTicketProps) {
  const locale = useGenUILocale();
  const [done, setDone] = React.useState<FlightTicketAction[]>(() =>
    (result === undefined ? [] : Array.isArray(result) ? result : [result]).map(
      (r) => r.action,
    ),
  );
  const [copied, copy] = useCopied();
  const [logoFailed, setLogoFailed] = React.useState(false);

  // A host-provided "ready" (or nothing) yields to the user's actions.
  const status: FlightTicketStatus =
    done.length > 0 && (statusProp === undefined || statusProp === "ready")
      ? "done"
      : (statusProp ?? "ready");
  const streaming = status === "streaming";
  const busy = streaming || status === "submitting";
  const fixedNow = resolveNow(nowProp);
  const now = useNow(fixedNow);

  const legs: Leg[] = segments.filter(isReadySegment).flatMap((segment) => {
    const t = segmentTimes(segment);
    return t ? [{ segment, ...t, minutes: segmentMinutes(segment) }] : [];
  });
  const connections = layovers(legs.map((l) => l.segment));
  const first = legs[0];
  const last = legs[legs.length - 1];
  const boardingPass = passType === "boarding-pass";
  const readyPassengers = passengers.filter(
    (p): p is TicketPassenger => typeof p.name === "string",
  );
  const solo = readyPassengers.length === 1 ? readyPassengers[0] : undefined;
  const total = journeyMinutes(legs.map((l) => l.segment));
  const offset =
    first && last
      ? dayOffset(
          first.depart,
          first.segment.from.timeZone,
          last.arrive,
          last.segment.to.timeZone,
        )
      : 0;

  const opensAt = first
    ? toInstant(checkInOpensAt, first.segment.from.timeZone)
    : null;
  const boardingAt = first
    ? toInstant(first.segment.boardingAt, first.segment.from.timeZone)
    : null;
  const checkIn: CheckInState = checkInState({
    checkedIn,
    passType,
    checkInOpensAt: opensAt,
    departAt: first?.depart,
    now,
  });
  const remaining = useCountdown(
    checkIn === "not-open" ? opensAt : null,
    fixedNow,
  );
  const ticking = remaining !== null && remaining > 0;
  // One status line: boarding on a pass, check-in on a booking.
  const statusLine = boardingPass
    ? boardingText(boardingAt, first?.depart ?? null, now)
    : (checkInText(checkIn, opensAt, now) ??
      departsText(first?.depart ?? null, now));
  const statusStrong =
    (!boardingPass && checkIn === "open") || statusLine === "Boarding now";

  const buttons =
    passType && !streaming ? resolveActions(actions, passType, checkIn) : [];
  const primary = buttons.slice(0, 2);
  const overflow = buttons.slice(2);
  const href = safeUrl(source?.url);
  const name = bookingRef ? `booking ${bookingRef}` : "booking";
  const lastDone = done[done.length - 1];

  const fire = (action: FlightTicketAction) => {
    if (busy || done.includes(action)) return;
    setDone((prev) => [...prev, action]);
    onResult?.({ action });
  };

  const actionLabel = (a: FlightTicketAction) => {
    switch (a) {
      case "check-in":
        return "Check in";
      case "add-to-wallet":
        return "Add to wallet";
      case "choose-seat":
        return readyPassengers.some((p) => p.seat)
          ? "Change seat"
          : "Choose seat";
      case "manage":
        return "Manage booking";
      case "share":
        return "Share";
    }
  };

  const barParts: BarPart[] = legs.flatMap((leg, i): BarPart[] => {
    const parts: BarPart[] = [
      { kind: "leg", key: `leg-${i}`, minutes: leg.minutes ?? 60 },
    ];
    const c = connections[i];
    if (i < legs.length - 1 && c) {
      parts.push({
        kind: "layover",
        key: `layover-${i}`,
        minutes: Math.max(c.minutes, 0),
        code: c.at.code,
      });
    }
    return parts;
  });

  const routeSummary =
    first && last
      ? `${first.segment.from.city} (${first.segment.from.code}) to ${last.segment.to.city} (${last.segment.to.code}), ${
          legs.length === 1
            ? `direct, flight ${first.segment.flightNumber}`
            : `${legs.length - 1} ${legs.length === 2 ? "connection" : "connections"} in ${connections
                .flatMap((c) => (c ? [`${c.at.city} (${c.at.code})`] : []))
                .join(", ")}`
        }.`
      : "";

  // Middle of the route: the flight number (direct) or stops, and the time.
  const routeMiddle = first
    ? [
        legs.length > 1 &&
          `${legs.length - 1} ${legs.length === 2 ? "stop" : "stops"}`,
        total !== null && formatDuration(total),
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  // The pass fields: gate and boarding first on a boarding pass, then seat.
  const facts: {
    label: string;
    icon: LucideIcon;
    context?: string;
    value: string;
  }[] = [];
  if (first?.segment.from.gate) {
    facts.push({
      label: "Gate",
      icon: DoorOpenIcon,
      context: ` at ${first.segment.from.code}`,
      value: first.segment.from.gate,
    });
  }
  if (boardingPass && first && boardingAt !== null) {
    facts.push({
      label: "Boarding",
      icon: ClockIcon,
      value: formatClock(boardingAt, first.segment.from.timeZone),
      context: ` ${zoneLabel(first.segment.from.city, boardingAt, first.segment.from.timeZone)}`,
    });
  }
  if (solo?.seat)
    facts.push({ label: "Seat", icon: ArmchairIcon, value: solo.seat });
  if (boardingPass && first?.segment.boardingGroup) {
    facts.push({
      label: "Group",
      icon: UsersIcon,
      value: first.segment.boardingGroup,
    });
  }
  if (solo?.class) {
    facts.push({
      label: "Class",
      icon: TicketIcon,
      value: CLASS_LABEL[solo.class],
    });
  }

  const showItinerary =
    legs.length > 1 || (streaming && segments.length > legs.length);
  const wordmark = safeLogoSrc(airline?.logoDark);
  const BarcodeIcon = barcode?.format === "qr" ? QrCodeIcon : ScanBarcodeIcon;

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="flight-ticket"
        data-status={status}
        data-pass-type={passType}
        aria-busy={busy}
        aria-label={
          airline?.name
            ? `${airline.name} ${boardingPass ? "boarding pass" : "booking"}${bookingRef ? ` ${bookingRef}` : ""}`
            : "Flight booking"
        }
        className={className}
      >
        <div className={PASS_THEME}>
          <SurfaceHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              {wordmark && !logoFailed ? (
                <>
                  <AirlineWordmark
                    src={wordmark}
                    onFail={() => setLogoFailed(true)}
                  />
                  <span className="sr-only">{airline?.name}</span>
                </>
              ) : (
                <SurfaceTitle>{airline?.name}</SurfaceTitle>
              )}
              {bookingRef ? (
                <div className="-mr-2 flex items-center gap-0.5">
                  <span className="sr-only">Booking reference</span>
                  <span className="font-mono text-[13px] font-medium tracking-wider">
                    {bookingRef}
                  </span>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Copy booking reference ${bookingRef}`}
                          onClick={() => copy(bookingRef)}
                          className="hover:bg-muted dark:hover:bg-white/10"
                        />
                      }
                    >
                      {copied ? (
                        <CheckIcon aria-hidden />
                      ) : (
                        <CopyIcon aria-hidden />
                      )}
                    </TooltipTrigger>
                    <TooltipContent>{`Copy booking reference ${bookingRef}`}</TooltipContent>
                  </Tooltip>
                  <span className="sr-only" aria-live="polite">
                    {copied ? "Copied" : ""}
                  </span>
                </div>
              ) : (
                streaming && <Skeleton className="h-4 w-20" />
              )}
            </div>
            <div className="flex items-baseline justify-between gap-3">
              {first ? (
                <p className={genuiType.meta}>
                  <span suppressHydrationWarning>
                    {formatDate(
                      first.depart,
                      first.segment.from.timeZone,
                      "short",
                      locale,
                    )}
                  </span>
                  {statusLine && (
                    <>
                      <span aria-hidden> · </span>
                      <span
                        className={cn(
                          statusStrong && "font-medium text-foreground",
                        )}
                      >
                        {ticking ? (
                          <>
                            <span className="sr-only">{statusLine}</span>
                            <span aria-hidden>
                              Check-in opens in{" "}
                              <RollingDigits text={clockText(remaining)} />
                            </span>
                          </>
                        ) : (
                          statusLine
                        )}
                      </span>
                    </>
                  )}
                </p>
              ) : (
                <span />
              )}
              {first && legs.length === 1 && (
                <span className="shrink-0 text-[16px] font-medium tabular-nums">
                  <span className="sr-only">Flight </span>
                  {first.segment.flightNumber}
                </span>
              )}
            </div>
          </SurfaceHeader>

          <div className="flex flex-col">
            {/* Route: codes, the big local times, and the journey bar */}
            <div className="border-t border-border px-3 py-3">
              {routeSummary && <p className="sr-only">{routeSummary}</p>}
              <div className="grid grid-cols-[auto_1fr_auto] items-end gap-4">
                <Endpoint
                  align="start"
                  code={first?.segment.from.code}
                  city={first?.segment.from.city}
                  terminal={first?.segment.from.terminal}
                  time={
                    first && (
                      <LocalTime
                        t={first.depart}
                        airport={first.segment.from}
                        verb="Departs"
                        className="text-[16px] leading-tight font-medium"
                      />
                    )
                  }
                />
                <div className="flex min-w-0 flex-col gap-1.5 self-end pb-[26px]">
                  <span
                    aria-hidden
                    className={cn(
                      genuiType.meta,
                      "min-h-4 text-center tabular-nums",
                    )}
                  >
                    {routeMiddle}
                  </span>
                  {legs.length > 1 ? (
                    <RouteBar parts={barParts} />
                  ) : barParts.length > 0 ? (
                    <div aria-hidden className="flex h-5 items-center gap-2">
                      <span className="h-px flex-1 border-t border-dashed border-border" />
                      <PlaneIcon className="size-5 shrink-0 rotate-45 text-foreground" />
                      <span className="h-px flex-1 border-t border-dashed border-border" />
                    </div>
                  ) : (
                    <Skeleton className="h-1.5 w-full rounded-full" />
                  )}
                  {total !== null && (
                    <span className="sr-only">
                      {`${legs.length > 1 ? "Total travel time" : "Flight time"} ${formatDuration(total)}`}
                    </span>
                  )}
                </div>
                <Endpoint
                  align="end"
                  code={last?.segment.to.code}
                  city={last && !streaming ? last.segment.to.city : undefined}
                  terminal={last?.segment.to.terminal}
                  time={
                    last &&
                    !streaming && (
                      <span className="text-[16px] leading-tight font-medium">
                        <LocalTime
                          t={last.arrive}
                          airport={last.segment.to}
                          verb="Arrives"
                        />
                        <DayMark offset={offset} />
                      </span>
                    )
                  }
                />
              </div>
            </div>

            {facts.length > 0 && (
              <dl className="flex flex-wrap gap-x-10 gap-y-4 border-t border-border px-3 py-3">
                {facts.map((f) => (
                  <Fact
                    key={f.label}
                    label={f.label}
                    icon={f.icon}
                    context={f.context}
                    large={boardingPass}
                  >
                    {f.value}
                  </Fact>
                ))}
              </dl>
            )}

            {/* Itinerary: every flight and connection */}
            {showItinerary && (
              <ol
                aria-label="Itinerary"
                className="flex flex-col border-t border-border px-3 py-3"
              >
                {legs.map((leg, i) => {
                  const c = connections[i];
                  return (
                    <React.Fragment
                      key={`${leg.segment.flightNumber}-${leg.segment.departAt}`}
                    >
                      <LegRow
                        leg={leg}
                        hasPrev={i > 0}
                        hasNext={i < legs.length - 1}
                      />
                      {i < legs.length - 1 && c && <LayoverRow layover={c} />}
                    </React.Fragment>
                  );
                })}
                {streaming && (
                  <li aria-hidden className="py-1">
                    <Skeleton className="h-4 w-56 max-w-full" />
                  </li>
                )}
              </ol>
            )}

            {readyPassengers.length > 1 && (
              <div className="border-t border-border px-3 py-3">
                <table className={cn(genuiType.body, "w-full")}>
                  <caption className="sr-only">Passengers</caption>
                  <thead className="sr-only">
                    <tr>
                      <th scope="col">Passenger</th>
                      <th scope="col">Seat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {readyPassengers.map((p, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: names may repeat; passengers only append while streaming
                      <tr key={i}>
                        <th
                          scope="row"
                          className="py-1.5 text-left font-normal"
                        >
                          {p.name}
                        </th>
                        <td
                          className={cn(
                            "py-1.5 text-right tabular-nums",
                            p.seat
                              ? "font-medium"
                              : "text-[13px] text-muted-foreground",
                          )}
                        >
                          {p.seat ?? "No seat"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Boarding pass stub: perforation, passenger, code placeholder */}
          {boardingPass && (
            <>
              <div
                aria-hidden
                // Half-circle notches: circles centered on the card edge, clipped by it.
                className="relative mx-3 border-t-2 border-dashed before:absolute before:top-1/2 before:-left-[25px] before:size-6 before:-translate-y-1/2 before:rounded-full before:bg-background after:absolute after:top-1/2 after:-right-[25px] after:size-6 after:-translate-y-1/2 after:rounded-full after:bg-background"
              />
              <div className="flex items-center justify-between gap-4 px-3 py-3">
                <div className="flex min-w-0 flex-col gap-3">
                  {solo && (
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className={genuiType.label}>Passenger</span>
                      <span className="text-[16px] leading-tight font-medium break-words">
                        {solo.name}
                      </span>
                    </div>
                  )}
                  {(barcode?.label || barcode) && (
                    <p className={genuiType.meta}>
                      {barcode?.label}
                      {barcode?.label && barcode && (
                        <span aria-hidden> · </span>
                      )}
                      {barcode && "Scan in airline app"}
                    </p>
                  )}
                </div>
                {barcode && (
                  <span
                    aria-hidden
                    className="flex size-24 shrink-0 items-center justify-center rounded-[10px] border border-border bg-transparent text-muted-foreground"
                  >
                    <BarcodeIcon className="size-10" strokeWidth={1.25} />
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {(busy || buttons.length > 0 || lastDone || source?.label) && (
          <SurfaceFooter className="justify-between">
            <p aria-live="polite" className={cn(genuiType.meta, "min-w-0")}>
              {streaming ? (
                <ShimmeringText
                  text="Loading booking…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                />
              ) : status === "submitting" ? (
                "Opening…"
              ) : lastDone ? (
                <span className="text-foreground">
                  {CONFIRMATION[lastDone]}
                </span>
              ) : source?.label ? (
                href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex min-h-6 items-center gap-1 rounded-sm underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <span className="sr-only">Source: </span>
                    {source.label}
                    <ExternalLinkIcon aria-hidden className="size-3" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                ) : (
                  <>
                    <span className="sr-only">Source: </span>
                    {source.label}
                  </>
                )
              ) : null}
            </p>
            {buttons.length > 0 && (
              <div className="flex items-center gap-2">
                {primary.map((a, i) => {
                  const used = done.includes(a);
                  return (
                    <WhyDisabled
                      key={a}
                      when={busy || used}
                      reason={used ? "Already done" : "One moment…"}
                    >
                      <Button
                        size="sm"
                        variant={
                          i === 0 && !used
                            ? "default"
                            : used
                              ? "secondary"
                              : "outline"
                        }
                        disabled={busy || used}
                        onClick={() => fire(a)}
                      >
                        {used && <CheckIcon aria-hidden />}
                        {actionLabel(a)}
                        <span className="sr-only">
                          , {name}
                          {used ? " (done)" : ""}
                        </span>
                      </Button>
                    </WhyDisabled>
                  );
                })}
                {overflow.length > 0 && (
                  <Menu.Root>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Menu.Trigger
                            disabled={busy}
                            aria-label={`More actions for ${name}`}
                            render={
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                className="hover:bg-muted dark:hover:bg-white/10"
                              />
                            }
                          />
                        }
                      >
                        <EllipsisIcon aria-hidden />
                      </TooltipTrigger>
                      <TooltipContent>{`More actions for ${name}`}</TooltipContent>
                    </Tooltip>
                    <Menu.Portal>
                      <Menu.Positioner
                        sideOffset={4}
                        align="end"
                        className="isolate z-50 outline-none"
                      >
                        <Menu.Popup className="min-w-40 origin-(--transform-origin) rounded-[10px] bg-popover p-1.5 text-popover-foreground shadow-md dark:shadow-none ring-1 ring-foreground/10 outline-none">
                          {overflow.map((a) => {
                            const used = done.includes(a);
                            return (
                              <Menu.Item
                                key={a}
                                disabled={used}
                                onClick={() => fire(a)}
                                className="flex min-h-9 cursor-default items-center gap-2 rounded-lg px-3 py-2 text-[13px] outline-none select-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                              >
                                {actionLabel(a)}
                                {used && (
                                  <>
                                    <CheckIcon
                                      aria-hidden
                                      className="ml-auto size-3.5"
                                    />
                                    <span className="sr-only"> (done)</span>
                                  </>
                                )}
                              </Menu.Item>
                            );
                          })}
                        </Menu.Popup>
                      </Menu.Positioner>
                    </Menu.Portal>
                  </Menu.Root>
                )}
              </div>
            )}
          </SurfaceFooter>
        )}
      </Surface>
    </MotionConfig>
  );
}
