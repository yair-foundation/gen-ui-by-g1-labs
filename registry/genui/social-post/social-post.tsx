"use client"

import * as React from "react"
import {
  AlertTriangleIcon,
  AtSignIcon,
  BadgeCheckIcon,
  BriefcaseIcon,
  CameraIcon,
  CheckIcon,
  ExternalLinkIcon,
  EyeIcon,
  GlobeIcon,
  HeartIcon,
  ImageOffIcon,
  MessageCircleIcon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
  Repeat2Icon,
  RotateCcwIcon,
  ScissorsIcon,
  Trash2Icon,
  UsersIcon,
  VideoIcon,
  XIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@/components/animate-ui/components/base/tabs"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/genui/date-picker"
import { Textarea } from "@/components/ui/textarea"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
  genuiHit,
} from "@/components/genui/surface"

import {
  altTextIssue,
  composePost,
  countChars,
  counterText,
  formatCompact,
  formatFull,
  formatFullDate,
  formatRelativeTime,
  formatScheduleTime,
  formatWeekdayTime,
  fromZonedInputValue,
  isPast,
  joinNames,
  overBy,
  plural,
  safeHttpUrl,
  safeImageSrc,
  sameInstant,
  splitIntoThread,
  toZonedInputValue,
  tokenize,
  validTimeZone,
  zoneShortName,
} from "./social-post-utils"
import type {
  SocialAccount,
  SocialAuthor,
  SocialBestTime,
  SocialDraft,
  SocialFoundPost,
  SocialMedia,
  SocialNetwork,
  SocialPostInput,
  SocialPostResult,
  SocialVariant,
} from "./social-post.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"
import { ScrollFade } from "@/components/genui/scroll-fade"
import { Segmented } from "@/components/genui/segmented"
import { RollingDigits } from "@/components/genui/genui-motion"

/** Explains a disabled button. Disabled controls swallow pointer events, so the span takes the hover. */
export type SocialPostStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "approved"
  | "revised"
  | "discarded"

type PartialMedia = Partial<SocialMedia>

type PartialFoundPost = Partial<Omit<SocialFoundPost, "author" | "media">> & {
  author?: Partial<SocialAuthor>
  media?: PartialMedia[]
}

type PartialVariant = Partial<Omit<SocialVariant, "media">> & {
  media?: PartialMedia[]
}

type PartialDraft = Partial<Omit<SocialDraft, "variants">> & {
  variants?: PartialVariant[]
}

export type SocialPostProps = Partial<
  Omit<
    SocialPostInput,
    "networks" | "account" | "posts" | "draft" | "bestTimes"
  >
> & {
  /** Everything below may be partial while the tool call streams. */
  networks?: Partial<SocialNetwork>[]
  account?: Partial<SocialAccount>
  posts?: PartialFoundPost[]
  draft?: PartialDraft
  bestTimes?: Partial<SocialBestTime>[]
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props; 'submitting' while the host publishes or schedules.
   * When omitted, the component tracks the user's decision itself.
   */
  status?: SocialPostStatus
  /**
   * Called once with the user's decision about a draft. Never called in
   * 'posts' mode. The component never publishes anything itself.
   */
  onResult?: (result: SocialPostResult) => void
  /**
   * A decision from history. Renders the finished state read-only (the
   * approved posts and time, the feedback, or the discarded note) and never
   * calls onResult.
   */
  result?: SocialPostResult
  className?: string
}

type Network = Partial<SocialNetwork> & { id: string; name: string }
type MediaItem = SocialMedia & { key: string }
type VariantEdit = { posts?: string[]; media?: MediaItem[] }
type ReadyVariant = PartialVariant & { networkId: string; text: string }
type ReadyPost = PartialFoundPost & {
  id: string
  text: string
  author: Partial<SocialAuthor> & { name: string }
}

const decisionFor = {
  approve: "approved",
  revise: "revised",
  discard: "discarded",
} as const

const networkIcons = {
  short: AtSignIcon,
  professional: BriefcaseIcon,
  photo: CameraIcon,
  video: VideoIcon,
  community: UsersIcon,
  other: GlobeIcon,
}

const sentimentLabel = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
} as const

const linkClass =
  "rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"

const enter = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: genuiMotion.fade,
} as const

/** The current time, null until mounted so server and client markup match. */
function useNow() {
  const [now, setNow] = React.useState<Date | null>(null)
  React.useEffect(() => {
    setNow(new Date())
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

const withKeys = (media: PartialMedia[] | undefined): MediaItem[] =>
  (media ?? [])
    .filter(
      (m): m is PartialMedia & { src: string } => typeof m.src === "string",
    )
    .map((m, i) => ({ src: m.src, alt: m.alt ?? "", key: `m${i}` }))

const stripKeys = (media: MediaItem[]): SocialMedia[] =>
  media.map(({ src, alt }) => ({ src, alt }))

// ---- Shared pieces -------------------------------------------------------

function NetworkLabel({ network }: { network: Network }) {
  const Icon = networkIcons[network.kind ?? "other"] ?? GlobeIcon
  return (
    <span className={cn(genuiType.meta, "inline-flex items-center gap-1")}>
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {network.name}
    </span>
  )
}

/** Post text with styled #hashtags and @mentions; only http(s) URLs link. */
function PostText({ text, className }: { text: string; className?: string }) {
  return (
    <p className={cn("text-[13px] whitespace-pre-wrap break-words", className)}>
      {tokenize(text).map((t, i) =>
        t.type === "link" ? (
          <a
            // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional
            key={i}
            href={t.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={cn(linkClass, "break-all")}
          >
            {t.text}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : t.type === "hashtag" || t.type === "mention" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional
          <span key={i} className="font-medium">
            {t.text}
          </span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional
          <React.Fragment key={i}>{t.text}</React.Fragment>
        ),
      )}
    </p>
  )
}

function SafeImage({
  src,
  alt,
  className,
}: {
  src: string | undefined
  alt: string
  className?: string
}) {
  const safe = safeImageSrc(src)
  if (!safe) {
    return (
      <span
        role="img"
        aria-label={alt ? `Image not shown: ${alt}` : "Image not shown"}
        className={cn(
          "flex items-center justify-center rounded-lg border border-border bg-transparent text-muted-foreground",
          className,
        )}
      >
        <ImageOffIcon aria-hidden className="size-4" />
      </span>
    )
  }
  return (
    // biome-ignore lint/performance/noImgElement: registry components can't assume next/image
    <img
      src={safe}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      className={cn("rounded-lg bg-muted object-cover", className)}
    />
  )
}

function MediaGrid({ media, label }: { media: PartialMedia[]; label: string }) {
  const items = media.filter((m) => typeof m.src === "string").slice(0, 4)
  if (items.length === 0) return null
  return (
    <ul
      aria-label={label}
      className={cn(
        "grid max-w-sm gap-1.5",
        items.length === 1 ? "grid-cols-1" : "grid-cols-2",
        items.length === 3 && "sm:grid-cols-3",
      )}
    >
      {items.map((m, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: media can repeat
        <li key={i} className="min-w-0">
          <SafeImage
            src={m.src}
            alt={m.alt ?? ""}
            className={cn(
              "w-full",
              items.length === 1 ? "aspect-[2/1]" : "aspect-[4/3]",
            )}
          />
        </li>
      ))}
    </ul>
  )
}

function PostSkeleton() {
  return (
    <div aria-hidden className="flex border-t border-border px-3 py-3">
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
    </div>
  )
}

// ---- Posts mode ----------------------------------------------------------

const statIcons = {
  replies: MessageCircleIcon,
  reposts: Repeat2Icon,
  likes: HeartIcon,
  views: EyeIcon,
}

const statWords = {
  replies: ["reply", "replies"],
  reposts: ["repost", "reposts"],
  likes: ["like", "likes"],
  views: ["view", "views"],
} as const

function FoundPost({
  post,
  network,
  now,
}: {
  post: ReadyPost
  network: Network
  now: Date | null
}) {
  const locale = useGenUILocale()
  const author = post.author
  const relative = now ? formatRelativeTime(post.postedAt, now, locale) : ""
  const href = safeHttpUrl(post.url)
  const stats = (["replies", "reposts", "likes", "views"] as const).filter(
    (k) => typeof post.stats?.[k] === "number",
  )
  return (
    <motion.li {...enter} className="flex px-3">
      <article
        aria-label={[author.name, network.name, relative]
          .filter(Boolean)
          .join(", ")}
        className="flex min-w-0 flex-1"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span
              className="inline-flex items-center gap-1 text-[13px] font-semibold"
              title={author.handle}
            >
              {author.name}
              {author.verified && (
                <>
                  <BadgeCheckIcon
                    aria-hidden
                    className="size-3.5 text-muted-foreground"
                  />
                  <span className="sr-only">(verified)</span>
                </>
              )}
            </span>
            {author.handle && <span className="sr-only">{author.handle}</span>}
            <NetworkLabel network={network} />
            {post.postedAt && (
              <time
                dateTime={post.postedAt}
                title={now ? formatFullDate(post.postedAt, locale) : undefined}
                className={cn(genuiType.meta, "ml-auto shrink-0 tabular-nums")}
              >
                {relative}
              </time>
            )}
          </div>

          <PostText text={post.text} />

          {post.media && post.media.length > 0 && (
            <MediaGrid
              media={post.media}
              label={`Images in ${author.name}'s post`}
            />
          )}

          {(stats.length > 0 || post.sentiment || href) && (
            <div
              className={cn(
                genuiType.meta,
                "flex flex-wrap items-center gap-x-4 gap-y-1",
              )}
            >
              {stats.length > 0 && (
                <ul
                  aria-label="Engagement"
                  className="flex flex-wrap items-center gap-x-4 gap-y-1"
                >
                  {stats.map((k) => {
                    const Icon = statIcons[k]
                    const value = post.stats?.[k] ?? 0
                    const [one, many] = statWords[k]
                    return (
                      <li
                        key={k}
                        className="inline-flex items-center gap-1 tabular-nums"
                      >
                        <Icon aria-hidden className="size-3.5" />
                        <span aria-hidden>{formatCompact(value, locale)}</span>
                        <span className="sr-only">
                          {`${formatFull(value, locale)} ${value === 1 ? one : many}`}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
              {post.sentiment && (
                // The tone is part of "what are people saying", so it reads in full color.
                <span className="text-foreground">
                  <span className="sr-only">Sentiment: </span>
                  {sentimentLabel[post.sentiment]}
                </span>
              )}
              {href && (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  title="Open post"
                  className={cn("relative", genuiHit, "ml-auto inline-flex size-6 items-center justify-center rounded-full outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50")}
                >
                  <ExternalLinkIcon aria-hidden className="size-3.5" />
                  <span className="sr-only">
                    {`Open post by ${author.name} on ${network.name} (opens in a new tab)`}
                  </span>
                </a>
              )}
            </div>
          )}
        </div>
      </article>
    </motion.li>
  )
}

// ---- Draft mode ----------------------------------------------------------

function Counter({
  id,
  count,
  max,
}: {
  id: string
  count: number
  max: number | undefined
}) {
  const locale = useGenUILocale()
  const over = overBy(count, max)
  // Only worth showing near the limit; screen readers always get it.
  const near = !max || count >= max * 0.8
  return (
    <span
      id={id}
      className={cn(
        genuiType.value,
        "inline-flex items-center gap-1",
        over > 0 && "font-medium text-destructive",
        !near && "sr-only",
      )}
    >
      {over > 0 && <AlertTriangleIcon aria-hidden className="size-3.5" />}
      <span className="sr-only">{counterText(count, max, locale)}</span>
      <RollingDigits text={counterText(count, max, locale)} />
      {over > 0 && ` · Over by ${formatFull(over, locale)}`}
    </span>
  )
}

type VariantState = {
  variant: ReadyVariant
  network: Network
  posts: string[]
  media: MediaItem[]
  counts: number[]
  edited: boolean
  issues: string[]
}

function VariantEditor({
  state,
  baseId,
  account,
  editable,
  showCounters,
  altOpen,
  onPostChange,
  onSplit,
  onRemovePost,
  onAddPost,
  onAltChange,
  onAltOpen,
  onRemoveMedia,
  onUndo,
}: {
  state: VariantState
  baseId: string
  account: Partial<SocialAccount> | undefined
  editable: boolean
  showCounters: boolean
  altOpen: Set<string>
  onPostChange: (index: number, value: string) => void
  onSplit: (index: number) => void
  onRemovePost: (index: number) => void
  onAddPost: () => void
  onAltChange: (key: string, alt: string) => void
  onAltOpen: (key: string) => void
  onRemoveMedia: (key: string) => void
  onUndo: () => void
}) {
  const { network, posts, media, counts, edited } = state
  const name = account?.name || "Your account"
  const isThread = posts.length > 1
  const tooManyImages =
    network.maxImages !== undefined && media.length > network.maxImages

  return (
    <div className="flex border-t border-border px-3 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-semibold" title={account?.handle}>
            {name}
          </span>
          {account?.handle && <span className="sr-only">{account.handle}</span>}
          <NetworkLabel network={network} />
        </div>

        {isThread ? (
          <ol
            aria-label={`${network.name} thread, ${plural(posts.length, "post")}`}
            className="flex flex-col gap-3"
          >
            {posts.map((text, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: thread posts are positional
              <li key={i} className="flex flex-col gap-1.5">
                <PostField
                  id={`${baseId}-post-${i}`}
                  index={i}
                  total={posts.length}
                  text={text}
                  count={counts[i] ?? 0}
                  network={network}
                  editable={editable}
                  showCounter={showCounters}
                  onChange={(v) => onPostChange(i, v)}
                  onSplit={() => onSplit(i)}
                  onRemove={i > 0 ? () => onRemovePost(i) : undefined}
                />
              </li>
            ))}
          </ol>
        ) : (
          <PostField
            id={`${baseId}-post-0`}
            index={0}
            total={1}
            text={posts[0] ?? ""}
            count={counts[0] ?? 0}
            network={network}
            editable={editable}
            showCounter={showCounters}
            onChange={(v) => onPostChange(0, v)}
            onSplit={() => onSplit(0)}
          />
        )}

        {media.length > 0 && (
          <div className="flex flex-col gap-2">
            <ul
              aria-label={`Images for ${network.name}`}
              className="flex flex-col gap-3"
            >
              {media.map((m, i) => {
                const issue = altTextIssue(m.alt)
                const open =
                  editable &&
                  (issue !== null || altOpen.has(`${network.id}:${m.key}`))
                const label = `image ${i + 1} (${network.name})`
                return (
                  <motion.li
                    key={m.key}
                    {...enter}
                    className="flex items-start gap-3"
                  >
                    <SafeImage
                      src={m.src}
                      alt={m.alt}
                      className="size-16 shrink-0"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className={genuiType.label}>
                        <span className="sr-only">Image {i + 1}: </span>
                        Alt text
                      </span>
                      {issue && (
                        <span className="inline-flex items-center gap-1 text-[13px] font-medium text-destructive">
                          <AlertTriangleIcon
                            aria-hidden
                            className="size-3.5 shrink-0"
                          />
                          {issue === "missing"
                            ? "Add alt text"
                            : "Describe the image, not the file"}
                        </span>
                      )}
                      {open ? (
                        <Input
                          aria-label={`Alt text for ${label}`}
                          aria-invalid={issue !== null || undefined}
                          placeholder="Describe the image"
                          value={m.alt}
                          onChange={(e) => onAltChange(m.key, e.target.value)}
                        />
                      ) : (
                        m.alt && (
                          <p className="text-[13px] break-words">{m.alt}</p>
                        )
                      )}
                    </div>
                    {editable && (
                      <div className="flex shrink-0 gap-0.5">
                        {!open && (
                          <IconTip label={`Edit alt text for ${label}`}>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Edit alt text for ${label}`}
                              onClick={() => onAltOpen(m.key)}
                            >
                              <PencilIcon />
                            </Button>
                          </IconTip>
                        )}
                        <IconTip label={`Remove ${label}`}>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Remove ${label}`}
                            onClick={() => onRemoveMedia(m.key)}
                          >
                            <XIcon />
                          </Button>
                        </IconTip>
                      </div>
                    )}
                  </motion.li>
                )
              })}
            </ul>
            {tooManyImages && (
              <p className="inline-flex items-center gap-1 text-[13px] font-medium text-destructive">
                <AlertTriangleIcon aria-hidden className="size-3.5 shrink-0" />
                Max {network.maxImages} on {network.name}. Remove{" "}
                {media.length - (network.maxImages ?? 0)}.
              </p>
            )}
          </div>
        )}

        {editable && (network.supportsThreads || edited) && (
          <div className="-ml-2.5 flex flex-wrap gap-1">
            {network.supportsThreads && (
              <Button size="sm" variant="secondary" onClick={onAddPost}>
                <PlusIcon aria-hidden />
                Add to thread
                <span className="sr-only"> on {network.name}</span>
              </Button>
            )}
            {edited && (
              <Button size="sm" variant="secondary" onClick={onUndo}>
                <RotateCcwIcon aria-hidden />
                Undo edits
                <span className="sr-only"> to the {network.name} post</span>
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function PostField({
  id,
  index,
  total,
  text,
  count,
  network,
  editable,
  showCounter,
  onChange,
  onSplit,
  onRemove,
}: {
  id: string
  index: number
  total: number
  text: string
  count: number
  network: Network
  editable: boolean
  showCounter: boolean
  onChange: (value: string) => void
  onSplit: () => void
  onRemove?: () => void
}) {
  const over = overBy(count, network.maxChars)
  const where =
    total > 1
      ? `post ${index + 1} of ${total} for ${network.name}`
      : `post for ${network.name}`
  return (
    <>
      {total > 1 && (
        <div className="flex min-h-7 items-center justify-between gap-2">
          <span className={genuiType.label}>
            Post {index + 1} of {total}
          </span>
          {editable && onRemove && (
            <IconTip label={`Remove ${where}`}>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove ${where}`}
                onClick={onRemove}
              >
                <Trash2Icon />
              </Button>
            </IconTip>
          )}
        </div>
      )}
      {editable ? (
        <Textarea
          id={id}
          aria-label={`Text of the ${where}`}
          aria-describedby={`${id}-count`}
          aria-invalid={over > 0 || undefined}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-20"
        />
      ) : text ? (
        <PostText text={text} />
      ) : (
        <div className="flex flex-col gap-2 py-0.5">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      )}
      {showCounter && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Counter id={`${id}-count`} count={count} max={network.maxChars} />
          {editable && over > 0 && network.supportsThreads && (
            <Button
              size="sm"
              variant="secondary"
              onClick={onSplit}
              className="-mr-2.5"
            >
              <ScissorsIcon aria-hidden />
              Split into thread
              <span className="sr-only"> ({where})</span>
            </Button>
          )}
        </div>
      )}
    </>
  )
}

// ---- Component -----------------------------------------------------------

export function SocialPost({
  mode,
  title,
  networks = [],
  account,
  posts = [],
  summary,
  draft,
  bestTimes = [],
  approvalRequired = false,
  status: statusProp,
  onResult,
  result,
  className,
}: SocialPostProps) {
  const locale = useGenUILocale()
  const baseId = React.useId()
  const now = useNow()
  const isDraft = mode === "draft" || (mode === undefined && !!draft)

  // Restored from `result` when the decision is already in history.
  const [decision, setDecision] = React.useState<
    "approved" | "revised" | "discarded" | null
  >(() => (result ? decisionFor[result.action] : null))
  const [edits, setEdits] = React.useState<Record<string, VariantEdit>>(() =>
    result?.action === "approve"
      ? Object.fromEntries(
          result.variants.map((v) => [
            v.networkId,
            {
              posts: [v.text, ...(v.thread ?? [])],
              media: v.media ? withKeys(v.media) : undefined,
            },
          ]),
        )
      : {},
  )
  /** The user's choice; null while they haven't touched the schedule. */
  const [whenEdit, setWhenEdit] = React.useState<{
    mode: "now" | "schedule"
    /** datetime-local value, wall-clock time in the draft's zone. */
    value: string
  } | null>(null)
  const restoredWhen = result?.action === "approve" ? result.when : undefined
  const [altOpen, setAltOpen] = React.useState<Set<string>>(() => new Set())
  const [tab, setTab] = React.useState<string | null>(null)
  const [revising, setRevising] = React.useState(false)
  const [feedback, setFeedback] = React.useState(
    result?.action === "revise" ? result.feedback : "",
  )
  const [announcement, setAnnouncement] = React.useState("")

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: SocialPostStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status !== "ready"

  const networkFor = (id: string | undefined): Network => {
    const found = networks.find((n) => n.id === id)
    return {
      ...found,
      id: id ?? "",
      name: found?.name || id || "Unknown network",
    }
  }

  // ---- Posts mode ----
  const readyPosts = posts.filter(
    (p): p is ReadyPost =>
      typeof p.id === "string" &&
      typeof p.text === "string" &&
      typeof p.author?.name === "string",
  )
  // While streaming, the last post may still be arriving; hold it back.
  const shownPosts =
    streaming && readyPosts.length === posts.length
      ? readyPosts.slice(0, -1)
      : readyPosts

  // ---- Draft mode ----
  const timeZone = validTimeZone(draft?.timeZone)
  const variants = (draft?.variants ?? []).filter(
    (v): v is ReadyVariant =>
      typeof v.networkId === "string" && typeof v.text === "string",
  )
  const scheduleAt = draft?.scheduleAt

  const original = (v: ReadyVariant) => ({
    posts: [
      composePost(v.text, v.hashtags, v.link),
      ...(v.thread ?? []).filter((t): t is string => typeof t === "string"),
    ],
    media: withKeys(v.media),
  })

  const states: VariantState[] = variants.map((v) => {
    const network = networkFor(v.networkId)
    const base = original(v)
    const edit = edits[v.networkId]
    const current = {
      posts: edit?.posts ?? base.posts,
      media: edit?.media ?? base.media,
    }
    const counts = current.posts.map((p) =>
      countChars(p, { linkLength: network.linkLength }),
    )
    const edited =
      edit !== undefined &&
      (result?.action !== "approve" || result.edited) &&
      (JSON.stringify(current.posts) !== JSON.stringify(base.posts) ||
        JSON.stringify(stripKeys(current.media)) !==
          JSON.stringify(stripKeys(base.media)))
    const issues: string[] = []
    const overPosts = counts.filter((c) => overBy(c, network.maxChars) > 0)
    if (!current.posts[0]?.trim()) issues.push(`${network.name} post is empty`)
    if (overPosts.length) {
      issues.push(
        current.posts.length > 1
          ? `${network.name}: ${plural(overPosts.length, "post")} over the limit`
          : `${network.name} post is over the limit`,
      )
    }
    const missingAlt = current.media.filter((m) => altTextIssue(m.alt)).length
    if (missingAlt) {
      issues.push(
        `${network.name}: ${plural(missingAlt, "image needs", "images need")} alt text`,
      )
    }
    if (
      network.maxImages !== undefined &&
      current.media.length > network.maxImages
    ) {
      issues.push(`${network.name}: too many images`)
    }
    return {
      variant: v,
      network,
      posts: current.posts,
      media: current.media,
      counts,
      edited,
      issues,
    }
  })

  const edited =
    result?.action === "approve" ? result.edited : states.some((s) => s.edited)

  // From history: the approved time. Otherwise the user's choice, else the draft's.
  const whenMode: "now" | "schedule" = restoredWhen
    ? restoredWhen === "now"
      ? "now"
      : "schedule"
    : (whenEdit?.mode ?? (scheduleAt ? "schedule" : "now"))
  const scheduleValue = whenEdit
    ? whenEdit.value
    : scheduleAt && (timeZone || now)
      ? toZonedInputValue(scheduleAt, timeZone)
      : ""
  const whenIso =
    whenMode === "now"
      ? null
      : restoredWhen
        ? restoredWhen
        : whenEdit === null && scheduleAt
          ? scheduleAt
          : fromZonedInputValue(scheduleValue, timeZone)

  const scheduleIssue =
    whenMode !== "schedule"
      ? null
      : !whenIso
        ? "Pick a date and time"
        : now && isPast(whenIso, now)
          ? "That time has passed. Pick a later one."
          : null

  const issues = [
    ...states.flatMap((s) => s.issues),
    ...(scheduleIssue ? [scheduleIssue] : []),
  ]
  const canApprove = !locked && states.length > 0 && issues.length === 0

  const activeTab =
    states.find((s) => s.network.id === tab)?.network.id ??
    states[0]?.network.id ??
    ""

  const focusSoon = (id: string) =>
    requestAnimationFrame(() => document.getElementById(id)?.focus())

  const updateVariant = (
    s: VariantState,
    change: (current: { posts: string[]; media: MediaItem[] }) => VariantEdit,
  ) =>
    setEdits((prev) => ({
      ...prev,
      [s.network.id]: {
        ...prev[s.network.id],
        ...change({ posts: s.posts, media: s.media }),
      },
    }))

  const postId = (s: VariantState, i: number) =>
    `${baseId}-${s.network.id}-post-${i}`

  const approve = () => {
    if (!canApprove) return
    const when = whenMode === "now" ? "now" : (whenIso ?? "now")
    setRevising(false)
    setDecision("approved")
    onResult?.({
      action: "approve",
      variants: states.map((s) => {
        const thread = s.posts
          .slice(1)
          .map((p) => p.trim())
          .filter(Boolean)
        return {
          networkId: s.network.id,
          text: (s.posts[0] ?? "").trim(),
          ...(thread.length > 0 && { thread }),
          // Present whenever the draft had images, so removals are explicit.
          ...((s.media.length > 0 || !!s.variant.media?.length) && {
            media: stripKeys(s.media),
          }),
        }
      }),
      when,
      edited,
    })
  }

  const requestChanges = () => {
    const note = feedback.trim()
    if (!note) return
    setRevising(false)
    setDecision("revised")
    onResult?.({ action: "revise", feedback: note })
  }

  const discard = () => {
    setRevising(false)
    setDecision("discarded")
    onResult?.({ action: "discard" })
  }

  const networkNames = joinNames(
    isDraft
      ? states.map((s) => s.network.name)
      : [...new Set(shownPosts.map((p) => networkFor(p.network).name))],
  )
  // Networks and counts are visible in the tabs and posts; screen readers get them here.
  const meta = isDraft
    ? [networkNames && `For ${networkNames}`]
    : [shownPosts.length > 0 && plural(shownPosts.length, "post"), networkNames]
  const heading = title ?? (isDraft ? "Draft post" : "Posts")
  const zoneLabel = now
    ? zoneShortName(whenIso ?? undefined, timeZone, locale) ||
      (timeZone?.replace(/_/g, " ") ?? "")
    : ""
  const scheduledLabel =
    whenIso && now
      ? `${formatScheduleTime(whenIso, timeZone, locale)} ${zoneShortName(whenIso, timeZone, locale)}`.trim()
      : ""

  const suggestions = bestTimes.filter(
    (b): b is Partial<SocialBestTime> & { at: string } =>
      typeof b.at === "string" &&
      !!safeTime(b.at) &&
      (!now || !isPast(b.at, now)) &&
      (!b.networkId || states.some((s) => s.network.id === b.networkId)),
  )

  const renderEditor = (s: VariantState) => (
    <VariantEditor
      state={s}
      baseId={`${baseId}-${s.network.id}`}
      account={account}
      editable={!locked}
      showCounters={streaming || status === "ready" || status === "submitting"}
      altOpen={altOpen}
      onPostChange={(i, value) =>
        updateVariant(s, ({ posts }) => ({
          posts: posts.map((p, j) => (j === i ? value : p)),
        }))
      }
      onSplit={(i) => {
        const chunks = splitIntoThread(s.posts[i] ?? "", {
          max: s.network.maxChars ?? Number.POSITIVE_INFINITY,
          linkLength: s.network.linkLength,
        })
        if (chunks.length < 2) return
        updateVariant(s, ({ posts }) => ({
          posts: [...posts.slice(0, i), ...chunks, ...posts.slice(i + 1)],
        }))
        setAnnouncement(
          `Split into ${chunks.length} posts. ${s.network.name} thread now has ${s.posts.length - 1 + chunks.length} posts.`,
        )
        focusSoon(postId(s, i))
      }}
      onRemovePost={(i) => {
        updateVariant(s, ({ posts }) => ({
          posts: posts.filter((_, j) => j !== i),
        }))
        setAnnouncement(
          `Removed post ${i + 1} from the ${s.network.name} thread.`,
        )
        focusSoon(postId(s, i - 1))
      }}
      onAddPost={() => {
        updateVariant(s, ({ posts }) => ({ posts: [...posts, ""] }))
        focusSoon(postId(s, s.posts.length))
      }}
      onAltChange={(key, alt) => {
        setAltOpen((prev) => new Set(prev).add(`${s.network.id}:${key}`))
        updateVariant(s, ({ media }) => ({
          media: media.map((m) => (m.key === key ? { ...m, alt } : m)),
        }))
      }}
      onAltOpen={(key) =>
        setAltOpen((prev) => new Set(prev).add(`${s.network.id}:${key}`))
      }
      onRemoveMedia={(key) => {
        updateVariant(s, ({ media }) => ({
          media: media.filter((m) => m.key !== key),
        }))
        setAnnouncement(`Removed an image from the ${s.network.name} post.`)
      }}
      onUndo={() => {
        setEdits((prev) => {
          const next = { ...prev }
          delete next[s.network.id]
          return next
        })
        setAnnouncement(`Restored the drafted ${s.network.name} post.`)
      }}
    />
  )

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="social-post"
        data-mode={isDraft ? "draft" : "posts"}
        data-status={status}
        aria-busy={streaming || status === "submitting"}
        aria-label={heading}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle className="min-w-0 break-words">
            {title ?? (streaming && !mode ? undefined : heading)}
          </SurfaceTitle>
          {meta.filter(Boolean).length > 0 && (
            <p className="sr-only">{meta.filter(Boolean).join(" · ")}</p>
          )}
        </SurfaceHeader>

        {!isDraft ? (
          <>
            {summary && (
              <motion.p
                data-slot="social-post-summary"
                {...enter}
                // The answer to "what are people saying", so it reads first.
                className="border-t border-border px-3 py-3 text-[14px] leading-relaxed"
              >
                {summary}
              </motion.p>
            )}
            <AutoHeight>
              <ScrollFade
                label="Posts"
                className="max-h-[26rem] border-t border-border"
                viewportClassName="overflow-y-auto pt-3 pb-3"
              >
                <ul className="flex flex-col gap-5">
                  {shownPosts.map((p) => (
                    <FoundPost
                      key={p.id}
                      post={p}
                      network={networkFor(p.network)}
                      now={now}
                    />
                  ))}
                </ul>
              </ScrollFade>
              {streaming && <PostSkeleton />}
            </AutoHeight>
          </>
        ) : (
          <>
            <AutoHeight>
              {status === "discarded" ? null : states.length > 1 ? (
                <Tabs
                  value={activeTab}
                  onValueChange={(v) => setTab(String(v))}
                  className="gap-0"
                >
                  <div className="border-t border-border px-3 py-3">
                    <TabsList
                      aria-label="Networks"
                      className="h-auto min-h-9 w-full max-w-full flex-wrap"
                    >
                      {states.map((s) => (
                        <TabsTab key={s.network.id} value={s.network.id}>
                          {s.network.name}
                          {!locked && s.issues.length > 0 && (
                            <>
                              <AlertTriangleIcon
                                aria-hidden
                                className="text-destructive"
                              />
                              <span className="sr-only">(needs changes)</span>
                            </>
                          )}
                        </TabsTab>
                      ))}
                    </TabsList>
                  </div>
                  {states.map((s) => (
                    <TabsPanel
                      key={s.network.id}
                      value={s.network.id}
                      keepMounted
                    >
                      {renderEditor(s)}
                    </TabsPanel>
                  ))}
                </Tabs>
              ) : states.length === 1 ? (
                renderEditor(states[0])
              ) : streaming ? (
                <PostSkeleton />
              ) : null}
            </AutoHeight>

            {(status === "ready" || status === "submitting") &&
              states.length > 0 && (
                <fieldset
                  disabled={locked}
                  className="flex min-w-0 flex-col gap-2 border-t border-border px-3 py-3"
                >
                  <legend className="sr-only">When to post</legend>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <Segmented
                      label="Post timing"
                      value={whenMode}
                      // Keeps the picked time when toggling back and forth.
                      onChange={(m) =>
                        setWhenEdit({ mode: m, value: scheduleValue })
                      }
                      options={[
                        { value: "now", label: "Post now" },
                        { value: "schedule", label: "Schedule" },
                      ]}
                      className="w-full flex-none"
                    />
                    {whenMode === "schedule" && (
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <DatePicker
                          type="datetime-local"
                          aria-label="Date and time to post"
                          value={scheduleValue}
                          min={
                            now
                              ? toZonedInputValue(
                                  now.toISOString(),
                                  timeZone,
                                ).slice(0, 10)
                              : undefined
                          }
                          onValueChange={(v) =>
                            setWhenEdit({
                              mode: "schedule",
                              value: v,
                            })
                          }
                          className="w-auto"
                        />
                        {zoneLabel && (
                          <span
                            id={`${baseId}-zone`}
                            className="text-[13px] text-muted-foreground"
                          >
                            {zoneLabel}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {scheduleIssue && whenIso && (
                    <p className="inline-flex items-center gap-1 text-[13px] font-medium text-destructive">
                      <AlertTriangleIcon
                        aria-hidden
                        className="size-3.5 shrink-0"
                      />
                      {scheduleIssue}
                    </p>
                  )}
                  {suggestions.length > 0 && (
                    // biome-ignore lint/a11y/useSemanticElements: an inline row of chips; a fieldset's legend can't sit inline in a flex row
                    <div
                      role="group"
                      aria-labelledby={`${baseId}-best`}
                      className="flex flex-wrap items-center gap-1.5"
                    >
                      <span
                        id={`${baseId}-best`}
                        className={cn(genuiType.label, "mr-1")}
                      >
                        Suggested
                      </span>
                      {suggestions.map((b, i) => {
                        const network =
                          states.length > 1 && b.networkId
                            ? networkFor(b.networkId).name
                            : ""
                        // The reason stays in the tooltip and accessible name.
                        const label = [
                          network,
                          now ? formatWeekdayTime(b.at, timeZone, locale) : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")
                        const pressed =
                          whenMode === "schedule" &&
                          !!whenIso &&
                          sameInstant(whenIso, b.at)
                        return (
                          <Button
                            // biome-ignore lint/suspicious/noArrayIndexKey: suggestions can share a time
                            key={i}
                            size="sm"
                            variant="secondary"
                            aria-pressed={pressed}
                            className={cn(
                              pressed && "ring-2 ring-choice ring-inset",
                            )}
                            title={b.reason}
                            onClick={() => {
                              setWhenEdit({
                                mode: "schedule",
                                value: toZonedInputValue(b.at, timeZone),
                              })
                              setAnnouncement(
                                `Scheduled for ${formatScheduleTime(b.at, timeZone, locale)}`,
                              )
                            }}
                          >
                            {label || "Suggested time"}
                            {b.reason && (
                              <span className="sr-only">, {b.reason}</span>
                            )}
                          </Button>
                        )
                      })}
                    </div>
                  )}
                </fieldset>
              )}

            <SurfaceFooter
              aria-live="polite"
              className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between"
            >
              {status === "approved" ? (
                <p className={cn(genuiType.body, "flex items-start gap-1.5")}>
                  <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span>
                    {whenIso
                      ? `Scheduled for ${scheduledLabel || "the chosen time"}`
                      : "Sent to publish"}
                    {approvalRequired && " · Awaiting team sign-off"}
                  </span>
                </p>
              ) : status === "revised" ? (
                <p
                  className={cn(
                    genuiType.body,
                    "flex items-start gap-1.5 text-muted-foreground",
                  )}
                >
                  <MessageSquareIcon
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <span>
                    Changes requested
                    {feedback && (
                      <span className="text-foreground">: “{feedback}”</span>
                    )}
                  </span>
                </p>
              ) : status === "discarded" ? (
                <p
                  className={cn(
                    genuiType.body,
                    "flex items-center gap-1.5 text-muted-foreground",
                  )}
                >
                  <XIcon aria-hidden className="size-4 shrink-0" />
                  Discarded. Nothing posted.
                </p>
              ) : revising ? (
                <div className="flex w-full flex-col gap-2">
                  <Textarea
                    autoFocus
                    aria-label="What should change in the post?"
                    placeholder="What should change?"
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                        requestChanges()
                      if (e.key === "Escape") setRevising(false)
                    }}
                    className="min-h-16"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setRevising(false)}
                    >
                      Cancel
                    </Button>
                    <WhyDisabled when={!feedback.trim()} reason="Write what should change">
                      <Button
                        size="sm"
                        onClick={requestChanges}
                        disabled={!feedback.trim()}
                      >
                        Send request
                      </Button>
                    </WhyDisabled>
                  </div>
                </div>
              ) : (
                <>
                  <p className={genuiType.meta}>
                    {streaming ? (
                      <ShimmeringText
                        text="Writing post…"
                        color="var(--muted-foreground)"
                        shimmeringColor="var(--foreground)"
                      />
                    ) : status === "submitting" ? (
                      whenMode === "now" ? (
                        "Publishing…"
                      ) : (
                        "Scheduling…"
                      )
                    ) : issues.length > 0 ? (
                      <span className="text-foreground">
                        {`To approve: ${issues.join(" · ")}`}
                      </span>
                    ) : (
                      <>
                        <span className="sr-only">
                          Nothing is posted until you approve.
                        </span>
                        {approvalRequired && "Team sign-off required"}
                      </>
                    )}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                    <IconTip label="Request changes">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Request changes"
                        onClick={() => setRevising(true)}
                        disabled={locked}
                      >
                        <MessageSquareIcon />
                      </Button>
                    </IconTip>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={discard}
                      disabled={locked}
                      className="flex-1 sm:flex-none"
                    >
                      Discard
                    </Button>
                    <WhyDisabled
                      when={
                        !canApprove &&
                        !streaming &&
                        status !== "submitting" &&
                        issues.length > 0
                      }
                      reason={`To approve: ${issues.join(" · ")}`}
                      className="flex-1 sm:flex-none"
                    >
                      <Button
                        size="sm"
                        onClick={approve}
                        disabled={!canApprove}
                        className="flex-1 sm:flex-none"
                      >
                        {status === "submitting"
                          ? whenMode === "now"
                            ? "Publishing…"
                            : "Scheduling…"
                          : whenMode === "now"
                            ? "Approve & post"
                            : "Approve & schedule"}
                      </Button>
                    </WhyDisabled>
                  </div>
                </>
              )}
            </SurfaceFooter>
            <p aria-live="polite" className="sr-only">
              {announcement}
            </p>
          </>
        )}
      </Surface>
    </MotionConfig>
  )
}

function safeTime(iso: string): boolean {
  return !Number.isNaN(new Date(iso).getTime())
}
