"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A scroll area that fades every edge with more content past it, so "there's
 * more" reads without a scrollbar: the sides blend into the area's own
 * surface (`--scroller-bg`, the card by default), the top and bottom into the
 * card (black in dark mode, white in light). The top fade starts under a
 * sticky header (a `thead`, or any element marked `data-sticky-header`), and
 * the left fade after fixed leading columns (the right edge of the last
 * element marked `data-sticky-start`, e.g. their header cells), so neither
 * covers labels.
 *
 * Size the area with `className` (a max height, `flex-1`, …). With `label`
 * it's a focusable, named region, so keyboard users can scroll it.
 */
/** Px of scroll over which a fade goes from nothing to full, near each edge. */
const RAMP = 48

export function ScrollFade({
  label,
  className,
  viewportClassName,
  scrollRef,
  onScroll,
  children,
}: {
  /** Names the region and makes it reachable by keyboard. */
  label?: string
  /** The outer box: size, background (`[--scroller-bg:…] bg-[var(--scroller-bg)]`). */
  className?: string
  /** The scrolling element itself: padding, overflow direction. */
  viewportClassName?: string
  /** The scrolling element, for components that scroll it themselves. */
  scrollRef?: React.Ref<HTMLDivElement>
  onScroll?: React.UIEventHandler<HTMLDivElement>
  children: React.ReactNode
}) {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const setRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      ref.current = el
      if (typeof scrollRef === "function") scrollRef(el)
      else if (scrollRef) (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el
    },
    [scrollRef],
  )
  // Where the fades start (under a sticky header, after fixed columns).
  const [offset, setOffset] = React.useState({ header: 0, start: 0 })
  // Each fade's strength follows its distance from that edge, so it thins
  // out as you near the edge and is gone exactly when you reach it.
  // Written straight to the elements: scrolling never re-renders.
  const fades = React.useRef<Record<"left" | "right" | "top" | "bottom", HTMLDivElement | null>>({
    left: null,
    right: null,
    top: null,
    bottom: null,
  })
  const measure = React.useCallback(() => {
    const el = ref.current
    if (!el) return
    const strength = (distance: number) => String(Math.min(1, Math.max(0, distance / RAMP)))
    const f = fades.current
    if (f.left) f.left.style.opacity = strength(el.scrollLeft)
    if (f.right) f.right.style.opacity = strength(el.scrollWidth - el.clientWidth - el.scrollLeft)
    if (f.top) f.top.style.opacity = strength(el.scrollTop)
    if (f.bottom) f.bottom.style.opacity = strength(el.scrollHeight - el.clientHeight - el.scrollTop)
    const header = el.querySelector("thead, [data-sticky-header]")?.getBoundingClientRect().height ?? 0
    const left = el.getBoundingClientRect().left
    const start = Math.max(
      0,
      ...[...el.querySelectorAll("[data-sticky-start]")].map((s) => s.getBoundingClientRect().right - left),
    )
    setOffset((o) => (o.header === header && o.start === start ? o : { header, start }))
  }, [])
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    for (const child of el.children) observer.observe(child)
    // Content that grows without resizing the first child (streamed rows).
    const mutations = new MutationObserver(measure)
    mutations.observe(el, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      mutations.disconnect()
    }
  }, [measure])

  const viewport = cn(
    "min-h-0 flex-1 overflow-auto overscroll-auto",
    label && "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
    viewportClassName,
  )
  const handleScroll: React.UIEventHandler<HTMLDivElement> = (e) => {
    measure()
    onScroll?.(e)
  }
  return (
    <div className={cn("relative flex min-h-0 flex-col", className)}>
      {label ? (
        <section
          ref={setRef}
          aria-label={label}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard to scroll it
          tabIndex={0}
          onScroll={handleScroll}
          className={viewport}
        >
          {children}
        </section>
      ) : (
        <div ref={setRef} onScroll={handleScroll} className={viewport}>
          {children}
        </div>
      )}
      <div
        ref={(el) => {
          fades.current.left = el
        }}
        aria-hidden
        style={{ left: offset.start, opacity: 0 }}
        className="pointer-events-none absolute inset-y-0 w-14 bg-gradient-to-r from-[var(--scroller-bg,var(--card))] to-transparent"
      />
      <div
        ref={(el) => {
          fades.current.right = el
        }}
        aria-hidden
        style={{ opacity: 0 }}
        className="pointer-events-none absolute inset-y-0 right-0 w-14 bg-gradient-to-l from-[var(--scroller-bg,var(--card))] to-transparent"
      />
      <div
        ref={(el) => {
          fades.current.top = el
        }}
        aria-hidden
        style={{ top: offset.header, opacity: 0 }}
        className="pointer-events-none absolute inset-x-0 h-10 bg-gradient-to-b from-card to-transparent"
      />
      <div
        ref={(el) => {
          fades.current.bottom = el
        }}
        aria-hidden
        style={{ opacity: 0 }}
        className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent"
      />
    </div>
  )
}
