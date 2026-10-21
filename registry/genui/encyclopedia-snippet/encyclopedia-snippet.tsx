"use client"

import * as React from "react"
import {
  ArrowUpRightIcon,
  AwardIcon,
  BookOpenIcon,
  BuildingIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  CoinsIcon,
  CopyIcon,
  FlagIcon,
  GlobeIcon,
  LanguagesIcon,
  LightbulbIcon,
  type LucideIcon,
  MapPinIcon,
  MountainIcon,
  RulerIcon,
  ThermometerIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import {
  genuiType,
  Skeleton,
  Surface,
  SurfaceDescription,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiMotion,
  genuiHit,
} from "@/components/genui/surface"

import {
  copyText,
  type InlineNode,
  parseInline,
  safeHttpUrl,
  safeImageSrc,
  sourceName,
  splitParagraphs,
} from "./encyclopedia-snippet-utils"
import type {
  EncyclopediaFact,
  EncyclopediaIcon,
  EncyclopediaImage,
  EncyclopediaKind,
  EncyclopediaSection,
  EncyclopediaSnippetInput,
  EncyclopediaSnippetResult,
  EncyclopediaSource,
} from "./encyclopedia-snippet.schema"
import { WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"

const ICONS: Record<EncyclopediaIcon, LucideIcon> = {
  calendar: CalendarIcon,
  clock: ClockIcon,
  "map-pin": MapPinIcon,
  globe: GlobeIcon,
  flag: FlagIcon,
  users: UsersIcon,
  user: UserIcon,
  building: BuildingIcon,
  ruler: RulerIcon,
  mountain: MountainIcon,
  thermometer: ThermometerIcon,
  coins: CoinsIcon,
  book: BookOpenIcon,
  languages: LanguagesIcon,
  award: AwardIcon,
  lightbulb: LightbulbIcon,
}

/** Title icon per kind: a tinted box, tone by meaning of the kind. */
const KINDS: Record<EncyclopediaKind, { icon: LucideIcon; tone: string }> = {
  person: {
    icon: UserIcon,
    tone: "bg-sky-500/15 text-sky-600 dark:bg-sky-400/15 dark:text-sky-400",
  },
  place: {
    icon: MapPinIcon,
    tone: "bg-emerald-500/15 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-400",
  },
  concept: {
    icon: LightbulbIcon,
    tone: "bg-orange-500/15 text-orange-600 dark:bg-orange-400/15 dark:text-orange-400",
  },
  organization: {
    icon: BuildingIcon,
    tone: "bg-rose-500/15 text-rose-600 dark:bg-rose-400/15 dark:text-rose-400",
  },
  event: {
    icon: CalendarIcon,
    tone: "bg-teal-500/15 text-teal-600 dark:bg-teal-400/15 dark:text-teal-400",
  },
}

export type EncyclopediaSnippetStatus = "streaming" | "ready"

export type EncyclopediaSnippetProps = Partial<
  Omit<
    EncyclopediaSnippetInput,
    "image" | "facts" | "sections" | "source" | "related"
  >
> & {
  /** Nested fields may be partial while the tool call streams. */
  image?: Partial<EncyclopediaImage>
  facts?: Partial<EncyclopediaFact>[]
  sections?: Partial<EncyclopediaSection>[]
  source?: Partial<EncyclopediaSource>
  related?: (string | undefined)[]
  /** Lifecycle, controlled by the host. */
  status?: EncyclopediaSnippetStatus
  /**
   * Called when the user taps a related topic (`explore`) or opens the full
   * article (`open`). The snippet never locks.
   */
  onResult?: (result: EncyclopediaSnippetResult) => void
  /**
   * Topics already explored (from history). Those chips render as asked and
   * aren't sent again; everything else stays usable.
   */
  result?: EncyclopediaSnippetResult | EncyclopediaSnippetResult[]
  className?: string
}

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
const newTab = {
  target: "_blank",
  rel: "noopener noreferrer nofollow",
} as const
const appear = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: genuiMotion.fade,
} as const

/** Pairs items with positional keys: content only ever appends while streaming. */
function keyed<T>(items: T[], prefix: string) {
  return items.map((value, i) => ({ value, key: `${prefix}${i}` }))
}

function useCopied() {
  const [copied, setCopied] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  React.useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  return [copied, copy] as const
}

function Inline({ nodes }: { nodes: InlineNode[] }) {
  return keyed(nodes, "i").map(({ value: n, key }) => {
    switch (n.type) {
      case "text":
        return <React.Fragment key={key}>{n.value}</React.Fragment>
      case "strong":
        return (
          <strong key={key} className="font-semibold">
            <Inline nodes={n.children} />
          </strong>
        )
      case "em":
        return (
          <em key={key}>
            <Inline nodes={n.children} />
          </em>
        )
      case "code":
        return (
          <code
            key={key}
            className="rounded border border-border bg-transparent px-1 py-0.5 font-mono text-[13px]"
          >
            {n.value}
          </code>
        )
      case "link":
        return (
          <a
            key={key}
            href={n.href}
            {...newTab}
            className={cn(
              "rounded-sm underline decoration-foreground/30 underline-offset-2 transition-colors hover:decoration-foreground",
              focusRing,
            )}
          >
            <Inline nodes={n.children} />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )
      default:
        // A reference in the source article. The list lives there, so the
        // marker is shown as is, not as a link.
        return (
          <sup
            key={key}
            title="Reference in the full article"
            className="ml-px text-[13px] text-muted-foreground tabular-nums"
          >
            [{n.refs.join(",")}]
          </sup>
        )
    }
  })
}

function Picture({
  image,
  src,
}: {
  image: Partial<EncyclopediaImage>
  src: string
}) {
  const [failed, setFailed] = React.useState<string | null>(null)
  if (failed === src) return null
  const caption = [image.caption, image.credit && `Image: ${image.credit}`]
    .filter(Boolean)
    .join(" · ")
  return (
    <motion.figure {...appear} className="flex flex-col gap-1.5">
      {/* biome-ignore lint/performance/noImgElement: agent-provided remote URLs; next/image would need every host configured */}
      <img
        src={src}
        alt={image.alt ?? ""}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(src)}
        className="aspect-[16/10] w-full rounded-[10px] bg-muted object-cover"
      />
      {caption && <figcaption className={genuiType.meta}>{caption}</figcaption>}
    </motion.figure>
  )
}

export function EncyclopediaSnippet({
  title,
  kind,
  subtitle,
  summary,
  image,
  facts = [],
  sections = [],
  source,
  related = [],
  language,
  status: statusProp,
  onResult,
  result,
  className,
}: EncyclopediaSnippetProps) {
  const locale = useGenUILocale()
  const status: EncyclopediaSnippetStatus = statusProp ?? "ready"
  const streaming = status === "streaming"
  const titleId = React.useId()
  const [copied, copy] = useCopied()

  // Asked = restored from history, plus what the user tapped here.
  const [asked, setAsked] = React.useState<Set<string>>(() => new Set())
  const [message, setMessage] = React.useState("")
  const restored = React.useMemo(() => {
    const list = result === undefined ? [] : [result].flat()
    return new Set(
      list.flatMap((r) => (r.action === "explore" ? [r.topic] : [])),
    )
  }, [result])
  const isAsked = (topic: string) => restored.has(topic) || asked.has(topic)

  const paragraphs = splitParagraphs(summary)
  const imageSrc = safeImageSrc(image?.src)
  const readyFacts = facts.filter(
    (f): f is EncyclopediaFact =>
      typeof f?.label === "string" &&
      typeof f.value === "string" &&
      f.value !== "",
  )
  const readySections = sections.filter(
    (s): s is EncyclopediaSection => typeof s?.title === "string" && !!s.title,
  )
  const topics = [
    ...new Set(
      related.filter((t): t is string => typeof t === "string" && !!t.trim()),
    ),
  ]
  const articleUrl = safeHttpUrl(source?.url)
  const hasSource = typeof source?.name === "string" || !!articleUrl
  const license = source?.license?.trim()
  const hasAside = !!imageSrc || readyFacts.length > 0
  const kindInfo = kind ? KINDS[kind] : undefined

  const explore = (topic: string) => {
    if (streaming || isAsked(topic)) return
    setAsked((prev) => new Set(prev).add(topic))
    setMessage(`Asked about ${topic}`)
    onResult?.({ action: "explore", topic })
  }

  const onCopy = () => {
    copy(copyText({ title, summary, source }, locale))
  }

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="encyclopedia-snippet"
        data-status={status}
        aria-busy={streaming}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Encyclopedia summary"}
        className={className}
      >
        <SurfaceHeader
          className={cn("pb-3", kindInfo && "flex-row items-center gap-3")}
        >
          {kindInfo && (
            <span
              aria-hidden
              className={cn(
                "inline-flex size-10 shrink-0 items-center justify-center rounded-[10px]",
                kindInfo.tone,
              )}
            >
              <kindInfo.icon className="size-5" />
            </span>
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <SurfaceTitle id={titleId} lang={language}>
              {title}
            </SurfaceTitle>
            {subtitle && (
              <SurfaceDescription lang={language}>
                {subtitle}
              </SurfaceDescription>
            )}
          </div>
        </SurfaceHeader>

        <div className="@container">
          <div
            className={cn(
              "grid gap-5 border-t border-border px-3 py-3",
              hasAside &&
                "@xl:grid-cols-[minmax(0,1fr)_15rem] @xl:grid-rows-[auto_1fr] @xl:gap-x-0 @xl:gap-y-5 @xl:px-0 @xl:py-0",
            )}
          >
            {/* Summary */}
            <div
              lang={language}
              className={cn(
                genuiType.body,
                "flex flex-col gap-3 leading-relaxed text-pretty @xl:col-start-1 @xl:row-start-1",
                hasAside && "@xl:pt-3 @xl:pr-6 @xl:pl-3",
              )}
            >
              {keyed(paragraphs, "p").map(({ value, key }, i) => (
                <motion.p key={key} {...appear}>
                  <Inline
                    nodes={parseInline(value, {
                      partial: streaming && i === paragraphs.length - 1,
                    })}
                  />
                </motion.p>
              ))}
              {streaming && (
                <div aria-hidden className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-11/12" />
                  {paragraphs.length === 0 && (
                    <Skeleton className="h-4 w-2/3" />
                  )}
                </div>
              )}
            </div>

            {/* Infobox: the image on top, then the facts. */}
            {hasAside && (
              <aside
                aria-label={title ? `${title}: key facts` : "Key facts"}
                className="flex flex-col gap-3 @xl:col-start-2 @xl:row-span-2 @xl:row-start-1 @xl:border-l @xl:border-border @xl:px-3 @xl:py-3"
              >
                {imageSrc && image && <Picture image={image} src={imageSrc} />}
                {readyFacts.length > 0 && (
                  <dl lang={language} className="flex flex-col gap-3">
                    {keyed(readyFacts, "f").map(({ value: f, key }) => (
                      <motion.div
                        key={key}
                        {...appear}
                        className="flex flex-col gap-0.5"
                      >
                        <dt
                          className={cn(
                            genuiType.label,
                            "flex items-center gap-1.5",
                          )}
                        >
                          {f.icon && ICONS[f.icon] && (
                            <FactIcon name={f.icon} />
                          )}
                          {f.label}
                        </dt>
                        <dd
                          className={cn(
                            genuiType.body,
                            "font-medium break-words",
                          )}
                        >
                          {f.value}
                        </dd>
                      </motion.div>
                    ))}
                  </dl>
                )}
              </aside>
            )}

            {/* Read more + related topics */}
            {(readySections.length > 0 || topics.length > 0) && (
              <div
                className={cn(
                  "flex flex-wrap items-center gap-x-5 gap-y-3 @xl:col-start-1 @xl:row-start-2",
                  hasAside && "@xl:pr-6 @xl:pb-3 @xl:pl-3",
                )}
              >
                {readySections.length > 0 && (
                  <nav aria-label="Sections of the full article">
                    <ul
                      lang={language}
                      className="flex flex-wrap gap-x-4 gap-y-1"
                    >
                      {keyed(readySections, "s").map(({ value: s, key }) => {
                        const href = safeHttpUrl(s.url)
                        return (
                          <motion.li key={key} {...appear}>
                            {href ? (
                              <a
                                href={href}
                                {...newTab}
                                className={cn(
                                  genuiType.body,
                                  "inline-flex min-h-7 items-center gap-1 rounded-sm underline decoration-foreground/30 underline-offset-2 transition-colors hover:decoration-foreground",
                                  focusRing,
                                )}
                              >
                                {s.title}
                                <ArrowUpRightIcon
                                  aria-hidden
                                  className="size-3.5"
                                />
                                <span className="sr-only">
                                  (section of the full article, opens in a new
                                  tab)
                                </span>
                              </a>
                            ) : (
                              <span
                                className={cn(
                                  genuiType.body,
                                  "inline-flex min-h-7 items-center text-muted-foreground",
                                )}
                              >
                                {s.title}
                              </span>
                            )}
                          </motion.li>
                        )
                      })}
                    </ul>
                  </nav>
                )}

                {topics.length > 0 && (
                  <section
                    aria-labelledby={`${titleId}-related`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1"
                  >
                    <h4 id={`${titleId}-related`} className={genuiType.label}>
                      Related
                    </h4>
                    <ul className="flex flex-wrap gap-x-4 gap-y-1">
                      {topics.map((topic) => {
                        const done = isAsked(topic)
                        return (
                          <motion.li key={topic} {...appear}>
                            <WhyDisabled
                              reason={!streaming && done && "Already asked"}
                            >
                              <button
                                type="button"
                                lang={language}
                                disabled={streaming || done}
                                aria-label={
                                  done
                                    ? `Asked about ${topic}`
                                    : `Ask about ${topic}`
                                }
                                onClick={() => explore(topic)}
                                className={cn(
                                  genuiType.body,
                                  "relative", genuiHit, "inline-flex min-h-7 items-center gap-1.5 rounded-sm underline decoration-foreground/30 underline-offset-2 transition-colors hover:decoration-foreground disabled:pointer-events-none disabled:text-muted-foreground disabled:no-underline",
                                  focusRing,
                                )}
                              >
                                {done && (
                                  <CheckIcon aria-hidden className="size-3.5" />
                                )}
                                {topic}
                              </button>
                            </WhyDisabled>
                          </motion.li>
                        )
                      })}
                    </ul>
                  </section>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Attribution is always visible. */}
        <SurfaceFooter className="flex-nowrap justify-between gap-3">
          <p
            className={cn(genuiType.meta, "flex min-w-0 items-center gap-1.5")}
          >
            <BookOpenIcon aria-hidden className="size-3.5 shrink-0" />
            <span className="min-w-0">
              {hasSource ? (
                <>
                  From{" "}
                  {articleUrl ? (
                    <a
                      href={articleUrl}
                      {...newTab}
                      onClick={() => onResult?.({ action: "open" })}
                      className={cn(
                        "rounded-sm underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground",
                        focusRing,
                      )}
                    >
                      {sourceName(source)}
                      <span className="sr-only">
                        {" "}
                        (full article, opens in a new tab)
                      </span>
                    </a>
                  ) : (
                    sourceName(source)
                  )}
                  {license && (
                    <>
                      <span aria-hidden> · </span>
                      {license}
                    </>
                  )}
                </>
              ) : streaming ? (
                <ShimmeringText
                  text="Looking it up…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                />
              ) : (
                "Source not provided"
              )}
            </span>
          </p>
          <WhyDisabled
            reason={
              !streaming && paragraphs.length === 0 && "Nothing to copy yet"
            }
          >
            <Button
              size="sm"
              disabled={streaming || paragraphs.length === 0}
              onClick={onCopy}
              className="shrink-0"
            >
              {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
              {copied ? "Copied" : "Copy"}
              <span className="sr-only"> summary with attribution</span>
            </Button>
          </WhyDisabled>
          <span className="sr-only" aria-live="polite">
            {copied ? "Copied" : message}
          </span>
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}

function FactIcon({ name }: { name: EncyclopediaIcon }) {
  const Icon = ICONS[name]
  return <Icon aria-hidden className="size-3.5 shrink-0" />
}
