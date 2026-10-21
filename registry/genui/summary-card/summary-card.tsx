"use client"

import {
  BedDoubleIcon,
  BriefcaseIcon,
  BugIcon,
  CalendarIcon,
  CarIcon,
  ClockIcon,
  CloudSunIcon,
  CreditCardIcon,
  FileTextIcon,
  FlameIcon,
  HomeIcon,
  LifeBuoyIcon,
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  ListChecksIcon,
  type LucideIcon,
  MailIcon,
  MapPinIcon,
  PackageIcon,
  PhoneIcon,
  PlaneIcon,
  RouteIcon,
  ShieldIcon,
  TargetIcon,
  StarIcon,
  TagIcon,
  TimerIcon,
  UserIcon,
  UsersIcon,
  UtensilsIcon,
  WalletIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import {
  genuiType,
  Skeleton,
  Surface,
  SurfaceTitle,
} from "@/components/genui/surface"

import type {
  SummaryCardInput,
  SummaryFact,
  SummaryIcon,
} from "./summary-card.schema"

const ICONS: Record<SummaryIcon, LucideIcon> = {
  calendar: CalendarIcon,
  clock: ClockIcon,
  timer: TimerIcon,
  users: UsersIcon,
  user: UserIcon,
  "map-pin": MapPinIcon,
  bed: BedDoubleIcon,
  wallet: WalletIcon,
  "credit-card": CreditCardIcon,
  tag: TagIcon,
  package: PackageIcon,
  plane: PlaneIcon,
  car: CarIcon,
  utensils: UtensilsIcon,
  flame: FlameIcon,
  mail: MailIcon,
  phone: PhoneIcon,
  "file-text": FileTextIcon,
  "list-checks": ListChecksIcon,
  bug: BugIcon,
  shield: ShieldIcon,
  star: StarIcon,
  home: HomeIcon,
  briefcase: BriefcaseIcon,
  "life-buoy": LifeBuoyIcon,
  route: RouteIcon,
  target: TargetIcon,
  "cloud-sun": CloudSunIcon,
}

export type SummaryCardProps = Partial<Omit<SummaryCardInput, "facts">> & {
  /** Facts may be partial while the tool call streams. */
  facts?: Partial<SummaryFact>[]
  /** Lifecycle, controlled by the host. */
  status?: "streaming" | "ready"
  className?: string
}

export function SummaryCard({
  title,
  summary,
  facts = [],
  badge,
  badgeTone,
  status: lifecycle = "ready",
  className,
}: SummaryCardProps) {
  const streaming = lifecycle === "streaming"
  const ready = facts.filter(
    (f): f is SummaryFact =>
      typeof f.label === "string" && typeof f.value === "string",
  )

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="summary-card"
        data-status={lifecycle}
        aria-busy={streaming}
        aria-label={title ?? "Summary"}
        className={cn("@container", className)}
      >
        <div className="flex flex-col gap-1.5 px-3 pt-3">
          <div className="flex min-h-6 flex-wrap items-center gap-2">
            {routeParts(title) ? (
              <RouteTitle title={title} parts={routeParts(title) as [string, string]} />
            ) : (
              <SurfaceTitle>{title}</SurfaceTitle>
            )}
            {badge && (
              <Badge
                variant={
                  badgeTone && badgeTone !== "neutral"
                    ? badgeTone === "danger"
                      ? "destructive"
                      : badgeTone
                    : "outline"
                }
              >
                {badge}
              </Badge>
            )}
          </div>
          {summary && (
            <p
              className={cn(
                genuiType.body,
                "text-pretty text-muted-foreground",
              )}
            >
              {summary}
            </p>
          )}
        </div>
        {/* Facts flow into columns by the card's own width: two floors of two for
            four facts, three across for three or five and more. */}
        <dl
          className={cn(
            "mt-5 grid gap-x-10 gap-y-4 border-t border-border px-3 pt-3 pb-3",
            ready.length === 2 && "@[15rem]:grid-cols-2",
            ready.length === 3 && "@[15rem]:grid-cols-2 @[30rem]:grid-cols-3",
            ready.length === 4 && "@[15rem]:grid-cols-2",
            ready.length >= 5 && "@[15rem]:grid-cols-2 @[30rem]:grid-cols-3",
            // While streaming, a couple of columns hold the placeholders.
            streaming && ready.length < 2 && "@[15rem]:grid-cols-2",
          )}
        >
          {ready.map((f) => (
            <motion.div
              key={f.label}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col gap-0.5"
            >
              <dt className={cn(genuiType.label, "flex items-center gap-1.5")}>
                {f.icon && ICONS[f.icon] && <FactIcon name={f.icon} />}
                {f.label}
              </dt>
              <dd
                className={cn(
                  genuiType.body,
                  "flex min-w-0 items-center gap-2 font-medium tabular-nums",
                  isPlaceholder(f.value) &&
                    "font-normal text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "min-w-0",
                    splitDelta(f).delta ? "truncate" : "break-words",
                  )}
                >
                  {splitDelta(f).value}
                </span>
                {splitDelta(f).delta && (
                  <DeltaBadge delta={splitDelta(f).delta as string} />
                )}
              </dd>
            </motion.div>
          ))}
          {streaming &&
            Array.from(
              { length: Math.max(0, 2 - ready.length) + 1 },
              (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional
                <div key={i} className="flex flex-col gap-1.5">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-40" />
                </div>
              ),
            )}
        </dl>
      </Surface>
    </MotionConfig>
  )
}

/** "Pick a time above", "Not picked yet", "TBD", "—": a value that is not data yet. */
function isPlaceholder(value: string) {
  return /^(—|–|-|…|tbd|pending|(not|nothing) (picked|set|chosen|selected)( yet)?|(pick|choose|select) .*)$/i.test(
    value.trim(),
  )
}

/**
 * A fact's value and its change. `delta` wins; an old-style value such as
 * "$4.6M, up 11%" is split into "$4.6M" and "+11%".
 */
function splitDelta(f: SummaryFact): { value: string; delta?: string } {
  if (f.delta) return { value: f.value, delta: f.delta }
  const m = f.value.match(/^(.*?)[,\s]+(up|down)\s+(\d[\d.,]*%)$/i)
  if (!m) return { value: f.value }
  return {
    value: m[1],
    delta: `${m[2].toLowerCase() === "up" ? "+" : "-"}${m[3]}`,
  }
}

/** Green for an increase, red for a decrease, outline when it has no sign. */
function DeltaBadge({ delta }: { delta: string }) {
  const up = /^(\+|up\b|↑)/i.test(delta)
  const down = /^(-|−|down\b|↓)/i.test(delta)
  const Icon = up ? ArrowUpRightIcon : down ? ArrowDownRightIcon : null
  return (
    <Badge className="shrink-0" variant={up ? "success" : down ? "destructive" : "outline"}>
      {Icon && <Icon aria-hidden />}
      <span className="sr-only">
        {up ? "Increase of " : down ? "Decrease of " : ""}
      </span>
      {delta.replace(/^(\+|-|−|up\s*|down\s*|↑|↓)\s*/i, "")}
    </Badge>
  )
}

/** "06:40 → 10:05" splits into a route; anything else is a plain title. */
function routeParts(title?: string): [string, string] | null {
  if (!title) return null
  const parts = title.split(/\s*→\s*/)
  if (parts.length !== 2) return null
  const [a, b] = parts
  if (!a || !b || a.length > 14 || b.length > 14) return null
  return [a, b]
}

/** Start, a dashed line between two dots across the full width, end. */
function RouteTitle({
  title,
  parts,
}: {
  title?: string
  parts: [string, string]
}) {
  return (
    <h3 className="flex min-w-0 flex-1 items-center gap-3">
      <span className="sr-only">{title}</span>
      <span aria-hidden className="font-figure text-[28px] leading-none tabular-nums">
        {parts[0]}
      </span>
      <span aria-hidden className="flex min-w-6 flex-1 items-center">
        <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" />
        <span className="h-0 flex-1 border-t border-dashed border-muted-foreground/60" />
        <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" />
      </span>
      <span aria-hidden className="font-figure text-[28px] leading-none tabular-nums">
        {parts[1]}
      </span>
    </h3>
  )
}

function FactIcon({ name }: { name: SummaryIcon }) {
  const Icon = ICONS[name]
  return <Icon aria-hidden className="size-3.5 shrink-0" />
}
