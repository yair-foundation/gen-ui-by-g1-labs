"use client"

import * as React from "react"
import {
  CheckIcon,
  ExternalLinkIcon,
  FileIcon,
  FileImageIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  MessageSquareIcon,
  PaperclipIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"

import {
  collectParticipants,
  type Contact,
  formatBytes,
  formatFullDate,
  formatParticipants,
  formatRecipients,
  formatRelativeTime,
  formatShortDate,
  isSelf,
  joinNames,
  linkify,
  plural,
  safeHttpUrl,
  selfEmails,
  splitBody,
  type TextSegment,
} from "./email-thread-utils"
import type {
  EmailAttachment,
  EmailDraft,
  EmailMessage,
  EmailParticipant,
  EmailThreadInput,
  EmailThreadResult,
} from "./email-thread.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"
import { ScrollFade } from "@/components/genui/scroll-fade"

export type EmailThreadStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "sent"
  | "revised"
  | "discarded"

type PartialContact = Partial<Contact>

type PartialMessage = Partial<
  Omit<EmailMessage, "from" | "to" | "cc" | "attachments">
> & {
  from?: PartialContact
  to?: PartialContact[]
  cc?: PartialContact[]
  attachments?: Partial<EmailAttachment>[]
}

type PartialDraft = Partial<Omit<EmailDraft, "to" | "cc">> & {
  to?: PartialContact[]
  cc?: PartialContact[]
}

export type EmailThreadProps = Partial<
  Omit<EmailThreadInput, "participants" | "messages" | "draft">
> & {
  /** Everything below may be partial while the tool call streams. */
  participants?: Partial<EmailParticipant>[]
  messages?: PartialMessage[]
  draft?: PartialDraft
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props; 'submitting' while the host sends the reply.
   * When omitted, the component tracks the user's decision itself.
   */
  status?: EmailThreadStatus
  /**
   * Called once with the user's decision about the draft. Never called
   * without a draft. The component never sends anything itself.
   */
  onResult?: (result: EmailThreadResult) => void
  /**
   * A decision from history. Renders the finished state (the sent reply, the
   * feedback or the discarded draft) and never calls onResult.
   */
  result?: EmailThreadResult
  className?: string
}

const decisionFor = {
  send: "sent",
  revise: "revised",
  discard: "discarded",
} as const

const attachmentIcons = {
  pdf: FileTextIcon,
  doc: FileTextIcon,
  image: FileImageIcon,
  sheet: FileSpreadsheetIcon,
  other: FileIcon,
}

const linkClass =
  "rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"

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

function Segments({ segments }: { segments: TextSegment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.type === "link" ? (
          <a
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
            key={i}
            href={s.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={cn(linkClass, "break-all")}
          >
            {s.text}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
          <React.Fragment key={i}>{s.text}</React.Fragment>
        ),
      )}
    </>
  )
}

function MessageBody({
  body,
  highlight,
}: {
  body: string
  highlight?: string
}) {
  const parts = splitBody(body, highlight)
  return (
    <div className={cn(genuiType.body, "whitespace-pre-wrap break-words")}>
      <Segments segments={parts.before} />
      {parts.match && (
        <mark className="rounded-sm bg-yellow-200/80 px-0.5 text-foreground dark:bg-yellow-300/25">
          <Segments segments={parts.match} />
          <span className="sr-only"> (answers your question)</span>
        </mark>
      )}
      <Segments segments={parts.after} />
    </div>
  )
}

function BodySkeleton() {
  return (
    <div className="flex flex-col gap-2 py-0.5">
      <Skeleton className="h-3.5 w-full" />
      <Skeleton className="h-3.5 w-11/12" />
      <Skeleton className="h-3.5 w-2/3" />
    </div>
  )
}

function AttachmentChip({
  attachment,
}: {
  attachment: Partial<EmailAttachment> & { name: string }
}) {
  const Icon = attachment.kind
    ? (attachmentIcons[attachment.kind] ?? FileIcon)
    : PaperclipIcon
  const href = safeHttpUrl(attachment.url)
  const size = formatBytes(attachment.sizeBytes)
  const className =
    "inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-border bg-transparent px-3.5 text-[13px]"
  const content = (
    <>
      <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{attachment.name}</span>
      {size && (
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {size}
        </span>
      )}
    </>
  )
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={cn(
        className,
        "outline-none transition-colors hover:bg-accent dark:hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      {content}
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  ) : (
    <span className={className}>{content}</span>
  )
}

function MessageItem({
  message,
  self,
  now,
  highlight,
  sent,
}: {
  message: PartialMessage
  self: Set<string>
  now: Date | null
  highlight?: string
  /** The user's own reply, sent from this component. */
  sent?: boolean
}) {
  const locale = useGenUILocale()
  const quotedId = React.useId()
  const [showQuoted, setShowQuoted] = React.useState(false)
  const from = message.from ?? {}
  const name = from.name?.trim() || from.email || "Unknown sender"
  const when = now ? formatShortDate(message.sentAt, locale) : ""
  const relative = now ? formatRelativeTime(message.sentAt, now, locale) : ""
  const recipients = formatRecipients(message.to, message.cc, self)
  const attachments = (message.attachments ?? []).filter(
    (a): a is Partial<EmailAttachment> & { name: string } =>
      typeof a.name === "string" && a.name.length > 0,
  )

  return (
    <motion.article
      data-slot="email-thread-message"
      data-unread={message.unread ? "" : undefined}
      aria-label={[name, sent ? "sent" : when].filter(Boolean).join(", ")}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={genuiMotion.fade}
      className="flex px-3"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span
              className={cn(genuiType.body, "font-semibold")}
              title={from.name && from.email ? from.email : undefined}
            >
              {name}
            </span>
            {message.unread && <Badge variant="info">Unread</Badge>}
            {message.important && <Badge variant="outline">Important</Badge>}
            {message.sentAt && (
              <time
                dateTime={message.sentAt}
                title={now ? formatFullDate(message.sentAt, locale) : undefined}
                className={cn(genuiType.meta, "ml-auto shrink-0 tabular-nums")}
              >
                {relative}
              </time>
            )}
          </div>
          {/* Who else got it: available to screen readers, kept off screen. */}
          {(recipients || (from.name && from.email)) && (
            <p className="sr-only">
              {[from.name && from.email, recipients].filter(Boolean).join(", ")}
            </p>
          )}
        </div>

        {message.body === undefined ? (
          <BodySkeleton />
        ) : (
          <MessageBody body={message.body} highlight={highlight} />
        )}

        {message.quoted && (
          <div className="flex flex-col items-start gap-2">
            <Button
              size="sm"
              variant="secondary"
              aria-expanded={showQuoted}
              aria-controls={quotedId}
              onClick={() => setShowQuoted((v) => !v)}
              className="-ml-2.5 text-[13px] text-muted-foreground"
            >
              {showQuoted ? "Hide quoted" : "Show quoted"}
              <span className="sr-only"> in {name}'s message</span>
            </Button>
            <blockquote
              id={quotedId}
              hidden={!showQuoted}
              className={cn(
                genuiType.body,
                "border-l-2 pl-3 whitespace-pre-wrap break-words text-muted-foreground",
              )}
            >
              <Segments segments={linkify(message.quoted)} />
            </blockquote>
          </div>
        )}

        {attachments.length > 0 && (
          <ul
            aria-label={`${plural(attachments.length, "attachment")} from ${name}`}
            className="flex flex-wrap gap-1.5"
          >
            {attachments.map((a, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: names can repeat
              <li key={`${a.name}-${i}`} className="max-w-full">
                <AttachmentChip attachment={a} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </motion.article>
  )
}

function MessageSkeleton() {
  return (
    <div aria-hidden className="flex px-3">
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <BodySkeleton />
      </div>
    </div>
  )
}

function RecipientChips({
  label,
  contacts,
}: {
  label: string
  contacts: PartialContact[]
}) {
  const ready = contacts.filter((c) => c.name || c.email)
  if (ready.length === 0) return null
  // Plain text, not chips: name plus the address it will really go to.
  return (
    <div className={cn(genuiType.body, "flex items-baseline gap-2")}>
      <span className={cn(genuiType.label, "w-6 shrink-0")}>{label}</span>
      <ul
        aria-label={label}
        className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5"
      >
        {ready.map((c, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: contacts can repeat while streaming
            key={`${c.email}-${i}`}
            className="inline-flex max-w-full items-baseline gap-1.5"
          >
            <span className="truncate">{c.name || c.email}</span>
            {c.name && c.email && (
              <span className={cn(genuiType.meta, "truncate")}>{c.email}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function EmailThread({
  subject,
  mailbox,
  participants,
  messages = [],
  summary,
  highlight,
  draft,
  url,
  status: statusProp,
  onResult,
  result,
  className,
}: EmailThreadProps) {
  const draftHeadingId = React.useId()
  const countId = React.useId()
  const now = useNow()

  // Restored from `result` when the decision is already in history.
  const [decision, setDecision] = React.useState<
    "sent" | "revised" | "discarded" | null
  >(() => (result ? decisionFor[result.action] : null))
  /** The user's edited body; null while they haven't touched the draft. */
  const [edit, setEdit] = React.useState<string | null>(() =>
    result?.action === "send" ? result.body : null,
  )
  const [revising, setRevising] = React.useState(false)
  const [feedback, setFeedback] = React.useState(
    result?.action === "revise" ? result.feedback : "",
  )

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: EmailThreadStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status !== "ready"

  const self = selfEmails(participants)
  const ready = messages.filter(
    (m): m is PartialMessage & { id: string } =>
      typeof m.id === "string" && Boolean(m.from?.name || m.from?.email),
  )
  const people = formatParticipants(
    participants?.length ? participants : collectParticipants(ready, self),
  )
  // One quiet line: who's on the thread. The message count is visible below.
  const meta = [people].filter(Boolean)
  const openUrl = safeHttpUrl(url)

  const hasDraft = draft !== undefined || result !== undefined
  const proposed = draft?.body ?? ""
  const text = edit ?? proposed
  const edited =
    result?.action === "send"
      ? result.edited
      : edit !== null && edit !== proposed
  const to = (draft?.to ?? []).filter((c) => c.name || c.email)
  const toNames = joinNames(to.map((c) => c.name?.trim() || c.email || ""))
  const replyTo = ready.find((m) => m.id === draft?.replyToId)
  const owner: PartialContact = participants?.find((p) => p.self) ??
    ready.map((m) => m.from).find((f) => f && isSelf(f, self)) ?? {
      name: "You",
    }

  const send = () => {
    if (locked || !text.trim()) return
    setRevising(false)
    setDecision("sent")
    onResult?.({ action: "send", body: text, edited })
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

  const scrolls = ready.length > 2
  const messageList = (
    <>
      {ready.map((m) => (
        <MessageItem
          key={m.id}
          message={m}
          self={self}
          now={now}
          highlight={highlight?.messageId === m.id ? highlight.text : undefined}
        />
      ))}
      {streaming && ready.length === 0 && <MessageSkeleton />}
    </>
  )

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="email-thread"
        data-status={status}
        aria-busy={streaming || status === "submitting"}
        aria-label={subject ? `Email thread: ${subject}` : "Email thread"}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <SurfaceTitle className="min-w-0 break-words">
              {subject}
            </SurfaceTitle>
            {openUrl && (
              <a
                href={openUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="-my-0.5 inline-flex min-h-6 shrink-0 items-center gap-1 rounded-sm text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                Open
                <ExternalLinkIcon aria-hidden className="size-3" />
                <span className="sr-only">
                  in your mail app (opens in a new tab)
                </span>
              </a>
            )}
          </div>
          {meta.length > 0 && (
            <p className={genuiType.meta}>
              {meta.join(" · ")}
              {mailbox?.label && (
                <span className="sr-only"> · {mailbox.label}</span>
              )}
            </p>
          )}
        </SurfaceHeader>

        {summary && (
          <motion.p
            data-slot="email-thread-summary"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={genuiMotion.fade}
            // The catch-up answer, so it reads first and largest.
            className="border-t border-border px-3 py-3 text-[14px] leading-relaxed"
          >
            {summary}
          </motion.p>
        )}

        <AutoHeight>
          <div className="flex flex-col">
            {scrolls ? (
              <ScrollFade
                label="Messages"
                className="max-h-[24rem] border-t border-border"
                viewportClassName="flex flex-col gap-5 py-3"
              >
                {messageList}
              </ScrollFade>
            ) : (
              <div className="flex flex-col gap-5 border-t border-border py-3">
                {messageList}
              </div>
            )}

            {status === "sent" ? (
              <div className="border-t border-border py-3">
                <MessageItem
                  message={{
                    id: "sent-reply",
                    from: owner,
                    to: draft?.to,
                    cc: draft?.cc,
                    body: text,
                  }}
                  self={self}
                  now={now}
                  sent
                />
              </div>
            ) : (
              draft &&
              status !== "discarded" && (
                <motion.section
                  data-slot="email-thread-draft"
                  aria-labelledby={draftHeadingId}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={genuiMotion.fade}
                  className="flex flex-col gap-2 border-t border-border px-3 py-3"
                >
                  <h4
                    id={draftHeadingId}
                    className={cn(genuiType.body, "font-semibold")}
                  >
                    Draft reply
                    {replyTo?.from && (
                      <span className="sr-only">
                        {" "}
                        to {replyTo.from.name?.trim() || replyTo.from.email}
                      </span>
                    )}
                  </h4>

                  <div className="flex flex-col gap-0.5">
                    <RecipientChips label="To" contacts={draft.to ?? []} />
                    <RecipientChips label="Cc" contacts={draft.cc ?? []} />
                  </div>

                  {draft.body === undefined ? (
                    <BodySkeleton />
                  ) : status === "revised" ? (
                    <p
                      className={cn(
                        genuiType.body,
                        "whitespace-pre-wrap break-words text-muted-foreground",
                      )}
                    >
                      {text}
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <Textarea
                        aria-label={toNames ? `Reply to ${toNames}` : "Reply"}
                        aria-describedby={countId}
                        value={text}
                        disabled={locked}
                        onChange={(e) => setEdit(e.target.value)}
                        className="min-h-24 bg-background"
                      />
                      <span id={countId} className="sr-only">
                        {plural(text.length, "character")}
                      </span>
                      {edited && !locked && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setEdit(null)}
                          className="-mr-2.5 self-end"
                        >
                          <RotateCcwIcon aria-hidden />
                          Undo edits
                        </Button>
                      )}
                    </div>
                  )}
                </motion.section>
              )
            )}
          </div>
        </AutoHeight>

        {hasDraft && (
          <SurfaceFooter
            aria-live="polite"
            className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            {status === "sent" ? (
              <p className={cn(genuiType.body, "flex items-center gap-1.5")}>
                <CheckIcon aria-hidden className="size-4 shrink-0" />
                <span>
                  Sent{toNames && ` to ${toNames}`}
                  {edited && " with your edits"}
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
                Draft discarded. Nothing sent.
              </p>
            ) : revising ? (
              <div className="flex w-full flex-col gap-2">
                <Textarea
                  autoFocus
                  aria-label="What should change in the reply?"
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
                  <WhyDisabled
                    when={!feedback.trim()}
                    reason="Describe the change first"
                  >
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
                      text="Writing reply…"
                      color="var(--muted-foreground)"
                      shimmeringColor="var(--foreground)"
                    />
                  ) : status === "submitting" ? (
                    "Sending…"
                  ) : (
                    <span className="sr-only">
                      Nothing is sent until you press Send.
                    </span>
                  )}
                </p>
                <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                  <WhyDisabled when={locked} reason="Already sent">
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
                  </WhyDisabled>
                  <WhyDisabled className="flex flex-1 sm:flex-none" when={locked} reason="Already sent">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={discard}
                      disabled={locked}
                      className="flex-1 sm:flex-none"
                    >
                      Discard
                    </Button>
                  </WhyDisabled>
                  <WhyDisabled
                    className="flex flex-1 sm:flex-none"
                    when={locked || !text.trim()}
                    reason="Write a reply first"
                  >
                    <Button
                      size="sm"
                      onClick={send}
                      disabled={locked || !text.trim()}
                      className="flex-1 sm:flex-none"
                    >
                      {status === "submitting" ? "Sending…" : "Send"}
                    </Button>
                  </WhyDisabled>
                </div>
              </>
            )}
          </SurfaceFooter>
        )}
      </Surface>
    </MotionConfig>
  )
}
