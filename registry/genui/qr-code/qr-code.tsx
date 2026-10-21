"use client"

import * as React from "react"
import {
  AlertTriangleIcon,
  AlignLeftIcon,
  BriefcaseIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  GlobeIcon,
  KeyRoundIcon,
  LinkIcon,
  type LucideIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
  ShieldIcon,
  TypeIcon,
  UserIcon,
  WifiIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  genuiType,
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiMotion,
} from "@/components/genui/surface"

import {
  TYPE_LABEL,
  buildPayload,
  darkRuns,
  defaultTitle,
  describeContent,
  displayUrl,
  encodeQr,
  formatWhen,
  matrixToPath,
  qrDimension,
  qrFilename,
  rasterLayout,
  toSvgFile,
  tooLongMessage,
  type QrMatrix,
} from "./qr-code-utils"
import {
  qrContentSchema,
  type QrCodeInput,
  type QrCodeResult,
  type QrContent,
  type QrContentInput,
  type QrContentType,
} from "./qr-code.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"

export type QrCodeStatus = "streaming" | "ready"

export type QrCodeProps = Partial<Omit<QrCodeInput, "content">> & {
  /**
   * May be partial while the tool call streams. Nothing is encoded until
   * `status` is "ready", so the code never changes under a scanner.
   */
  content?: Partial<QrContentInput>
  /** Lifecycle, controlled by the host. */
  status?: QrCodeStatus
  /**
   * Called when the user downloads or copies. For analytics only: the
   * component never locks, so there is nothing to restore from history.
   */
  onResult?: (result: QrCodeResult) => void
  className?: string
}

const SIZE_PX = { sm: 160, md: 220, lg: 280 } as const

/** Pixel size of the downloaded PNG, quiet zone included. */
const PNG_PX = 1024

const SECURITY_LABEL = {
  WPA: "WPA/WPA2",
  WEP: "WEP",
  nopass: "None (open network)",
} as const

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

function renderPng(modules: QrMatrix): Promise<Blob | null> {
  const canvas = document.createElement("canvas")
  canvas.width = PNG_PX
  canvas.height = PNG_PX
  const ctx = canvas.getContext("2d")
  if (!ctx) return Promise.resolve(null)
  ctx.fillStyle = "#fff"
  ctx.fillRect(0, 0, PNG_PX, PNG_PX)
  ctx.fillStyle = "#000"
  const { cell, offset } = rasterLayout(modules, PNG_PX)
  for (const [r, c, n] of darkRuns(modules)) {
    ctx.fillRect(offset + c * cell, offset + r * cell, n * cell, cell)
  }
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"))
}

/** A short-lived message in the footer's live region. */
function useAnnouncement() {
  const [message, setMessage] = React.useState("")
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  React.useEffect(() => () => clearTimeout(timer.current), [])
  const announce = React.useCallback((text: string) => {
    setMessage(text)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(""), 2500)
  }, [])
  return [message, announce] as const
}

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function Row({
  label,
  icon: Icon,
  children,
  action,
}: {
  label: string
  icon: LucideIcon
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <dt
        className={cn(
          "flex w-32 max-w-[40%] shrink-0 items-center gap-1.5 self-start",
          genuiType.label,
        )}
      >
        <Icon aria-hidden className="size-3.5 shrink-0" />
        {label}
      </dt>
      <dd className={cn("min-w-0 flex-1 break-words font-medium", genuiType.body)}>
        {children}
      </dd>
      {action && (
        <dd className="-my-2 flex shrink-0 items-center gap-1">{action}</dd>
      )}
    </div>
  )
}

function WifiPassword({
  ssid,
  password,
  announce,
}: {
  ssid: string
  password: string
  announce: (text: string) => void
}) {
  const [shown, setShown] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  React.useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async () => {
    const ok = await writeClipboard(password)
    announce(ok ? "Password copied" : "Couldn't copy the password")
    setCopied(ok)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Row
      label="Password"
      icon={KeyRoundIcon}
      action={
        <>
          <IconTip label={`Show password for ${ssid}`}>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Show password for ${ssid}`}
              aria-pressed={shown}
              onClick={() => setShown((s) => !s)}
            >
              {shown ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
            </Button>
          </IconTip>
          <IconTip label={`Copy password for ${ssid}`}>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Copy password for ${ssid}`}
              onClick={copy}
            >
              {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
            </Button>
          </IconTip>
        </>
      }
    >
      {shown ? (
        <span className="font-mono break-all">{password}</span>
      ) : (
        <>
          <span aria-hidden className="tracking-widest">
            ••••••••
          </span>
          <span className="sr-only">Hidden</span>
        </>
      )}
    </Row>
  )
}

/** The readable version, for people who can't scan. */
function Summary({
  content,
  announce,
}: {
  content: QrContent
  announce: (text: string) => void
}) {
  const locale = useGenUILocale()
  switch (content.type) {
    case "url": {
      const url = content.url.trim()
      return (
        <Row
          label="Link"
          icon={LinkIcon}
          action={
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              Open
              <ExternalLinkIcon aria-hidden />
              <span className="sr-only">
                {" "}
                {displayUrl(url)} (opens in a new tab)
              </span>
            </a>
          }
        >
          <span title={url}>{displayUrl(url)}</span>
        </Row>
      )
    }
    case "text":
      return (
        <Row label="Text" icon={AlignLeftIcon}>
          <span className="whitespace-pre-wrap">{content.text}</span>
        </Row>
      )
    case "wifi":
      return (
        <>
          <Row label="Network" icon={WifiIcon}>
            {content.ssid}
          </Row>
          <Row label="Security" icon={ShieldIcon}>
            {SECURITY_LABEL[content.security]}
          </Row>
          {content.security !== "nopass" && content.password && (
            <WifiPassword
              ssid={content.ssid}
              password={content.password}
              announce={announce}
            />
          )}
          {content.hidden && (
            <Row label="Visibility" icon={EyeOffIcon}>
              Hidden network
            </Row>
          )}
        </>
      )
    case "contact": {
      const role = [content.title, content.org].filter(Boolean).join(", ")
      return (
        <>
          <Row label="Name" icon={UserIcon}>
            {content.name}
          </Row>
          {role && (
            <Row label="Role" icon={BriefcaseIcon}>
              {role}
            </Row>
          )}
          {content.phone && (
            <Row label="Phone" icon={PhoneIcon}>
              <span className="tabular-nums">{content.phone}</span>
            </Row>
          )}
          {content.email && (
            <Row label="Email" icon={MailIcon}>
              <span className="break-all">{content.email}</span>
            </Row>
          )}
          {content.url && (
            <Row label="Website" icon={GlobeIcon}>
              <span title={content.url}>{displayUrl(content.url)}</span>
            </Row>
          )}
        </>
      )
    }
    case "event":
      return (
        <>
          <Row label="Event" icon={CalendarIcon}>
            {content.title}
          </Row>
          <Row label="When" icon={ClockIcon}>
            <time dateTime={content.start} suppressHydrationWarning>
              {formatWhen(content.start, content.end, locale)}
            </time>
          </Row>
          {content.location && (
            <Row label="Where" icon={MapPinIcon}>
              {content.location}
            </Row>
          )}
        </>
      )
    case "email":
      return (
        <>
          <Row label="To" icon={MailIcon}>
            <span className="break-all">{content.to}</span>
          </Row>
          {content.subject && (
            <Row label="Subject" icon={TypeIcon}>
              {content.subject}
            </Row>
          )}
          {content.body && (
            <Row label="Message" icon={AlignLeftIcon}>
              <span className="whitespace-pre-wrap">{content.body}</span>
            </Row>
          )}
        </>
      )
    case "phone":
      return (
        <Row label="Phone" icon={PhoneIcon}>
          <span className="tabular-nums">{content.number}</span>
        </Row>
      )
  }
}

export function QrCode({
  title,
  content,
  errorCorrection = "M",
  caption,
  size = "md",
  status: statusProp,
  onResult,
  className,
}: QrCodeProps) {
  const status: QrCodeStatus = statusProp ?? "ready"
  const streaming = status === "streaming"
  const px = SIZE_PX[size] ?? SIZE_PX.md
  const [message, announce] = useAnnouncement()
  const [copied, setCopied] = React.useState(false)
  const copiedTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  React.useEffect(() => () => clearTimeout(copiedTimer.current), [])

  // Validate and encode only once the payload is complete.
  const parsed = React.useMemo(
    () =>
      streaming || content === undefined
        ? null
        : qrContentSchema.safeParse(content),
    [streaming, content],
  )
  const data = parsed?.success ? parsed.data : null
  const payload = data ? buildPayload(data) : null
  const encoding = React.useMemo(
    () => (payload === null ? null : encodeQr(payload, errorCorrection)),
    [payload, errorCorrection],
  )
  const modules = encoding?.ok ? encoding.modules : null

  const error = streaming
    ? null
    : !content
      ? "There's nothing to encode yet."
      : parsed && !parsed.success
        ? `Can't make a QR code: ${lowerFirst(parsed.error.issues[0]?.message ?? "the content is incomplete")}.`
        : encoding && !encoding.ok
          ? tooLongMessage(errorCorrection)
          : null

  const typeLabel =
    content?.type && content.type in TYPE_LABEL
      ? TYPE_LABEL[content.type as QrContentType]
      : null
  const shownTitle =
    title || (data ? defaultTitle(data) : streaming ? undefined : "QR code")
  const fileBase = title || (data ? defaultTitle(data) : "code")
  const dim = modules ? qrDimension(modules) : 0
  const path = React.useMemo(
    () => (modules ? matrixToPath(modules) : ""),
    [modules],
  )

  const downloadPng = async () => {
    if (!modules) return
    onResult?.({ action: "download-png" })
    const blob = await renderPng(modules)
    if (!blob) {
      announce("Couldn't create the PNG")
      return
    }
    const name = qrFilename(fileBase, "png")
    saveBlob(blob, name)
    announce(`Downloaded ${name}`)
  }

  const downloadSvg = () => {
    if (!modules) return
    onResult?.({ action: "download-svg" })
    const name = qrFilename(fileBase, "svg")
    saveBlob(
      new Blob([toSvgFile(modules, PNG_PX)], {
        type: "image/svg+xml;charset=utf-8",
      }),
      name,
    )
    announce(`Downloaded ${name}`)
  }

  const copy = async () => {
    if (payload === null) return
    onResult?.({ action: "copy" })
    const ok = await writeClipboard(payload)
    announce(
      ok ? (data?.type === "url" ? "Link copied" : "Copied") : "Couldn't copy",
    )
    setCopied(ok)
    clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(false), 1500)
  }

  const isUrl = data?.type === "url"

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="qr-code"
        data-status={status}
        data-type={content?.type}
        aria-busy={streaming}
        aria-label={title ? `${title}, QR code` : "QR code"}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle className="min-w-0 break-words">
            {shownTitle}
          </SurfaceTitle>
          {typeLabel && <span className="sr-only">{typeLabel}</span>}
        </SurfaceHeader>

        <div className="flex flex-col items-center gap-2 border-t border-border px-3 py-3">
          {modules && data ? (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={genuiMotion.fade}
              // Always black on white, in dark mode too: scanners need the contrast.
              className="max-w-full overflow-hidden rounded-[10px] bg-white ring-1 ring-foreground/10"
              style={{ width: px }}
            >
              <svg
                role="img"
                aria-label={`QR code for ${describeContent(data)}`}
                viewBox={`0 0 ${dim} ${dim}`}
                shapeRendering="crispEdges"
                className="block h-auto w-full"
              >
                <rect width={dim} height={dim} fill="#fff" />
                <path fill="#000" d={path} />
              </svg>
            </motion.div>
          ) : error ? (
            <p
              data-slot="qr-code-error"
              className="flex w-full items-start gap-1.5 text-[13px] leading-5 text-destructive"
            >
              <AlertTriangleIcon
                aria-hidden
                className="mt-0.5 size-4 shrink-0"
              />
              {error}
            </p>
          ) : (
            <Skeleton
              className="aspect-square max-w-full rounded-[10px]"
              style={{ width: px }}
            />
          )}
          {caption ? (
            <p className={cn("text-center", genuiType.meta)}>{caption}</p>
          ) : null}
        </div>

        {data ? (
          <dl className="flex flex-col divide-y divide-border border-t border-border">
            <Summary content={data} announce={announce} />
          </dl>
        ) : (
          streaming && (
            <div
              aria-hidden
              className="flex flex-col border-t border-border py-3"
            >
              <div className="flex gap-3 px-3 py-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 flex-1" />
              </div>
              <div className="flex gap-3 px-3 py-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            </div>
          )
        )}

        <SurfaceFooter className="justify-between">
          <p
            aria-live="polite"
            className={cn("min-w-0 flex-1", genuiType.meta)}
          >
            {streaming ? (
              <ShimmeringText
                text="Preparing QR code…"
                color="var(--muted-foreground)"
                shimmeringColor="var(--foreground)"
              />
            ) : (
              message
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <WhyDisabled reason={!streaming && payload === null && "Nothing to encode yet"}>
              <Button
                size="sm"
                variant="secondary"
                disabled={payload === null}
                onClick={copy}
              >
                {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
                {isUrl ? "Copy link" : "Copy"}
                {!isUrl && <span className="sr-only"> encoded text</span>}
              </Button>
            </WhyDisabled>
            <WhyDisabled reason={!streaming && !modules && "QR code not ready"}>
              <Button
                size="sm"
                variant="secondary"
                disabled={!modules}
                onClick={downloadSvg}
              >
                <span className="sr-only">Download </span>SVG
              </Button>
            </WhyDisabled>
            <WhyDisabled reason={!streaming && !modules && "QR code not ready"}>
              <Button size="sm" disabled={!modules} onClick={downloadPng}>
                <DownloadIcon aria-hidden />
                Download PNG
              </Button>
            </WhyDisabled>
          </div>
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}
