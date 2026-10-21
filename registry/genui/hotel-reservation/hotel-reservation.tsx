"use client";

import * as React from "react";
import { Menu } from "@base-ui/react/menu";
import {
  BedDoubleIcon,
  BuildingIcon,
  CheckIcon,
  CopyIcon,
  EllipsisIcon,
  LogInIcon,
  LogOutIcon,
  type LucideIcon,
  WalletIcon,
  WifiIcon,
} from "lucide-react";
import { MotionConfig, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering";
import { Button, buttonVariants } from "@/components/ui/button";
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
  buildStayIcs,
  cancellationLine,
  directionsUrl,
  formatClockValue,
  formatMoney,
  formatStayDate,
  icsFilename,
  nightsBetween,
  nightsLabel,
  resolveNow,
  safeUrl,
  stayState,
  telHref,
} from "./hotel-reservation-utils";
import type {
  HotelReservationInput,
  HotelReservationResult,
  ReservationHotel,
  ReservationStay,
} from "./hotel-reservation.schema";
import { IconTip, WhyDisabled } from "@/components/genui/hint";
import { useGenUILocale } from "@/components/genui/locale";

export type HotelReservationStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "done";

type Action = HotelReservationResult["action"];
type Room = NonNullable<HotelReservationInput["room"]>;

export type HotelReservationProps = Partial<
  Omit<
    HotelReservationInput,
    | "hotel"
    | "stay"
    | "room"
    | "digitalKey"
    | "checkIn"
    | "wifi"
    | "balance"
    | "cancellation"
  >
> & {
  /** Everything may be partial while the tool call streams. */
  hotel?: Partial<ReservationHotel>;
  stay?: Partial<ReservationStay>;
  room?: Partial<Room>;
  digitalKey?: { available?: boolean; url?: string };
  checkIn?: { online?: boolean; done?: boolean; url?: string };
  wifi?: { network?: string; password?: string };
  balance?: { due?: number; currency?: string };
  cancellation?: { freeUntil?: string };
  /**
   * The moment "Tonight" or "In 3 days" is measured from. Defaults to the
   * viewer's clock, read after mount and refreshed every minute.
   */
  now?: Date | string | number;
  /**
   * Lifecycle, controlled by the host. 'submitting' while the host handles an
   * action. When omitted, the component tracks the user's actions itself.
   */
  status?: HotelReservationStatus;
  /**
   * Called once per action (check-in, open-digital-key,
   * request-late-checkout). Each is a handoff; the others stay available.
   */
  onResult?: (result: HotelReservationResult) => void;
  /** Actions from history (one or several). Shown as done; never calls onResult. */
  result?: HotelReservationResult | HotelReservationResult[];
  className?: string;
};

const CONFIRMATION: Record<Action, string> = {
  "check-in": "Opening online check-in…",
  "open-digital-key": "Opening your digital key…",
  "request-late-checkout": "Asking the hotel for a late check-out…",
};

const MASK = "••••••••";

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

/** A short-lived message for the live region ("Copied"). */
function useNotice() {
  const [notice, setNotice] = React.useState<string | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const show = (text: string | null) => {
    setNotice(text);
    clearTimeout(timer.current);
    if (text) timer.current = setTimeout(() => setNotice(null), 2000);
  };
  return [notice, show] as const;
}

function downloadFile(filename: string, content: string, type: string) {
  const href = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}

function Fact({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-none flex-col gap-1 px-3 py-3">
      <dt className={cn(genuiType.label, "flex items-center gap-1.5")}>
        {Icon && <Icon aria-hidden className="size-3.5 shrink-0" />}
        {label}
      </dt>
      <dd className="font-figure text-[30px] leading-none font-normal tracking-tight break-words tabular-nums">
        {children}
      </dd>
    </div>
  );
}

/** Check-in or check-out: the hotel's time large, the date beneath. */
function StayEnd({
  label,
  icon: Icon,
  date,
  time,
  align,
}: {
  label: string;
  icon: LucideIcon;
  date: string;
  time: string | null;
  align: "start" | "end";
}) {
  const locale = useGenUILocale();
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1.5",
        align === "end" && "items-end text-right",
      )}
    >
      <dt className={cn(genuiType.label, "flex items-center gap-1.5")}>
        <Icon aria-hidden className="size-3.5 shrink-0" />
        {label}
      </dt>
      <dd className={time ? genuiType.display : genuiType.title}>
        {time ?? (
          <span suppressHydrationWarning>{formatStayDate(date, locale)}</span>
        )}
        {time && <span className="sr-only"> hotel time</span>}
      </dd>
      {time && (
        <dd className={genuiType.meta} suppressHydrationWarning>
          {formatStayDate(date, locale)}
        </dd>
      )}
    </div>
  );
}

/**
 * A footer action. `href` opens a link (in a new tab unless `sameTab`);
 * `fires` reports a handoff the first time. A handoff without a link locks
 * after use; with one it stays usable, since a key is opened more than once.
 */
type FooterAction = {
  id: string;
  label: string;
  /** Spoken after the label. */
  context: string;
  href?: string | null;
  sameTab?: boolean;
  fires?: Action;
  onSelect?: () => void;
};

export function HotelReservation({
  hotel = {},
  confirmation,
  stay,
  room,
  digitalKey,
  checkIn,
  wifi,
  balance,
  cancellation,
  now: nowProp,
  status: statusProp,
  onResult,
  result,
  className,
}: HotelReservationProps) {
  const locale = useGenUILocale();
  const [done, setDone] = React.useState<Set<Action>>(
    () =>
      new Set(
        (result === undefined
          ? []
          : Array.isArray(result)
            ? result
            : [result]
        ).map((r) => r.action),
      ),
  );
  const [showPassword, setShowPassword] = React.useState(false);
  const [notice, setNotice] = useNotice();

  // A host-provided "ready" (or nothing) yields to the user's actions.
  const status: HotelReservationStatus =
    done.size > 0 && (statusProp === undefined || statusProp === "ready")
      ? "done"
      : (statusProp ?? "ready");
  const streaming = status === "streaming";
  const busy = streaming || status === "submitting";
  const now = useNow(resolveNow(nowProp));

  const timeZone = hotel.timeZone ?? "UTC";
  const dates =
    typeof stay?.checkIn === "string" && typeof stay.checkOut === "string"
      ? { checkIn: stay.checkIn, checkOut: stay.checkOut }
      : null;
  const nights = dates ? nightsBetween(dates.checkIn, dates.checkOut) : 0;
  const state =
    dates && hotel.timeZone
      ? stayState(dates, { timeZone, checkOutUntil: hotel.checkOutUntil }, now)
      : null;
  const ended = state?.phase === "ended";
  const name = hotel.name ?? "the hotel";
  const context = hotel.name ? `${hotel.name}` : "hotel reservation";

  const checkInTime = formatClockValue(hotel.checkInFrom);
  const checkOutTime = formatClockValue(hotel.checkOutUntil);
  const directions = hotel.address ? directionsUrl(hotel.address) : null;
  const tel = telHref(hotel.phone);
  const keyHref = safeUrl(digitalKey?.url);
  const checkInHref = safeUrl(checkIn?.url);
  const floor =
    room?.floor === undefined || room.floor === "" ? null : String(room.floor);
  const showCancellation =
    !!cancellation?.freeUntil && (state === null || state.phase === "upcoming");
  const cancelText = showCancellation
    ? cancellationLine(cancellation?.freeUntil, timeZone, now, locale)
    : null;
  const hasBalance =
    typeof balance?.due === "number" && typeof balance.currency === "string";

  const fire = (action: Action) => {
    if (busy || done.has(action)) return;
    setDone((prev) => new Set(prev).add(action));
    onResult?.({ action });
  };

  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(message);
    } catch {
      setNotice("Couldn't copy. Select the text instead.");
    }
  };

  const addToCalendar = () => {
    if (!dates || !hotel.name) return;
    const ics = buildStayIcs({
      hotelName: hotel.name,
      address: hotel.address,
      timeZone,
      checkInFrom: hotel.checkInFrom,
      checkOutUntil: hotel.checkOutUntil,
      stay: dates,
      confirmation,
      url: hotel.url,
      stamp: Date.now(),
    });
    if (!ics) return;
    downloadFile(icsFilename(hotel.name), ics, "text/calendar;charset=utf-8");
    setNotice("Calendar file downloaded");
  };

  const showCheckIn =
    !streaming && !ended && checkIn?.online === true && checkIn.done !== true;
  const showKey = !streaming && !ended && digitalKey?.available === true;
  const showLateCheckout = !streaming && !ended && !!dates;
  const canCalendar =
    !streaming && !!hotel.name && !!dates && nights > 0 && !!hotel.timeZone;

  // Footer actions in order of use; the first two show, the rest go in "More".
  const late: FooterAction | null = showLateCheckout
    ? {
        id: "late",
        label: "Request late check-out",
        context,
        fires: "request-late-checkout",
      }
    : null;
  const footerActions = [
    state?.phase === "departure" ? late : null,
    showCheckIn
      ? {
          id: "check-in",
          label: "Check in online",
          context,
          href: checkInHref,
          fires: "check-in" as const,
        }
      : null,
    showKey
      ? {
          id: "key",
          label: "Open digital key",
          context,
          href: keyHref,
          fires: "open-digital-key" as const,
        }
      : null,
    !streaming && directions
      ? {
          id: "directions",
          label: "Directions",
          context: `to ${name}`,
          href: directions,
        }
      : null,
    !streaming && tel
      ? {
          id: "call",
          label: "Call hotel",
          context: `${hotel.phone}`,
          href: tel,
          sameTab: true,
        }
      : null,
    canCalendar
      ? {
          id: "calendar",
          label: "Add to calendar",
          context: `stay at ${name}`,
          onSelect: addToCalendar,
        }
      : null,
    state?.phase === "departure" ? null : late,
  ].filter((a): a is FooterAction => a !== null);
  const primary = footerActions.slice(0, 2);
  const overflow = footerActions.slice(2);
  const lastDone = [...done].at(-1);

  const select = (a: FooterAction) => {
    if (a.fires) fire(a.fires);
    a.onSelect?.();
  };
  const isLocked = (a: FooterAction) =>
    !!a.fires && !a.href && done.has(a.fires);

  // A quiet line for what changes a decision: free cancellation, key pickup.
  const note =
    cancelText ??
    (!streaming && !ended && digitalKey?.available === false
      ? "No digital key · collect at the front desk"
      : null);

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="hotel-reservation"
        data-status={status}
        data-phase={state?.phase}
        aria-busy={busy}
        aria-label={hotel.name ? `Stay at ${hotel.name}` : "Hotel reservation"}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <SurfaceTitle>{hotel.name}</SurfaceTitle>
            {confirmation ? (
              <div className="-mr-2 flex min-w-0 items-center gap-0.5">
                <span className="sr-only">Confirmation number</span>
                <span className="font-mono text-[13px] font-medium tracking-wider break-all">
                  {confirmation}
                </span>
                <IconTip label={`Copy confirmation number ${confirmation}`}>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Copy confirmation number ${confirmation}`}
                    onClick={() =>
                      copy(confirmation, "Confirmation number copied")
                    }
                  >
                    <CopyIcon aria-hidden />
                  </Button>
                </IconTip>
              </div>
            ) : (
              streaming && <Skeleton className="h-4 w-24" />
            )}
          </div>
          {state && !streaming ? (
            <p className={genuiType.meta}>
              <span className="font-medium">{state.text}</span>
              {checkIn?.done &&
                (state.phase === "upcoming" || state.phase === "arrival") &&
                " · Checked in online"}
            </p>
          ) : (
            streaming && <Skeleton className="h-3 w-32" />
          )}
        </SurfaceHeader>

        <div className="flex flex-col">
          {/* Dates: check-in and check-out times, large */}
          {dates ? (
            <dl className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-border px-3 py-3">
              <StayEnd
                label="Check-in"
                icon={LogInIcon}
                date={dates.checkIn}
                time={checkInTime}
                align="start"
              />
              <div className="flex flex-col items-center">
                <dt className="sr-only">Length of stay</dt>
                <dd className={cn(genuiType.meta, "tabular-nums")}>
                  {nights > 0 ? nightsLabel(nights) : "–"}
                </dd>
              </div>
              <StayEnd
                label="Check-out"
                icon={LogOutIcon}
                date={dates.checkOut}
                time={checkOutTime}
                align="end"
              />
            </dl>
          ) : (
            <div
              aria-hidden
              className="flex items-end justify-between border-t border-border px-3 py-3"
            >
              <Skeleton className="h-12 w-20" />
              <Skeleton className="h-12 w-20" />
            </div>
          )}

          {/* Room: type, then number and floor large once assigned */}
          {(room?.type || hasBalance) && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={genuiMotion.fade}
              className="flex flex-col border-t border-border"
            >
              {room?.type && (
                <p
                  className={cn(
                    genuiType.body,
                    "px-3 pt-3",
                    !(room?.number || hasBalance) && "pb-3",
                  )}
                >
                  <span className="sr-only">Room type: </span>
                  <span className="font-medium">{room.type}</span>
                  {!room.number && (
                    <span className="text-muted-foreground">
                      {" · Room assigned at check-in"}
                    </span>
                  )}
                </p>
              )}
              {(room?.number || hasBalance) && (
                <dl className="flex flex-wrap gap-x-10">
                  {room?.number && (
                    <Fact label="Room" icon={BedDoubleIcon}>
                      {room.number}
                    </Fact>
                  )}
                  {room?.number && floor && (
                    <Fact label="Floor" icon={BuildingIcon}>
                      {floor}
                    </Fact>
                  )}
                  {hasBalance && (
                    <Fact label="Due at hotel" icon={WalletIcon}>
                      {balance?.due === 0
                        ? "Nothing"
                        : formatMoney(
                            balance?.due ?? 0,
                            balance?.currency,
                            locale,
                          )}
                    </Fact>
                  )}
                </dl>
              )}
            </motion.div>
          )}

          {/* Wi-Fi: one row, password masked until Show */}
          {wifi?.network && (
            <dl className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border py-2 pr-2 pl-3">
              <dt className={cn(genuiType.label, "flex items-center gap-1.5")}>
                <WifiIcon aria-hidden className="size-3.5 shrink-0" />
                Wi-Fi
              </dt>
              <dd className={cn(genuiType.body, "font-medium break-all")}>
                {wifi.network}
              </dd>
              {wifi.password && (
                <>
                  <dt className="sr-only">Password</dt>
                  <dd className="flex min-w-0 items-center gap-0.5">
                    {showPassword ? (
                      <span className="font-mono text-[13px] font-medium break-all">
                        {wifi.password}
                      </span>
                    ) : (
                      <span className="font-mono text-[13px] font-medium">
                        <span aria-hidden>{MASK}</span>
                        <span className="sr-only">Hidden</span>
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? "Hide" : "Show"}
                      <span className="sr-only"> Wi-Fi password</span>
                    </Button>
                    <IconTip label="Copy Wi-Fi password">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Copy Wi-Fi password"
                        onClick={() =>
                          wifi.password &&
                          copy(wifi.password, "Wi-Fi password copied")
                        }
                      >
                        <CopyIcon aria-hidden />
                      </Button>
                    </IconTip>
                  </dd>
                </>
              )}
            </dl>
          )}

          {note && (
            <p
              className={cn(genuiType.meta, "border-t border-border px-3 py-3")}
              suppressHydrationWarning
            >
              {note}
            </p>
          )}
        </div>

        <SurfaceFooter className="justify-between">
          <p aria-live="polite" className={cn(genuiType.meta, "min-w-0")}>
            {streaming ? (
              <ShimmeringText
                text="Loading reservation…"
                color="var(--muted-foreground)"
                shimmeringColor="var(--foreground)"
              />
            ) : status === "submitting" ? (
              "Sending…"
            ) : notice ? (
              notice
            ) : lastDone ? (
              <span className="text-foreground">{CONFIRMATION[lastDone]}</span>
            ) : null}
          </p>
          {footerActions.length > 0 && (
            <div className="flex items-center gap-2">
              {[...primary].reverse().map((a) => {
                const variant = a === primary[0] ? "default" : "outline";
                if (a.href && !busy) {
                  return (
                    <a
                      key={a.id}
                      href={a.href}
                      {...(a.sameTab
                        ? {}
                        : {
                            target: "_blank",
                            rel: "noopener noreferrer nofollow",
                          })}
                      onClick={() => select(a)}
                      className={cn(
                        buttonVariants({ variant, size: "sm" }),
                        "focus-visible:ring-2 focus-visible:ring-ring/50",
                      )}
                    >
                      {a.label}
                      <span className="sr-only">
                        {`, ${a.context}${a.sameTab ? "" : " (opens in a new tab)"}`}
                      </span>
                    </a>
                  );
                }
                const locked = isLocked(a);
                return (
                  <WhyDisabled key={a.id} when={locked} reason="Already done">
                    <Button
                      size="sm"
                      variant={locked ? "secondary" : variant}
                      disabled={busy || locked}
                      onClick={() => select(a)}
                    >
                      {locked && <CheckIcon aria-hidden />}
                      {a.label}
                      <span className="sr-only">
                        {`, ${a.context}${locked ? " (done)" : ""}`}
                      </span>
                    </Button>
                  </WhyDisabled>
                );
              })}
              {overflow.length > 0 && (
                <Menu.Root>
                  <IconTip label={`More actions for ${context}`}>
                    <Menu.Trigger
                      disabled={busy}
                      aria-label={`More actions for ${context}`}
                      render={<Button size="icon-sm" variant="ghost" />}
                    >
                      <EllipsisIcon aria-hidden />
                    </Menu.Trigger>
                  </IconTip>
                  <Menu.Portal>
                    <Menu.Positioner
                      sideOffset={4}
                      align="end"
                      className="isolate z-50 outline-none"
                    >
                      <Menu.Popup className="min-w-48 origin-(--transform-origin) rounded-[10px] bg-popover p-1.5 text-popover-foreground shadow-md dark:shadow-none ring-1 ring-foreground/10 outline-none">
                        {overflow.map((a) => {
                          const locked = isLocked(a);
                          const itemClass =
                            "flex min-h-9 cursor-default items-center gap-2 rounded-lg px-3 py-2 text-[13px] outline-none select-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground";
                          return a.href ? (
                            <Menu.Item
                              key={a.id}
                              render={
                                <a
                                  href={a.href}
                                  {...(a.sameTab
                                    ? {}
                                    : {
                                        target: "_blank",
                                        rel: "noopener noreferrer nofollow",
                                      })}
                                />
                              }
                              onClick={() => select(a)}
                              className={itemClass}
                            >
                              {a.label}
                              <span className="sr-only">
                                {`, ${a.context}${a.sameTab ? "" : " (opens in a new tab)"}`}
                              </span>
                            </Menu.Item>
                          ) : (
                            <Menu.Item
                              key={a.id}
                              disabled={locked}
                              onClick={() => select(a)}
                              className={itemClass}
                            >
                              {a.label}
                              {locked && (
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
      </Surface>
    </MotionConfig>
  );
}
