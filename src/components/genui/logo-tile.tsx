"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A brand logo in a tile beside a name (the brand logo rule in
 * docs/design/components.md). The tile always has a hairline neutral border,
 * so its edge shows on any card in both themes, even when the logo file
 * brings its own white background.
 *
 * - `fit="mark"` (default): a mark sits inside 10px of padding, contained.
 * - `fit="full"`: a logo that is already a tile (an app icon, a badge on its
 *   own background) fills it edge to edge.
 * - `tone="white"` (default) is white in both themes; with a `darkSrc` it
 *   turns into a faint dark tile in dark mode and swaps to the dark file.
 *   `tone="muted"` is the theme's muted grey.
 *
 * Brand logos only, never photos or product thumbnails. Only http(s) URLs,
 * same-origin paths and raster data URLs load; an unsafe, missing or failing logo renders
 * `fallback` (nothing by default), never a broken image.
 */
export type LogoTileSize = 44 | 48 | 56 | 64

const SIZE: Record<LogoTileSize, string> = {
  44: "size-11 rounded-[10px]",
  48: "size-12 rounded-[10px]",
  56: "size-14 rounded-[14px]",
  64: "size-16 rounded-[14px]",
}

/** http(s), a same-origin path with a single leading slash, or a raster data:image. */
function safeLogoSrc(src: string | null | undefined): string | null {
  if (typeof src !== "string") return null
  const s = src.trim()
  if (/^\/(?![/\\])/.test(s)) return s
  if (/^data:image\/(png|jpe?g|gif|webp|avif);/i.test(s)) return s
  try {
    const u = new URL(s)
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null
  } catch {
    return null
  }
}

export function LogoTile({
  src,
  darkSrc,
  alt = "",
  size = 44,
  fit = "mark",
  tone = "white",
  fallback = null,
  className,
}: {
  src?: string | null
  /** A version for dark mode, when the brand has one. */
  darkSrc?: string | null
  /** Empty (the default) when the name is shown beside the tile. */
  alt?: string
  size?: LogoTileSize
  fit?: "mark" | "full"
  tone?: "white" | "muted"
  fallback?: React.ReactNode
  className?: string
}) {
  const light = safeLogoSrc(src)
  const dark = safeLogoSrc(darkSrc)
  const [failed, setFailed] = React.useState<string | null>(null)

  if (!light || failed === light || (dark && failed === dark)) {
    return <>{fallback}</>
  }

  const img = (url: string, extra?: string) => (
    // biome-ignore lint/performance/noImgElement: provider-supplied logo; next/image would need every host configured
    <img
      src={url}
      alt={alt}
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(url)}
      className={cn(
        "size-full",
        fit === "full" ? "object-cover" : "object-contain",
        extra,
      )}
    />
  )

  return (
    <span
      aria-hidden={alt ? undefined : true}
      data-slot="logo-tile"
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden ring-1 ring-border",
        SIZE[size],
        fit === "mark" && "p-2.5",
        tone === "muted" ? "bg-muted" : cn("bg-white", dark && "dark:bg-white/[0.08]"),
        className,
      )}
    >
      {dark ? (
        <>
          {img(light, "dark:hidden")}
          {img(dark, "hidden dark:block")}
        </>
      ) : (
        img(light)
      )}
    </span>
  )
}
