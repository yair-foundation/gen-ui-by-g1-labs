"use client"

import * as React from "react"
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  StarIcon,
} from "lucide-react"
import { MotionConfig, motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  genuiType,
  Skeleton,
  Surface,
  SurfaceHeader,
  SurfaceTitle,
  genuiMotion,
} from "@/components/genui/surface"

import type {
  Entity,
  EntityAction,
  EntityActionId,
  EntityCardInput,
  EntityCardResult,
} from "./entity-card.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"

export type EntityCardStatus = "streaming" | "ready"

type PartialEntity = Partial<Entity>
type ReadyEntity = PartialEntity & { id: string; name: string }
type ReadyAction = { id: EntityActionId; label: string }

export type EntityCardProps = Partial<
  Omit<EntityCardInput, "entities" | "actions">
> & {
  /** Items may be partial while the tool call streams. */
  entities?: PartialEntity[]
  actions?: Partial<EntityAction>[]
  /** Lifecycle, controlled by the host. */
  status?: EntityCardStatus
  /**
   * Called once per button press, e.g. { action: "add_to_cart", entityId }.
   * The pressed button switches to its done state; other buttons stay usable.
   */
  onResult?: (result: EntityCardResult) => void
  /**
   * Actions already taken (from history). Those buttons render as done and
   * are never sent again; the others stay usable.
   */
  result?: EntityCardResult | EntityCardResult[]
  className?: string
}

const doneLabel: Record<EntityActionId, string> = {
  add_to_cart: "Added",
  save: "Saved",
  select: "Selected",
  book: "Requested",
  contact: "Requested",
}

const announce: Record<EntityActionId, (name: string) => string> = {
  add_to_cart: (name) => `Added ${name} to cart`,
  save: (name) => `Saved ${name}`,
  select: (name) => `Selected ${name}`,
  book: (name) => `Booking requested for ${name}`,
  contact: (name) => `Contact requested for ${name}`,
}

const CARD_WIDTH = 220

function safeUrl(url?: string) {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null
  } catch {
    return null
  }
}

/** Image src: http(s), or a same-origin path with a single leading "/". */
function safeImageSrc(url?: string) {
  if (url && /^\/(?![/\\])/.test(url.trim())) return url.trim()
  return safeUrl(url)
}

function formatPrice(price: Entity["price"], locale: string) {
  if (!price || typeof price.amount !== "number") return null
  try {
    // Whole amounts drop the ".00": "$129", not "$129.00".
    const whole = Number.isInteger(price.amount)
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: price.currency,
      ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
    }).format(price.amount)
  } catch {
    return `${new Intl.NumberFormat(locale).format(price.amount)} ${price.currency}`
  }
}

const key = (entityId: string, action: string) => `${entityId}\u0000${action}`

function EntityImage({
  entity,
  className,
  letterClassName,
}: {
  entity: ReadyEntity
  className?: string
  letterClassName?: string
}) {
  const src = safeImageSrc(entity.image?.url)
  const [failed, setFailed] = React.useState<string | null>(null)

  if (!src || failed === src) {
    return (
      <div
        aria-hidden
        className={cn(
          "flex items-center justify-center border border-border bg-transparent font-medium text-muted-foreground select-none",
          className,
        )}
      >
        <span className={letterClassName}>
          {entity.name.trim().charAt(0).toUpperCase()}
        </span>
      </div>
    )
  }

  return (
    // biome-ignore lint/performance/noImgElement: agent-provided remote URLs; next/image would need every host configured
    <img
      src={src}
      alt={entity.image?.alt ?? ""}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
      className={cn("bg-muted object-cover", className)}
    />
  )
}

function EntityName({ entity }: { entity: ReadyEntity }) {
  const href = safeUrl(entity.url)
  return (
    <h4 className={cn(genuiType.title, "leading-snug")}>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {entity.name}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : (
        entity.name
      )}
    </h4>
  )
}

function Rating({ rating }: { rating: NonNullable<Entity["rating"]> }) {
  const locale = useGenUILocale()
  const value = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(rating.value)
  const count =
    typeof rating.count === "number"
      ? new Intl.NumberFormat(locale).format(rating.count)
      : null
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <span aria-hidden className="inline-flex items-center gap-1">
        <StarIcon className="size-3.5 shrink-0 fill-current" />
        {value}
      </span>
      <span className="sr-only">
        {`Rated ${value} out of 5`}
        {count !== null &&
          ` from ${count} ${rating.count === 1 ? "review" : "reviews"}`}
      </span>
    </span>
  )
}

/**
 * Who or what it is, the rating, then the compared facts. A card (narrow)
 * keeps the name line and the rating line apart so neither wraps mid-phrase;
 * a row (wide) runs them as one quiet line.
 */
function Details({
  entity,
  stacked,
}: {
  entity: ReadyEntity
  stacked?: boolean
}) {
  const attributes = entity.attributes?.filter(Boolean).slice(0, 3) ?? []
  const rated = entity.rating && typeof entity.rating.value === "number"
  const rating =
    rated && entity.rating ? <Rating rating={entity.rating} /> : null
  const join = (items: { key: string; node: React.ReactNode }[]) =>
    items.map((p, i) => (
      <React.Fragment key={p.key}>
        {i > 0 && (
          <span aria-hidden className="mx-1">
            ·
          </span>
        )}
        {p.node}
      </React.Fragment>
    ))
  const facts = attributes.map((a) => ({
    key: `a-${a}`,
    node: a as React.ReactNode,
  }))
  if (stacked) {
    const second = [
      ...(rating ? [{ key: "rating", node: rating as React.ReactNode }] : []),
      ...facts,
    ]
    if (!entity.subtitle && second.length === 0) return null
    return (
      <div className="flex flex-col gap-0.5">
        {entity.subtitle && (
          <p className={cn(genuiType.meta, "truncate")}>{entity.subtitle}</p>
        )}
        {second.length > 0 && (
          <p
            className={cn(genuiType.meta, "flex items-center truncate")}
            title={attributes.join(" · ") || undefined}
          >
            {join(second)}
          </p>
        )}
      </div>
    )
  }
  const parts = [
    ...(entity.subtitle
      ? [{ key: "sub", node: entity.subtitle as React.ReactNode }]
      : []),
    ...(rating ? [{ key: "rating", node: rating as React.ReactNode }] : []),
    ...facts,
  ]
  if (parts.length === 0) return null
  return (
    <p className={cn(genuiType.meta, "flex flex-wrap items-center")}>
      {join(parts)}
    </p>
  )
}

function Actions({
  entity,
  actions,
  isDone,
  disabled,
  onAction,
  className,
  wrapClassName,
  quiet,
}: {
  entity: ReadyEntity
  actions: ReadyAction[]
  /** A repeated single action stays hollow (the top row passes false). */
  quiet?: boolean
  isDone: (entityId: string, action: EntityActionId) => boolean
  disabled: boolean
  onAction: (entity: ReadyEntity, action: ReadyAction) => void
  className?: string
  /** Layout classes for the span that carries a done button's tooltip. */
  wrapClassName?: string
}) {
  if (actions.length === 0) return null
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {actions.map((action, index) => {
        const done = isDone(entity.id, action.id)
        const text = done ? doneLabel[action.id] : action.label
        return (
          <WhyDisabled
            key={action.id}
            reason={
              done ? `Already ${doneLabel[action.id].toLowerCase()}` : undefined
            }
            className={wrapClassName}
          >
            <Button
              size="sm"
              // A done button is a status, so every done button looks the same.
              variant={
                !done && (actions.length === 1 ? !quiet : index === 0)
                  ? "default"
                  : "secondary"
              }
              disabled={disabled || done}
              aria-label={`${text}: ${entity.name}`}
              onClick={() => onAction(entity, action)}
            >
              {done && <CheckIcon aria-hidden />}
              {text}
            </Button>
          </WhyDisabled>
        )
      })}
    </div>
  )
}

function badgeVariant(tone?: string) {
  if (!tone || tone === "neutral") return "outline" as const
  return tone === "danger"
    ? ("destructive" as const)
    : (tone as "success" | "warning" | "info")
}

export function EntityCard({
  title,
  layout = "carousel",
  entities = [],
  actions = [],
  status: statusProp,
  onResult,
  result,
  className,
}: EntityCardProps) {
  const status: EntityCardStatus = statusProp ?? "ready"
  const streaming = status === "streaming"
  const locale = useGenUILocale()

  // Done = restored from history, plus what the user pressed here.
  const [pressed, setPressed] = React.useState<Set<string>>(() => new Set())
  const [message, setMessage] = React.useState("")
  const restored = React.useMemo(() => {
    const list = result === undefined ? [] : [result].flat()
    return new Set(list.map((r) => key(r.entityId, r.action)))
  }, [result])
  const isDone = (entityId: string, action: EntityActionId) =>
    restored.has(key(entityId, action)) || pressed.has(key(entityId, action))

  const ready = entities.filter(
    (e): e is ReadyEntity =>
      typeof e.id === "string" && typeof e.name === "string" && e.name !== "",
  )
  const readyActions = actions
    .filter(
      (a): a is ReadyAction =>
        typeof a.id === "string" && typeof a.label === "string",
    )
    .slice(0, 2)

  const act = (entity: ReadyEntity, action: ReadyAction) => {
    if (streaming || isDone(entity.id, action.id)) return
    setPressed((prev) => new Set(prev).add(key(entity.id, action.id)))
    setMessage(announce[action.id](entity.name))
    onResult?.({ action: action.id, entityId: entity.id })
  }

  const label = title ?? "Results"
  const heading = title ? (
    <SurfaceTitle>{title}</SurfaceTitle>
  ) : streaming && ready.length === 0 ? (
    <Skeleton className="h-4 w-40" />
  ) : null

  const liveRegion = (
    <p className="sr-only" aria-live="polite">
      {message}
    </p>
  )

  if (layout === "list") {
    return (
      <MotionConfig reducedMotion="user">
        <Surface
          data-slot="entity-card"
          data-status={status}
          data-layout="list"
          aria-busy={streaming}
          aria-label={label}
          className={cn("@container", className)}
        >
          {heading && <SurfaceHeader>{heading}</SurfaceHeader>}
          <ul className="flex flex-col divide-y divide-border border-t border-border">
            {ready.map((entity, rowIndex) => {
              const price = formatPrice(entity.price, locale)
              return (
                <motion.li
                  key={entity.id}
                  data-slot="entity-card-item"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={genuiMotion.fade}
                  className="flex gap-3 px-3 py-3"
                >
                  <EntityImage
                    entity={entity}
                    className="size-14 shrink-0 rounded-lg"
                    letterClassName="text-[16px]"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-2 @md:flex-row @md:items-start @md:justify-between @md:gap-4">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <EntityName entity={entity} />
                        {entity.badge && (
                          <Badge variant={badgeVariant(entity.badgeTone)}>
                            {entity.badge}
                          </Badge>
                        )}
                      </div>
                      <Details entity={entity} />
                    </div>
                    {(price || readyActions.length > 0) && (
                      <div className="flex flex-col gap-2 @md:shrink-0 @md:items-end">
                        {price && (
                          <span className="text-[14px] font-medium tabular-nums">
                            {price}
                          </span>
                        )}
                        <Actions
                          entity={entity}
                          actions={readyActions}
                          isDone={isDone}
                          disabled={streaming}
                          onAction={act}
                          quiet={ready.length > 1 && rowIndex > 0}
                          className="[&>button]:flex-1 @md:justify-end @md:[&>button]:flex-none"
                          wrapClassName="flex flex-1 @md:flex-none [&>button]:flex-1 @md:[&>button]:flex-none"
                        />
                      </div>
                    )}
                  </div>
                </motion.li>
              )
            })}
            {streaming && (
              <li aria-hidden className="flex gap-3 px-3 py-3">
                <Skeleton className="size-14 shrink-0 rounded-lg" />
                <div className="flex flex-1 flex-col gap-2 pt-1">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </li>
            )}
          </ul>
          {liveRegion}
        </Surface>
      </MotionConfig>
    )
  }

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="entity-card"
        data-status={status}
        data-layout="carousel"
        aria-busy={streaming}
        aria-label={label}
        className={cn("@container", className)}
      >
        <Carousel heading={heading} label={label} count={ready.length}>
          {ready.map((entity) => {
            const price = formatPrice(entity.price, locale)
            return (
              <motion.li
                key={entity.id}
                data-slot="entity-card-item"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={genuiMotion.fade}
                style={{ width: CARD_WIDTH }}
                className="shrink-0 snap-start"
              >
                <article className="flex h-full flex-col overflow-hidden rounded-[10px] border border-border bg-card">
                  <EntityImage
                    entity={entity}
                    className="aspect-[4/3] w-full"
                    letterClassName="text-[32px]"
                  />
                  <div className="flex flex-1 flex-col gap-1 p-3">
                    <EntityName entity={entity} />
                    <Details entity={entity} stacked />
                    {(price || entity.badge) && (
                      <div className="mt-auto flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-2">
                        {price && (
                          <span className="font-figure text-[24px] font-normal tracking-tight tabular-nums">
                            {price}
                          </span>
                        )}
                        {entity.badge && (
                          <Badge variant={badgeVariant(entity.badgeTone)}>
                            {entity.badge}
                          </Badge>
                        )}
                      </div>
                    )}
                    <Actions
                      entity={entity}
                      actions={readyActions}
                      isDone={isDone}
                      disabled={streaming}
                      onAction={act}
                      wrapClassName="flex flex-1 [&>button]:flex-1"
                      className={cn(
                        "pt-2 [&>button]:flex-1",
                        !price && !entity.badge && "mt-auto",
                      )}
                    />
                  </div>
                </article>
              </motion.li>
            )
          })}
          {streaming && (
            <li
              aria-hidden
              style={{ width: CARD_WIDTH }}
              className="flex shrink-0 flex-col overflow-hidden rounded-[10px] border border-border bg-card"
            >
              <Skeleton className="aspect-[4/3] w-full rounded-none" />
              <div className="flex flex-col gap-2 p-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="mt-2 h-4 w-1/3" />
              </div>
            </li>
          )}
        </Carousel>
        {liveRegion}
      </Surface>
    </MotionConfig>
  )
}

/** Horizontal scroller with snap, touch scrolling and prev/next on desktop. */
function Carousel({
  heading,
  label,
  count,
  children,
}: {
  heading: React.ReactNode
  label: string
  count: number
  children: React.ReactNode
}) {
  const scroller = React.useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()
  const [edges, setEdges] = React.useState({ prev: false, next: false })

  const update = React.useCallback(() => {
    const el = scroller.current
    if (!el) return
    const prev = el.scrollLeft > 4
    const next = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
    setEdges((e) => (e.prev === prev && e.next === next ? e : { prev, next }))
  }, [])

  // Re-measure when items stream in or the container resizes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: count changes the scroll width
  React.useEffect(() => {
    update()
    const el = scroller.current
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [update, count])

  const page = (direction: 1 | -1) => {
    const el = scroller.current
    if (!el) return
    el.scrollBy({
      left: direction * Math.max(CARD_WIDTH, el.clientWidth * 0.8),
      behavior: reducedMotion ? "auto" : "smooth",
    })
  }

  const overflow = edges.prev || edges.next

  return (
    <div className="flex flex-col">
      {(heading || overflow) && (
        <SurfaceHeader className="flex min-h-7 flex-row items-center justify-between gap-2 pb-3">
          {heading ?? <span />}
          {overflow && (
            <div className="hidden shrink-0 gap-1 @sm:flex">
              <WhyDisabled
                reason={!edges.prev ? "Already at the start" : undefined}
              >
                <IconTip label="Previous">
                  <Button
                    size="icon-sm"
                    variant="secondary"
                    aria-label={`Previous items in ${label}`}
                    disabled={!edges.prev}
                    onClick={() => page(-1)}
                  >
                    <ChevronLeftIcon />
                  </Button>
                </IconTip>
              </WhyDisabled>
              <WhyDisabled
                reason={!edges.next ? "Already at the end" : undefined}
              >
                <IconTip label="Next">
                  <Button
                    size="icon-sm"
                    variant="secondary"
                    aria-label={`Next items in ${label}`}
                    disabled={!edges.next}
                    onClick={() => page(1)}
                  >
                    <ChevronRightIcon />
                  </Button>
                </IconTip>
              </WhyDisabled>
            </div>
          )}
        </SurfaceHeader>
      )}
      <div className="relative">
        {/* Focusable so keyboard users can scroll it with the arrow keys. */}
        <section
          ref={scroller}
          aria-label={`${label}, scrollable`}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable regions must be keyboard reachable
          tabIndex={0}
          onScroll={update}
          className="snap-x snap-mandatory scroll-px-3 overflow-x-auto overscroll-x-contain border-t border-border p-3 outline-none [scrollbar-width:thin] focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          <ul className="flex gap-3">{children}</ul>
        </section>
        {/* Edge fades say the list goes on in that direction. */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 top-px left-0 w-14 bg-linear-to-r from-card to-transparent transition-opacity duration-200",
            edges.prev ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 top-px right-0 w-14 bg-linear-to-l from-card to-transparent transition-opacity duration-200",
            edges.next ? "opacity-100" : "opacity-0",
          )}
        />
      </div>
    </div>
  )
}
