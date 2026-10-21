"use client"

import * as React from "react"
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  InfoIcon,
  PlusIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"

import type {
  AccountBalancesInput,
  AccountBalancesResult,
  AccountKind,
  BalanceAccount,
  BalancesAction,
} from "./account-balances.schema"
import {
  type ChangeDirection,
  allocationShares,
  changeDirection,
  computeTotals,
  formatAmountChange,
  formatMoney,
  formatPercentChange,
  isForeign,
  isLiability,
  maskIdentifier,
  maskedMoney,
  resolveNow,
  splitMoney,
  staleText,
  totalDiffers,
} from "./account-balances-utils"
import { IconTip } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"

export type AccountBalancesStatus = "streaming" | "ready"

type BalancesChange = NonNullable<AccountBalancesInput["change"]>

export type AccountBalancesProps = Partial<
  Omit<AccountBalancesInput, "accounts" | "change">
> & {
  /** Accounts may be partial while the tool call streams. */
  accounts?: Partial<BalanceAccount>[]
  change?: Partial<BalancesChange>
  /**
   * The moment `asOf` is compared with ("Updated 3 days ago"). Defaults to
   * the viewer's clock, read after mount.
   */
  now?: Date | string | number
  /** Lifecycle, controlled by the host. */
  status?: AccountBalancesStatus
  /**
   * Called when the user presses a button. Each is a handoff to the host's
   * own flow; the card stays live and never locks.
   */
  onResult?: (result: AccountBalancesResult) => void
  className?: string
}

const DEFAULT_ACTIONS: BalancesAction[] = ["add-account", "view-details"]

const KINDS = new Set<AccountKind>([
  "checking",
  "savings",
  "credit",
  "investment",
  "crypto",
  "cash",
  "loan",
  "other",
])

// Segment fills in bar order. Light and dark use different steps of the
// neutral chart scale so the first segment always has the most contrast, like
// the Chart and the Insight Card.
const SLOTS = [
  "bg-chart-5 dark:bg-chart-1",
  "bg-chart-3 dark:bg-chart-2",
  "bg-chart-2 dark:bg-chart-3",
  "bg-chart-1 dark:bg-chart-4",
]

const DIRECTION_WORD: Record<ChangeDirection, string> = {
  up: "Up",
  down: "Down",
  flat: "Unchanged",
}

/** A validated BCP 47 tag, or undefined (falls back to the host locale). */
function safeLocale(locale: string | undefined) {
  if (!locale) return undefined
  try {
    return Intl.getCanonicalLocales(locale)[0]
  } catch {
    return undefined
  }
}

/**
 * The current time, read once after mount (so server and client render the
 * same markup). Skipped when the host passes `now`.
 */
function useMountedNow(active: boolean) {
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (active) setNow(Date.now())
  }, [active])
  return now
}

/** An amount with dimmed cents, or masked. Screen readers get the plain text. */
function Money({
  amount,
  currency,
  locale,
  hidden,
  className,
}: {
  amount: number
  currency: string | undefined
  locale: string | undefined
  hidden: boolean
  className?: string
}) {
  if (hidden) {
    return (
      <span className={cn("tabular-nums", className)}>
        <span className="sr-only">hidden</span>
        <span aria-hidden>{maskedMoney(currency, locale)}</span>
      </span>
    )
  }
  const parts = splitMoney(amount, currency, locale)
  return (
    <span className={cn("tabular-nums", className)}>
      <span className="sr-only">{parts.text}</span>
      <span aria-hidden>
        {parts.lead}
        {parts.cents && (
          <span className="text-muted-foreground">{parts.cents}</span>
        )}
        {parts.trail}
      </span>
    </span>
  )
}

function ChangeLine({
  change,
  currency,
  locale,
  hidden,
}: {
  change: BalancesChange
  currency: string
  locale: string | undefined
  hidden: boolean
}) {
  const { percent, amount, period } = change
  const hasPercent = typeof percent === "number" && Number.isFinite(percent)
  const hasAmount = typeof amount === "number" && Number.isFinite(amount)
  if (!hasPercent && !hasAmount) return null
  const dir = changeDirection(percent, amount)
  const Icon =
    dir === "up"
      ? ArrowUpRightIcon
      : dir === "down"
        ? ArrowDownRightIcon
        : null
  const sign = dir === "up" ? "+" : dir === "down" ? "-" : ""
  const amountText = hasAmount
    ? hidden
      ? `${sign}${maskedMoney(currency, locale)}`
      : formatAmountChange(amount, currency, locale)
    : null
  const pctText = hasPercent ? formatPercentChange(percent, locale) : null
  const visible = [
    pctText,
    amountText && pctText ? `(${amountText})` : amountText,
  ]
    .filter(Boolean)
    .join(" ")
  const spoken = [
    pctText,
    hasAmount ? (hidden ? "amount hidden" : amountText) : null,
  ]
    .filter(Boolean)
    .join(", ")

  return (
    <p className={cn(genuiType.body, "flex min-w-0 flex-nowrap items-center gap-2")}>
      <Badge
        variant={
          dir === "up" ? "success" : dir === "down" ? "destructive" : "outline"
        }
        className="shrink-0 tabular-nums"
      >
        {Icon && <Icon aria-hidden />}
        <span className="sr-only">{`${DIRECTION_WORD[dir]} ${spoken}`}</span>
        <span aria-hidden>{visible}</span>
      </Badge>
      <span className="min-w-0 truncate text-muted-foreground">{period}</span>
    </p>
  )
}

type ReadyAccount = BalanceAccount

function isReady(a: Partial<BalanceAccount>): a is ReadyAccount {
  return (
    typeof a.id === "string" &&
    typeof a.name === "string" &&
    typeof a.kind === "string" &&
    KINDS.has(a.kind as AccountKind) &&
    typeof a.balance === "number" &&
    Number.isFinite(a.balance)
  )
}

function AccountRow({
  account,
  value,
  swatch,
  currency,
  locale,
  hidden,
  now,
  canReconnect,
  disabled,
  onReconnect,
}: {
  account: ReadyAccount
  /** Signed value in the display currency, or null when not converted. */
  value: number | null
  swatch: string | null
  currency: string
  locale: string | undefined
  hidden: boolean
  now: number | null
  canReconnect: boolean
  disabled: boolean
  onReconnect: () => void
}) {
  const liability = isLiability(account.kind)
  const foreign = isForeign(account, currency)
  const native = liability ? -Math.abs(account.balance) : account.balance
  const mask = maskIdentifier(account.mask)
  const stale = staleText(account.asOf, now)
  // One quiet line: where it's held, and how old the balance is when it matters.
  const meta = [account.institution, mask].filter(Boolean).join(" · ")

  return (
    <motion.li
      data-slot="account-balances-row"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={genuiMotion.fade}
      className="flex items-start gap-3 px-3 py-3"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          {swatch && (
            <span
              aria-hidden
              className={cn("size-2 shrink-0 rounded-full", swatch)}
            />
          )}
          <span className={cn(genuiType.body, "truncate font-medium")}>
            {account.name}
          </span>
        </span>
        {(meta || stale) && (
          <span className={cn(genuiType.meta, "truncate")}>
            {meta}
            {meta && stale && " · "}
            {stale && <time dateTime={account.asOf}>{stale}</time>}
          </span>
        )}
        {value === null && (
          <span className={genuiType.meta}>
            Not in total
            <span className="sr-only">{`, not converted to ${currency}`}</span>
          </span>
        )}
        {account.error && (
          <span className="flex items-center gap-1 text-[13px] text-destructive">
            <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0" />
            {account.error}
          </span>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1 text-right">
        <Money
          amount={value ?? native}
          currency={value === null ? account.currency : currency}
          locale={locale}
          hidden={hidden}
          className={cn(genuiType.body, "font-medium")}
        />
        {foreign && value !== null && (
          <span className={genuiType.meta}>
            <Money
              amount={native}
              currency={account.currency}
              locale={locale}
              hidden={hidden}
            />
            <span className="sr-only">, converted</span>
          </span>
        )}
        {account.error && canReconnect && (
          <Button
            size="sm"
            variant="secondary"
            aria-label={`Reconnect ${account.name}`}
            disabled={disabled}
            onClick={onReconnect}
          >
            Reconnect
          </Button>
        )}
      </div>
    </motion.li>
  )
}

function RowSkeleton() {
  return (
    <li aria-hidden className="flex items-center gap-3 px-3 py-3">
      <div className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-4 w-20" />
    </li>
  )
}

export function AccountBalances({
  title = "Total balance",
  currency: currencyProp,
  total,
  change,
  accounts = [],
  hideAmounts,
  actions,
  locale: localeProp,
  now: nowProp,
  status: lifecycle = "ready",
  onResult,
  className,
}: AccountBalancesProps) {
  const streaming = lifecycle === "streaming"
  const hostLocale = useGenUILocale()
  // The agent's locale field wins over the host's.
  const dataLocale = safeLocale(localeProp)
  const locale = dataLocale ?? hostLocale
  const currency = currencyProp ?? "USD"
  // The user's toggle wins; until then, follow the agent's hideAmounts.
  const [hiddenOverride, setHiddenOverride] = React.useState<boolean | null>(
    null,
  )
  const hidden = hiddenOverride ?? hideAmounts ?? false
  const fixedNow = resolveNow(nowProp)
  const mountedNow = useMountedNow(fixedNow === null)
  const now = fixedNow ?? mountedNow

  const enabled = new Set(
    actions && actions.length > 0 ? actions : DEFAULT_ACTIONS,
  )
  const ready = accounts.filter(isReady)
  const totals = computeTotals(ready, currency)
  const displayValues = new Map(totals.values.map((v) => [v.id, v.value]))

  // The bar: positive assets in the display currency, in account order.
  const segments = ready
    .filter((a) => !isLiability(a.kind))
    .map((a) => ({ account: a, value: displayValues.get(a.id) ?? null }))
    .filter(
      (s): s is { account: ReadyAccount; value: number } =>
        s.value !== null && s.value > 0,
    )
  const shares = allocationShares(segments.map((s) => s.value))
  const swatchOf = new Map(
    segments.map((s, i) => [s.account.id, SLOTS[i % SLOTS.length]]),
  )

  const assets = ready.filter((a) => !isLiability(a.kind))
  const liabilities = ready.filter((a) => isLiability(a.kind))
  const groups = [
    { key: "assets", label: "Assets", items: assets },
    { key: "liabilities", label: "Liabilities", items: liabilities },
  ].filter((g) => g.items.length > 0)

  const shownTotal =
    typeof total === "number" && Number.isFinite(total) ? total : totals.net
  const differs = totalDiffers(total, totals.net, totals.digits)
  const percent = new Intl.NumberFormat(locale, { style: "percent" })

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="account-balances"
        data-status={lifecycle}
        aria-busy={streaming}
        aria-label={title}
        lang={dataLocale}
        className={className}
      >
        <SurfaceHeader className="flex-row items-center justify-between gap-3 pb-3">
          <SurfaceTitle>{title}</SurfaceTitle>
          <div className="flex shrink-0 items-center gap-1">
            <IconTip label="Hide amounts">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Hide amounts"
                aria-pressed={hidden}
                onClick={() => setHiddenOverride(!hidden)}
                className="text-muted-foreground aria-pressed:text-foreground"
              >
                {hidden ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
              </Button>
            </IconTip>
          </div>
        </SurfaceHeader>

        <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            {streaming ? (
              // No running total: it would jump as accounts arrive.
              <Skeleton className="h-10 w-56 max-w-full" />
            ) : (
              <motion.p
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={genuiMotion.fade}
                className={genuiType.display}
              >
                <Money
                  amount={shownTotal}
                  currency={currency}
                  locale={locale}
                  hidden={hidden}
                />
              </motion.p>
            )}
            {!streaming && change?.period && (
              <ChangeLine
                change={{ ...change, period: change.period }}
                currency={currency}
                locale={locale}
                hidden={hidden}
              />
            )}
          </div>

          {!streaming &&
            (totals.owed > 0 || differs || totals.unconverted.length > 0) && (
              <div className={cn(genuiType.meta, "flex flex-col gap-1")}>
                {totals.owed > 0 && (
                  // The liabilities are listed below; the net note is for screen readers.
                  <p className="sr-only">
                    {"Net of "}
                    {hidden
                      ? "a hidden amount"
                      : formatMoney(totals.owed, currency, {
                          locale,
                          trimZeroCents: true,
                        })}
                    {" owed"}
                  </p>
                )}
                {differs && (
                  <p className="flex items-center gap-1">
                    <InfoIcon aria-hidden className="size-3.5 shrink-0" />
                    Total differs from accounts
                  </p>
                )}
                {totals.unconverted.length > 0 && (
                  <p>
                    {`Excludes ${totals.unconverted.length} unconverted`}
                    <span className="sr-only">
                      {` ${totals.unconverted.length === 1 ? "account" : "accounts"}, not converted to ${currency}`}
                    </span>
                  </p>
                )}
              </div>
            )}

          {streaming ? (
            <div aria-hidden className="pt-1">
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          ) : (
            segments.length > 0 && (
              <div className="pt-1">
                {/* Visual only: the swatches in the list name each segment. */}
                <div aria-hidden className="flex gap-1">
                  {segments.map((s, i) => (
                    <div
                      key={s.account.id}
                      className="flex min-w-1 flex-col"
                      style={{ flexGrow: s.value, flexBasis: 0 }}
                    >
                      <motion.span
                        className={cn(
                          "block h-2 origin-left rounded-full",
                          SLOTS[i % SLOTS.length],
                        )}
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{
                          duration: 0.3,
                          ease: "easeOut",
                          delay: i * 0.04,
                        }}
                      />
                    </div>
                  ))}
                </div>
                <ul className="sr-only" aria-label="Allocation of assets">
                  {segments.map((s, i) => (
                    <li key={s.account.id}>
                      {`${s.account.name} ${
                        shares[i] === 0
                          ? "under 1%"
                          : percent.format(shares[i] / 100)
                      }`}
                    </li>
                  ))}
                </ul>
              </div>
            )
          )}
        </div>

        {/* Height animates as accounts stream in. */}
        <AutoHeight>
          {groups.map((g) => (
            <div key={g.key} className="border-t border-border">
              {liabilities.length > 0 && (
                <h4 className={cn(genuiType.label, "px-3 pt-3")}>{g.label}</h4>
              )}
              <ul className="divide-y">
                {g.items.map((a) => (
                  <AccountRow
                    key={a.id}
                    account={a}
                    value={displayValues.get(a.id) ?? null}
                    swatch={swatchOf.get(a.id) ?? null}
                    currency={currency}
                    locale={locale}
                    hidden={hidden}
                    now={now}
                    canReconnect={enabled.has("reconnect")}
                    disabled={streaming}
                    onReconnect={() =>
                      onResult?.({ action: "reconnect", accountId: a.id })
                    }
                  />
                ))}
              </ul>
            </div>
          ))}
          {streaming && (
            <ul className="border-t border-border">
              <RowSkeleton />
            </ul>
          )}
        </AutoHeight>

        {(enabled.has("view-details") || enabled.has("add-account")) && (
          <SurfaceFooter className="mt-1 justify-between px-3 py-2">
            {enabled.has("add-account") && (
              <Button
                size="sm"
                variant={enabled.has("view-details") ? "secondary" : "default"}
                disabled={streaming}
                onClick={() => onResult?.({ action: "add-account" })}
              >
                <PlusIcon data-icon="inline-start" aria-hidden />
                Add account
              </Button>
            )}
            {enabled.has("view-details") && (
              <Button
                size="sm"
                variant="default"
                disabled={streaming}
                onClick={() => onResult?.({ action: "view-details" })}
                className={enabled.has("add-account") ? "ml-auto" : "w-full justify-between"}
              >
                View details
                <ChevronRightIcon data-icon="inline-end" aria-hidden />
              </Button>
            )}
          </SurfaceFooter>
        )}
      </Surface>
    </MotionConfig>
  )
}
