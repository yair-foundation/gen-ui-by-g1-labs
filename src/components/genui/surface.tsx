import type * as React from "react"

import { cn } from "@/lib/utils"
import { TooltipProvider } from "@/components/ui/tooltip"

/**
 * The shared shell for GenUI components, so a composed response reads as one
 * family: same edges, same padding, same header and footer, same loading state.
 *
 * - "card": a filled, rounded panel (a hairline edge in dark mode).
 * - "flush": no border or fill, for display content that should sit in the
 *   message like text (read-only tables, sourced answers).
 *
 * Every GenUI root carries `data-genui`, which hosts use to space stacked
 * components further apart than text and components.
 */
type SurfaceVariant = "card" | "flush"

/**
 * A flat colour tile instead of the neutral card: same in both themes, with
 * near-black ink (tokens in the theme CSS, `[data-tone]`). Pick one per card;
 * colour for data meaning stays separate.
 */
type SurfaceTone = "sage" | "sand" | "clay" | "lavender" | "ochre"

/**
 * Base UI's own open delay for a tooltip trigger, kept so the first tooltip in
 * a card opens as it did before grouping. Once one is open, its neighbours
 * open at once.
 */
const TOOLTIP_DELAY_MS = 600

function Surface({
  variant = "card",
  tone,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"section"> & {
  variant?: SurfaceVariant
  tone?: SurfaceTone
}) {
  return (
    <section
      data-genui=""
      data-variant={variant}
      data-tone={tone}
      style={
        {
          // Solid fill for sticky or highlighted regions inside the surface.
          "--surface-bg":
            variant === "card" ? "var(--card)" : "var(--background)",
          ...style,
        } as React.CSSProperties
      }
      className={cn(
        "group/surface w-full text-card-foreground",
        variant === "card" &&
          "overflow-hidden rounded-[14px] border border-border bg-card",
        className,
      )}
      {...props}
    >
      <TooltipProvider delay={TOOLTIP_DELAY_MS}>{children}</TooltipProvider>
    </section>
  )
}

/**
 * A 44px hit area for a small control, without changing how it looks (D24).
 * An invisible `::after` at least 44px each way, centred on the element, so it
 * works for any size and never shrinks a larger one. The element must be
 * positioned (`relative`, or `absolute`/`fixed`/`sticky` if it already is).
 * Leave 8px or more between neighbours so their hit areas don't overlap. The
 * shared `Button` has this built in; use this on raw `<button>`, `<a>`,
 * `<label>` and role controls.
 */
const genuiHit =
  "after:absolute after:top-1/2 after:left-1/2 after:size-full after:min-h-11 after:min-w-11 after:-translate-x-1/2 after:-translate-y-1/2"

/** Horizontal padding for any region inside a surface. Flush aligns with text. */
const surfaceInset = "px-3 group-data-[variant=flush]/surface:px-0"

/**
 * The type scale every component uses, so hierarchy reads the same across the
 * library. At most three levels per card: one display or title, body, meta.
 * - display: the answer itself (a price, a time, a count). Big, tight, tabular, in the
 *   display face (`font-figure`, Instrument Serif on the site).
 * - title: the card's name or an item's name.
 * - body: content.
 * - meta: the one quiet line (a date, a source). Use sparingly.
 * - label: field labels in dense grids.
 * - eyebrow: the small tag above a figure or a section ("Downloads"). Sentence case, never all caps.
 */
const genuiType = {
  // Halaska UI's scale (https://ui.halaska.com, MIT): 10 / 12 / 13 / 14 / 24 / 32.
  display:
    "font-figure lining-nums text-[36px] font-normal tracking-tight tabular-nums leading-[1.15]",
  title: "text-[14px] font-semibold leading-[1.6] tracking-[0.005em]",
  body: "text-[13px] leading-[1.6] tracking-[0.01em]",
  meta: "text-[13px] leading-[1.55] tracking-[0.01em] text-muted-foreground",
  label: "text-[13px] font-medium leading-[1.55] tracking-[0.01em] text-muted-foreground",
  eyebrow: "text-[10px] font-semibold leading-[1.45]",
  /** The answer figure in a form-like card (a total, a headcount): Halaska's stat. */
  stat: "font-figure lining-nums text-[28px] font-normal leading-[1.2] tracking-tight tabular-nums",
  /** A control's live readout (a slider's value): small grey mono. */
  value: "font-mono text-[13px] text-muted-foreground tabular-nums",
} as const

/**
 * The motion every component uses, so it moves as one family and there is one
 * place to change it.
 * - gentle: things that settle softly (a progress bar filling, a layout shift).
 * - snappy: small marks that pop in (a check, an indicator sliding between tabs).
 * - firm: a dragged card snapping back to its place.
 * - glide: parts sliding to a slider's position.
 * - fade: the short ease-out for rows, notices and panels arriving. A strong
 *   curve, so most of the change lands in the first frames.
 *
 * Wrap a component in `<MotionConfig reducedMotion="user">` as well; these
 * values describe the motion, that wrapper switches it off.
 */
const genuiMotion = {
  gentle: { type: "spring", stiffness: 200, damping: 30 },
  snappy: { type: "spring", stiffness: 500, damping: 30 },
  firm: { type: "spring", stiffness: 520, damping: 42 },
  glide: { type: "spring", stiffness: 380, damping: 38, mass: 0.6 },
  fade: { duration: 0.2, ease: [0.23, 1, 0.32, 1] },
} as const

function SurfaceHeader({
  className,
  ...props
}: React.ComponentProps<"header">) {
  return (
    <header
      className={cn("flex flex-col gap-1 py-3", surfaceInset, className)}
      {...props}
    />
  )
}

function SurfaceTitle({
  className,
  children,
  ...props
}: React.ComponentProps<"h3">) {
  if (!children) return <Skeleton className="h-6 w-48" />
  return (
    <h3
      className={cn(genuiType.title, "text-[17px] leading-[1.35]", className)}
      {...props}
    >
      {children}
    </h3>
  )
}

function SurfaceDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return <p className={cn(genuiType.meta, className)} {...props} />
}

function SurfaceFooter({
  className,
  ...props
}: React.ComponentProps<"footer">) {
  return (
    <footer
      className={cn(
        "flex flex-wrap items-center gap-2 border-t py-3",
        surfaceInset,
        className,
      )}
      {...props}
    />
  )
}

/** The one loading placeholder. Decorative, so hidden from assistive tech. */
function Skeleton({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      className={cn(
        "block animate-pulse rounded-md bg-muted motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  )
}

export {
  Surface,
  SurfaceHeader,
  SurfaceTitle,
  SurfaceDescription,
  SurfaceFooter,
  Skeleton,
  genuiType,
  genuiMotion,
  surfaceInset,
  genuiHit,
  type SurfaceVariant,
  type SurfaceTone,
}
