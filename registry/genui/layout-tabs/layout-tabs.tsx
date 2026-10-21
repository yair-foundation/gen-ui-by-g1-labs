"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@/components/animate-ui/components/base/tabs"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { Skeleton } from "@/components/genui/surface"

import type { LayoutTabsInput } from "./layout-tabs.schema"

type Tab = LayoutTabsInput["tabs"][number]

export type LayoutTabsProps = Partial<Omit<LayoutTabsInput, "tabs">> & {
  /** Tabs may be partial while the tool call streams. */
  tabs?: Partial<Tab>[]
  status?: "streaming" | "ready"
  /** Injected by GenUIRenderer: renders a child component from the catalog. */
  renderChild?: (child: Tab["children"][number], key: string) => React.ReactNode
  className?: string
}

/**
 * Tabs whose panels hold other GenUI components. Every panel stays mounted
 * (only hidden), so a child's state survives switching tabs.
 */
export function LayoutTabs({
  tabs = [],
  defaultTab,
  status = "ready",
  renderChild,
  className,
}: LayoutTabsProps) {
  const ready = tabs.filter(
    (t): t is Tab => typeof t.id === "string" && typeof t.label === "string",
  )
  const [value, setValue] = React.useState<string | undefined>(defaultTab)
  const active = value ?? ready[0]?.id

  if (ready.length === 0) {
    return (
      <div
        data-genui=""
        data-slot="layout-tabs"
        data-status={status}
        aria-busy
        className={className}
      >
        <Skeleton className="h-10 w-64 rounded-full" />
      </div>
    )
  }

  return (
    <Tabs
      data-genui=""
      data-slot="layout-tabs"
      data-status={status}
      value={active}
      onValueChange={(v) => setValue(String(v))}
      className={cn("gap-3", className)}
    >
      <TabsList className="h-auto min-h-9 w-full max-w-full flex-wrap">
        {ready.map((t) => (
          <TabsTab key={t.id} value={t.id}>
            {t.label}
          </TabsTab>
        ))}
      </TabsList>
      <AutoHeight deps={[active]}>
        {ready.map((t) => (
          <TabsPanel key={t.id} value={t.id} keepMounted>
            {/* Children stack with the composed-response spacing. */}
            <div className="flex flex-col gap-3 [&>[data-genui]+[data-genui]]:mt-3">
              {renderChild ? (
                (t.children ?? []).map((child, i) =>
                  renderChild(child, `${t.id}.${i}`),
                )
              ) : (
                <p className="text-sm text-muted-foreground">
                  Needs GenUIRenderer
                </p>
              )}
            </div>
          </TabsPanel>
        ))}
      </AutoHeight>
    </Tabs>
  )
}

/** Tells GenUIRenderer to pass `renderChild`. */
LayoutTabs.genuiLayout = true
