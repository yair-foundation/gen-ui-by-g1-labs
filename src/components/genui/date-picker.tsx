"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { useGenUILocale } from "@/components/genui/locale"

/**
 * Our own date, time and date-time picker. Replaces the browser's native
 * `type="date" | "time" | "datetime-local"` UI. Values use the same string
 * formats as the native inputs: "2026-10-12", "08:30", "2026-10-12T08:30".
 */
export type DatePickerType = "date" | "time" | "datetime-local"

export type DatePickerProps = {
  type?: DatePickerType
  value?: string
  onValueChange?: (value: string) => void
  /** Earliest / latest day, "YYYY-MM-DD". */
  min?: string
  max?: string
  /** Minutes between the times offered (default 15). */
  step?: number
  placeholder?: string
  disabled?: boolean
  /** Opens the calendar on mount, e.g. when a table cell starts editing. */
  defaultOpen?: boolean
  /** Called when the calendar opens or closes, by a pick or by dismissing it. */
  onOpenChange?: (open: boolean) => void
  id?: string
  "aria-label"?: string
  className?: string
}

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

const pad = (n: number) => String(n).padStart(2, "0")
const dayKey = (y: number, m: number, d: number) =>
  `${y}-${pad(m + 1)}-${pad(d)}`

function splitValue(type: DatePickerType, value?: string) {
  if (!value) return { day: "", time: "" }
  if (type === "time") return { day: "", time: value.slice(0, 5) }
  const [day = "", time = ""] = value.split("T")
  return { day, time: time.slice(0, 5) }
}

function parseDay(day: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return null
  return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) }
}

function formatDay(day: string, locale: string) {
  const p = parseDay(day)
  if (!p) return ""
  return new Date(p.y, p.m, p.d).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

function formatTime(time: string, locale: string) {
  const [h, m] = time.split(":").map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return ""
  const d = new Date(2000, 0, 1, h, m)
  return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
}

function DatePicker({
  type = "date",
  value,
  onValueChange,
  min,
  max,
  step = 15,
  placeholder,
  disabled,
  defaultOpen = false,
  onOpenChange,
  id,
  className,
  ...props
}: DatePickerProps) {
  const locale = useGenUILocale()
  const [open, setOpenState] = React.useState(defaultOpen)
  const setOpen = (next: boolean) => {
    setOpenState(next)
    onOpenChange?.(next)
  }
  const { day, time } = splitValue(type, value)
  const selected = parseDay(day)
  const today = new Date()
  const [view, setView] = React.useState(() => ({
    y: selected?.y ?? today.getFullYear(),
    m: selected?.m ?? today.getMonth(),
  }))

  const selY = selected?.y
  const selM = selected?.m
  React.useEffect(() => {
    // Re-center on the value each time the popover opens.
    if (open && selY !== undefined && selM !== undefined)
      setView({ y: selY, m: selM })
  }, [open, selY, selM])

  const emit = (nextDay: string, nextTime: string) => {
    if (type === "date") onValueChange?.(nextDay)
    else if (type === "time") onValueChange?.(nextTime)
    else
      onValueChange?.(
        `${nextDay || dayKey(today.getFullYear(), today.getMonth(), today.getDate())}T${nextTime || "09:00"}`,
      )
  }

  const pickDay = (key: string) => {
    emit(key, time)
    if (type === "date") setOpen(false)
  }
  const pickTime = (t: string) => {
    emit(day, t)
    if (type === "time") setOpen(false)
  }

  const first = new Date(view.y, view.m, 1)
  const offset = (first.getDay() + 6) % 7
  const daysIn = new Date(view.y, view.m + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: daysIn }, (_, i) => i + 1),
  ]
  const todayKey = dayKey(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  )

  const times = React.useMemo(() => {
    const out: string[] = []
    for (let mins = 0; mins < 24 * 60; mins += step)
      out.push(`${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`)
    return out
  }, [step])

  const move = (delta: number) =>
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })

  const label =
    type === "time"
      ? time && formatTime(time, locale)
      : type === "date"
        ? day && formatDay(day, locale)
        : day && time && `${formatDay(day, locale)}, ${formatTime(time, locale)}`
  const Icon = type === "time" ? ClockIcon : CalendarIcon
  const empty =
    placeholder ??
    (type === "time"
      ? "Pick a time"
      : type === "date"
        ? "Pick a date"
        : "Pick a date and time")

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger
        id={id}
        disabled={disabled}
        aria-label={props["aria-label"]}
        data-slot="date-picker"
        className={cn(
          "flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-transparent px-3 text-left text-sm transition-colors outline-none",
          "hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:border-border dark:hover:bg-white/5",
          "disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
      >
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            !label && "text-muted-foreground",
          )}
        >
          {label || empty}
        </span>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          className="isolate z-50"
        >
          <PopoverPrimitive.Popup
            data-slot="date-picker-popup"
            className="flex max-w-[calc(100vw-1.5rem)] origin-(--transform-origin) gap-3 rounded-[14px] border border-border bg-popover p-3 text-popover-foreground shadow-lg dark:shadow-none outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          >
            {type !== "time" && (
              <div className="w-[17.5rem]">
                <div className="flex items-center justify-between pb-2">
                  <button
                    type="button"
                    aria-label="Previous month"
                    onClick={() => move(-1)}
                    className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-white/10"
                  >
                    <ChevronLeftIcon aria-hidden className="size-4" />
                  </button>
                  <span aria-live="polite" className="text-sm font-medium">
                    {new Date(view.y, view.m, 1).toLocaleDateString(locale, {
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                  <button
                    type="button"
                    aria-label="Next month"
                    onClick={() => move(1)}
                    className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-white/10"
                  >
                    <ChevronRightIcon aria-hidden className="size-4" />
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-y-1 text-center">
                  {WEEKDAYS.map((w) => (
                    <span
                      key={w}
                      aria-hidden
                      className="py-1 text-[13px] text-muted-foreground"
                    >
                      {w}
                    </span>
                  ))}
                  {cells.map((d, i) => {
                    if (d === null)
                      // biome-ignore lint/suspicious/noArrayIndexKey: positional blanks
                      return <span key={`b${i}`} />
                    const key = dayKey(view.y, view.m, d)
                    const out = (min && key < min) || (max && key > max)
                    const isSel = key === day
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={!!out}
                        aria-pressed={isSel}
                        aria-label={new Date(
                          view.y,
                          view.m,
                          d,
                        ).toLocaleDateString(locale, {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}
                        onClick={() => pickDay(key)}
                        className={cn(
                          "mx-auto inline-flex size-9 items-center justify-center rounded-full text-sm tabular-nums transition-colors",
                          "hover:bg-muted dark:hover:bg-white/10 disabled:pointer-events-none disabled:opacity-30",
                          key === todayKey && !isSel && "border border-border",
                          isSel &&
                            "bg-muted ring-2 ring-choice ring-inset dark:bg-accent",
                        )}
                      >
                        {d}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            {type !== "date" && (
              <div
                role="listbox"
                aria-label="Time"
                className={cn(
                  "flex max-h-[19rem] w-24 flex-col gap-1 overflow-y-auto",
                  type === "datetime-local" && "border-l border-border pl-3",
                )}
              >
                {times.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="option"
                    aria-selected={t === time}
                    ref={(el) => {
                      if (el && t === time && open)
                        el.scrollIntoView({ block: "center" })
                    }}
                    onClick={() => pickTime(t)}
                    className={cn(
                      "rounded-md px-2 py-1.5 text-center text-sm tabular-nums transition-colors hover:bg-muted dark:hover:bg-white/10",
                      t === time &&
                        "bg-muted ring-2 ring-choice ring-inset dark:bg-accent",
                    )}
                  >
                    {formatTime(t, locale)}
                  </button>
                ))}
              </div>
            )}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

export { DatePicker }
