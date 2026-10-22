"use client"

import {
  AlertTriangleIcon,
  CircleAlertIcon,
  ClockIcon,
  InboxIcon,
  RefreshCwIcon,
  SquareIcon,
} from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"
import { GenUILocaleProvider } from "@/components/genui/locale"

import {
  type GenUIRefSources,
  hasBinds,
  resolveBinds,
  resolveRefs,
} from "./genui-context"

/**
 * One generated-UI call, normalised from whichever agent framework produced
 * it (see genui-adapters.ts).
 */
export type GenUICall = {
  /** Stable id: the tool call id, or the UI message id. */
  id: string
  /** Catalog key, usually the tool name, e.g. "propose_changes". */
  name: string
  /** The component props the agent generated. May be partial while streaming. */
  props: Record<string, unknown>
  /**
   * "streaming" while the agent is still generating props; "failed" when the
   * tool call errored (set `error`); "cancelled" when the user stopped the
   * reply before this call finished (see `markCancelled`).
   */
  status: "streaming" | "ready" | "failed" | "cancelled"
  /** A stored result, when the user already acted (restores the final state). */
  result?: unknown
  /** Failed calls: what went wrong, in words the user can act on. */
  error?: string
  /** When the data behind the props was fetched (ISO or epoch ms). */
  fetchedAt?: string | number
  /** After this long, the data is shown as stale (with `fetchedAt`). */
  staleAfterMs?: number
  /** After this moment the offer no longer holds: actions turn off. */
  expiresAt?: string | number
  /** Id of a newer call that replaces this one (see `markSuperseded`). */
  supersededBy?: string
  /**
   * The tool returned nothing to show: say why in words ("No invoices this
   * month"). Rendered as an empty state instead of the component.
   */
  empty?: string
  /**
   * Some of the data is missing ("2 of 12 sites didn't respond"). Shown as a
   * notice above the component, which stays usable.
   */
  partial?: string
}

/**
 * The lifecycle state a call is shown in. Finished calls (with a `result`)
 * stay a plain record: expiry and replacement only matter before the user acts.
 */
export type GenUICallState =
  | "streaming"
  | "ready"
  | "failed"
  | "cancelled"
  | "empty"
  | "partial"
  | "stale"
  | "expired"
  | "superseded"

const toMs = (v: string | number | undefined) =>
  v === undefined ? Number.NaN : typeof v === "number" ? v : Date.parse(v)

/** Resolves a call's state. `now` is null before mount (no time-based states). */
export function resolveCallState(
  call: GenUICall,
  now: number | null,
): GenUICallState {
  if (call.status === "failed") return "failed"
  if (call.status === "cancelled") return "cancelled"
  if (call.status === "streaming") return "streaming"
  if (call.result !== undefined) return "ready"
  if (call.supersededBy) return "superseded"
  if (call.empty) return "empty"
  if (now !== null) {
    const expires = toMs(call.expiresAt)
    if (!Number.isNaN(expires) && now >= expires) return "expired"
    const fetched = toMs(call.fetchedAt)
    if (
      call.staleAfterMs !== undefined &&
      !Number.isNaN(fetched) &&
      now - fetched >= call.staleAfterMs
    )
      return "stale"
  }
  if (call.partial) return "partial"
  return "ready"
}

/**
 * Marks earlier calls as superseded when a later ready call has the same key
 * (by default the tool name). Opt in per tool with `names`, e.g. only for
 * booking offers, so two different tables in one reply don't replace each other.
 */
export function markSuperseded(
  calls: GenUICall[],
  {
    names,
    key = (c) => c.name,
  }: { names?: string[]; key?: (call: GenUICall) => string } = {},
): GenUICall[] {
  const latest = new Map<string, string>()
  for (const c of calls) {
    if (c.status !== "ready") continue
    if (names && !names.includes(c.name)) continue
    latest.set(key(c), c.id)
  }
  return calls.map((c) => {
    if (names && !names.includes(c.name)) return c
    const newest = latest.get(key(c))
    return newest && newest !== c.id && c.result === undefined
      ? { ...c, supersededBy: newest }
      : c
  })
}

/**
 * After the user stops a reply, marks every call that was still streaming as
 * cancelled, so it shows "Stopped" instead of a half-drawn component that
 * never finishes. Finished calls are left as they are.
 */
export function markCancelled(calls: GenUICall[]): GenUICall[] {
  return calls.map((c) =>
    c.status === "streaming" ? { ...c, status: "cancelled" as const } : c,
  )
}

/** A minute-resolution clock, started after mount so SSR stays deterministic. */
function useNow(enabled: boolean) {
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [enabled])
  return now
}

function ago(ms: number) {
  const min = Math.round(ms / 60_000)
  if (min < 1) return "just now"
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"} ago`
  const d = Math.round(h / 24)
  return `${d} ${d === 1 ? "day" : "days"} ago`
}

/**
 * Maps call names to components. Components take different props, so the
 * catalog is deliberately loosely typed; each component validates its own.
 */
// biome-ignore lint/suspicious/noExplicitAny: heterogeneous component map
export type GenUICatalog = Record<string, React.ComponentType<any>>

/**
 * A component nested inside a layout (tabs, columns, stack, grid, split,
 * steps): catalog name + props. `id` lets siblings bind to its result.
 */
export type GenUIChild = {
  component: string
  /** An object, or the same as a JSON string (strict tool schemas can't hold an open object). */
  props?: Record<string, unknown> | string
  id?: string
}

function childProps(props: GenUIChild["props"]): Record<string, unknown> {
  if (typeof props !== "string") return props ?? {}
  try {
    const parsed: unknown = JSON.parse(props)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** How deep layouts nest: a layout inside a layout, and no further. */
export const GENUI_MAX_LAYOUT_DEPTH = 2

/** Passed to layout components so they can render their children. */
export type GenUIRenderChild = (
  child: GenUIChild,
  key: string,
) => React.ReactNode

/**
 * A layout's result. A layout is one tool call, so when it contains an
 * interactive child, that child's result becomes the layout's result.
 */
export type GenUILayoutResult = { child: string; result: unknown }

/**
 * Layout components set `genuiLayout = true` to receive `renderChild`.
 * Components that report an unconfirmed selection set `genuiDraft = true` to
 * receive `onDraft`; others never get the prop.
 */
type MaybeLayout = { genuiLayout?: boolean; genuiDraft?: boolean }

function isLayoutResult(v: unknown): v is GenUILayoutResult {
  return typeof v === "object" && v !== null && "child" in v && "result" in v
}

type RendererProps = {
  call: GenUICall
  catalog: GenUICatalog
  /** Send the user's decision back to the agent, keyed by the call. */
  onResult?: (call: GenUICall, result: unknown) => void
  /**
   * The user's unconfirmed selection, keyed by the call: what the result
   * would be if they confirmed now. Keep the latest per call and add it to
   * the next typed message with `describeUIState`; never reply to it on its
   * own, and drop it when the call's result comes. Inside a layout it comes
   * wrapped like a result, `{ child, result }`.
   */
  onDraft?: (call: GenUICall, draft: unknown) => void
  /** Rendered for names the catalog doesn't know. Defaults to a short notice. */
  fallback?: React.ReactNode
  /** Failed calls: ask the agent to try again. Shows a Retry button. */
  onRetry?: (call: GenUICall) => void
  /** Stale, expired or failed calls: ask the agent for fresh data. */
  onRefresh?: (call: GenUICall) => void
  /**
   * Tool results the model may point into with `{ $ref }` (see
   * genui-context.ts). Refs are filled in before the component renders.
   */
  refs?: GenUIRefSources
  /**
   * BCP 47 locale every component formats numbers, money and dates with,
   * e.g. the user's setting or the request's Accept-Language. Defaults to
   * en-US, the same on the server and in the browser.
   */
  locale?: string
}

/**
 * Renders one call in its lifecycle state, in the host's locale when one is
 * given (an outer GenUILocaleProvider applies otherwise).
 */
export function GenUIRenderer(props: RendererProps) {
  if (props.locale === undefined) return <RendererBody {...props} />
  return (
    <GenUILocaleProvider locale={props.locale}>
      <RendererBody {...props} />
    </GenUILocaleProvider>
  )
}

/**
 * Renders one call in its lifecycle state. Ready and streaming calls render
 * the component as is; failed, stale, expired and superseded calls get a
 * shared notice, and expired or superseded ones turn inert (still readable,
 * no longer actionable), so an old offer left in the conversation can't be
 * acted on by mistake.
 */
function RendererBody(props: RendererProps) {
  const { call, onRetry, onRefresh } = props
  const timed =
    call.status === "ready" &&
    call.result === undefined &&
    (call.expiresAt !== undefined || call.fetchedAt !== undefined)
  const now = useNow(timed)
  const state = resolveCallState(call, now)

  if (state === "failed") {
    return (
      <div
        data-genui=""
        data-genui-state="failed"
        id={`genui-${call.id}`}
        role="alert"
        className="flex flex-col gap-3 rounded-[14px] border border-border bg-card px-3 py-3 text-sm sm:flex-row sm:items-center"
      >
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <AlertTriangleIcon
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-destructive"
          />
          <div className="min-w-0">
            <p className="font-medium">
              This part of the answer couldn&apos;t load
            </p>
            {call.error && (
              <p className="text-muted-foreground">{call.error}</p>
            )}
          </div>
        </div>
        {(onRetry || onRefresh) && (
          <NoticeButton onClick={() => (onRetry ?? onRefresh)?.(call)}>
            Try again
          </NoticeButton>
        )}
      </div>
    )
  }

  if (state === "cancelled") {
    return (
      <div
        data-genui=""
        data-genui-state="cancelled"
        id={`genui-${call.id}`}
        role="status"
        className="flex flex-col gap-3 rounded-[14px] border border-border bg-card px-3 py-3 text-sm sm:flex-row sm:items-center"
      >
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <SquareIcon
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          />
          <div className="min-w-0">
            <p className="font-medium">Stopped before it finished</p>
            <p className="text-muted-foreground">
              Nothing from this part was used.
            </p>
          </div>
        </div>
        {(onRetry || onRefresh) && (
          <NoticeButton onClick={() => (onRetry ?? onRefresh)?.(call)}>
            Try again
          </NoticeButton>
        )}
      </div>
    )
  }

  if (state === "empty") {
    return (
      <div
        data-genui=""
        data-genui-state="empty"
        id={`genui-${call.id}`}
        role="status"
        className="flex flex-col gap-3 rounded-[14px] border border-border bg-card px-3 py-3 text-sm sm:flex-row sm:items-center"
      >
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <InboxIcon
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          />
          <p className="min-w-0">{call.empty}</p>
        </div>
        {onRefresh && (
          <NoticeButton onClick={() => onRefresh(call)}>
            Check again
          </NoticeButton>
        )}
      </div>
    )
  }

  const body = <RenderCall {...props} />
  if (state === "ready" || state === "streaming") {
    return (
      <div data-genui="" data-genui-state={state} id={`genui-${call.id}`}>
        {body}
      </div>
    )
  }

  const inert = state === "expired" || state === "superseded"
  const fetched = toMs(call.fetchedAt)
  const expires = toMs(call.expiresAt)
  const message =
    state === "partial"
      ? (call.partial ?? "Some of the data is missing.")
      : state === "stale"
        ? `Data from ${now !== null && !Number.isNaN(fetched) ? ago(now - fetched) : "a while ago"}. It may have changed.`
        : state === "expired"
          ? `This expired ${now !== null && !Number.isNaN(expires) ? ago(now - expires) : ""}. Ask for an update before acting on it.`
          : "Replaced by a newer version below."

  return (
    <div
      data-genui=""
      data-genui-state={state}
      id={`genui-${call.id}`}
      className="flex flex-col gap-2"
    >
      <div
        role="status"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground"
      >
        <span className="inline-flex items-center gap-1.5">
          {state === "partial" ? (
            <CircleAlertIcon aria-hidden className="size-3.5" />
          ) : (
            <ClockIcon aria-hidden className="size-3.5" />
          )}
          {message}
        </span>
        {state === "superseded" && call.supersededBy ? (
          <a
            href={`#genui-${call.supersededBy}`}
            className="font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Go to the latest
          </a>
        ) : (
          onRefresh && (
            <NoticeButton onClick={() => onRefresh(call)}>Refresh</NoticeButton>
          )
        )}
      </div>
      <div
        inert={inert}
        className={cn(
          inert &&
            "opacity-60 transition-opacity motion-reduce:transition-none",
        )}
      >
        {body}
      </div>
    </div>
  )
}

function NoticeButton({
  className,
  children,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-9 items-center gap-1.5 self-start rounded-full bg-secondary px-3.5 text-sm font-medium text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 sm:self-auto",
        className,
      )}
      {...props}
    >
      <RefreshCwIcon aria-hidden className="size-3.5" />
      {children}
    </button>
  )
}

function RenderCall({
  call: rawCall,
  catalog,
  onResult,
  onDraft,
  fallback,
  refs,
}: RendererProps) {
  const call = React.useMemo(
    () =>
      refs
        ? { ...rawCall, props: resolveRefs(rawCall.props, refs).value }
        : rawCall,
    [rawCall, refs],
  )
  return (
    <RenderNode
      id={call.id}
      name={call.name}
      props={call.props}
      status={call.status}
      result={call.result}
      depth={0}
      catalog={catalog}
      fallback={fallback}
      onResult={(result) => onResult?.(call, result)}
      onDraft={onDraft && ((draft) => onDraft(call, draft))}
    />
  )
}

type NodeProps = {
  id: string
  name: string
  props: Record<string, unknown>
  status: GenUICall["status"]
  result: unknown
  /** 0 for the call itself, 1 for a layout's child, 2 for a grandchild. */
  depth: number
  catalog: GenUICatalog
  fallback?: React.ReactNode
  onResult?: (result: unknown) => void
  onDraft?: (draft: unknown) => void
}

/**
 * One component in the tree: the call itself, or a child of a layout. Layouts
 * render their children through the same catalog, and keep each child's
 * latest result so siblings can bind to it (see genui-context.ts).
 */
function RenderNode({
  id,
  name,
  props,
  status,
  result,
  depth,
  catalog,
  fallback,
  onResult,
  onDraft,
}: NodeProps) {
  const Component = catalog[name]
  const isLayout = (Component as MaybeLayout | undefined)?.genuiLayout === true
  const takesDraft =
    !isLayout && (Component as MaybeLayout | undefined)?.genuiDraft === true

  // Latest result per child, by key; keys map to ids as children render.
  const [childResults, setChildResults] = React.useState<
    Record<string, unknown>
  >(() =>
    isLayoutResult(result) ? { [result.child]: result.result } : {},
  )
  const keyToId = React.useRef(new Map<string, string>())

  if (!Component) {
    // Say so, rather than silently dropping part of the agent's response.
    return (
      fallback ?? (
        <p data-genui="" className="text-sm text-muted-foreground">
          This response included an interface this app can&apos;t show (
          <code className="font-mono text-xs">{name}</code>).
        </p>
      )
    )
  }

  if (isLayout && depth >= GENUI_MAX_LAYOUT_DEPTH) {
    return (
      <p data-genui="" className="text-sm text-muted-foreground">
        This response nested layouts too deeply (
        <code className="font-mono text-xs">{name}</code>).
      </p>
    )
  }

  const renderChild: GenUIRenderChild = (child, key) => {
    const childId = child.id ?? key
    keyToId.current.set(key, childId)
    let props = childProps(child.props)
    if (hasBinds(props)) {
      const sources: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(childResults)) {
        sources[keyToId.current.get(k) ?? k] = v
      }
      props = resolveBinds(props, sources).value
    }
    const restored =
      isLayoutResult(result) && result.child === key
        ? result.result
        : undefined
    return (
      <RenderNode
        key={key}
        id={`${id}/${key}`}
        name={child.component}
        props={props}
        status={status}
        result={restored}
        depth={depth + 1}
        catalog={catalog}
        fallback={fallback}
        onResult={(childResult) => {
          setChildResults((prev) => ({ ...prev, [key]: childResult }))
          onResult?.({ child: key, result: childResult } satisfies GenUILayoutResult)
        }}
        onDraft={
          onDraft &&
          ((draft) =>
            onDraft({ child: key, result: draft } satisfies GenUILayoutResult))
        }
      />
    )
  }

  return (
    <Component
      {...props}
      // When ready, components track the user's decision themselves.
      status={status === "streaming" ? "streaming" : undefined}
      result={isLayout ? undefined : result}
      onResult={onResult}
      {...(takesDraft && onDraft ? { onDraft } : {})}
      {...(isLayout ? { renderChild, childResults } : {})}
    />
  )
}

/**
 * Stacks a response: text and components 12px apart, components 24px apart.
 * Put text and <GenUIRenderer>s directly inside it, in the agent's order.
 */
export function GenUIStack({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 [&>[data-genui]+[data-genui]]:mt-3",
        className,
      )}
      {...props}
    />
  )
}
