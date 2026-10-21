"use client";

import * as React from "react";
import { CircleAlertIcon } from "lucide-react";
import { MotionConfig, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  genuiType,
  Skeleton,
  Surface,
  SurfaceHeader,
  SurfaceTitle,
  genuiMotion,
} from "@/components/genui/surface";

import type { InlineAppInput, InlineAppResult } from "./inline-app.schema";
import {
  buildInlineAppDoc,
  createRateLimiter,
  hashString,
  INLINE_APP_MESSAGE,
  INLINE_APP_RESULT_INTERVAL_MS,
  INLINE_APP_SANDBOX,
  INLINE_APP_TOKENS,
  type InlineAppMessage,
  type InlineAppTheme,
  initialAppHeight,
  inlineAppTooLarge,
  parseInlineAppMessage,
  sanitizeThemeTokens,
} from "./inline-app-sandbox";

export type InlineAppStatus = "streaming" | "ready" | "error";

export type InlineAppProps = Partial<InlineAppInput> & {
  /** Lifecycle, controlled by the host. The app only runs once "ready". */
  status?: InlineAppStatus;
  /** Called when the app calls `genui.send(value)`, at most every 500 ms. */
  onResult?: (result: InlineAppResult) => void;
  /** Called when the app throws or fails to start, with a short message for logs. */
  onError?: (message: string) => void;
  /**
   * Called by the error row's Retry button, e.g. to ask the agent for a fixed
   * app. Without it, Retry reloads the same app.
   */
  onRetry?: () => void;
  /** From history: the app runs again, but its messages are not sent. */
  result?: InlineAppResult;
  className?: string;
};

type Problem = "runtime" | "start" | "navigated" | "too-large";

const problemText: Record<Problem, string> = {
  runtime: "This app hit an error",
  start: "This app couldn't start",
  navigated: "This app tried to leave its sandbox",
  "too-large": "This app is too large to run",
};

/** The host's tokens, read where the app will sit, so scoped themes carry over. */
function readHostTheme(el: Element | null): InlineAppTheme {
  const target = el ?? document.documentElement;
  const style = getComputedStyle(target);
  const raw: Record<string, string> = {};
  for (const key of INLINE_APP_TOKENS) raw[key] = style.getPropertyValue(key);
  return {
    scheme: target.closest(".dark") ? "dark" : "light",
    tokens: sanitizeThemeTokens(raw),
  };
}

export function InlineApp({
  title,
  html,
  height: heightHint,
  description,
  status: statusProp,
  onResult,
  onError,
  onRetry,
  result,
  className,
}: InlineAppProps) {
  const surfaceRef = React.useRef<HTMLElement>(null);
  const [mounted, setMounted] = React.useState(false);
  const [reload, setReload] = React.useState(0);
  const [problem, setProblem] = React.useState<{
    key: string;
    kind: Problem;
  } | null>(null);
  const limiter = React.useMemo(
    () => createRateLimiter(INLINE_APP_RESULT_INTERVAL_MS),
    [],
  );
  const descId = React.useId();
  const reported = React.useRef("");

  React.useEffect(() => setMounted(true), []);

  const source = typeof html === "string" ? html : "";
  const tooLarge = inlineAppTooLarge(source);
  const waiting = statusProp === "streaming";

  // Built once per app: theme changes are sent as messages, not a reload.
  const doc = React.useMemo(() => {
    if (!mounted || waiting || !source.trim() || tooLarge) return null;
    return buildInlineAppDoc({
      html: source,
      title: title ?? "App",
      theme: readHostTheme(surfaceRef.current),
    });
  }, [mounted, waiting, source, tooLarge, title]);
  const docHash = React.useMemo(() => (doc ? hashString(doc) : ""), [doc]);
  const frameKey = `${reload}-${docHash}`;

  const kind: Problem | null = tooLarge
    ? "too-large"
    : mounted && !waiting && !source.trim()
      ? "start"
      : problem?.key === frameKey
        ? problem.kind
        : null;
  const local = kind ? "error" : undefined;
  const status: InlineAppStatus =
    local && (statusProp === undefined || statusProp === "ready")
      ? local
      : (statusProp ?? "ready");
  const streaming = status === "streaming";
  const height = initialAppHeight(heightHint);
  // Navigation and start failures tear the frame down; runtime errors keep it.
  const showFrame =
    doc !== null && kind !== "navigated" && kind !== "start" && !streaming;

  // The first problem per app wins; repeats (an error in a loop) are dropped.
  const report = (next: Problem, message: string) => {
    if (reported.current === frameKey) return;
    reported.current = frameKey;
    setProblem({ key: frameKey, kind: next });
    onError?.(message);
  };

  const handleMessage = (msg: InlineAppMessage) => {
    if (msg.type === "result") {
      if (result === undefined && limiter(Date.now())) {
        onResult?.({ action: "message", value: msg.value });
      }
    } else if (msg.type === "error") {
      report("runtime", msg.message);
    }
  };

  const retry = () => {
    if (onRetry) return onRetry();
    setProblem(null);
    setReload((r) => r + 1);
  };

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        ref={surfaceRef}
        data-slot="inline-app"
        data-status={status}
        aria-busy={streaming}
        aria-label={title ?? "App"}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle>{title}</SurfaceTitle>
        </SurfaceHeader>

        {/* The frame body pads itself 12px; .sections apps bleed to the edges. */}
        <div className="border-t border-border">
          {showFrame ? (
            <InlineAppFrame
              key={frameKey}
              doc={doc}
              title={title ?? "App"}
              initialHeight={height}
              describedBy={description ? descId : undefined}
              onMessage={handleMessage}
              onProblem={report}
            />
          ) : (
            !kind && (
              <Skeleton
                className="m-1 rounded-[10px]"
                style={{ height: height - 8 }}
              />
            )
          )}
          {description && (
            <p id={descId} className="sr-only">
              {description}
            </p>
          )}
        </div>

        {kind && (
          <div
            role="alert"
            className="flex items-center gap-3 border-t border-border px-3 py-3"
          >
            <CircleAlertIcon
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
            <p className={cn(genuiType.body, "flex-1")}>{problemText[kind]}</p>
            {(kind !== "too-large" || onRetry) && (
              <Button size="sm" onClick={retry}>
                Retry
              </Button>
            )}
          </div>
        )}
      </Surface>
    </MotionConfig>
  );
}

/** How long the bootstrap has to say hello before the app counts as broken. */
const START_TIMEOUT_MS = 3000;

function InlineAppFrame({
  doc,
  title,
  initialHeight,
  describedBy,
  onMessage,
  onProblem,
}: {
  doc: string;
  title: string;
  initialHeight: number;
  describedBy?: string;
  onMessage: (msg: InlineAppMessage) => void;
  onProblem: (kind: Problem, message: string) => void;
}) {
  const ref = React.useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = React.useState(initialHeight);
  const loads = React.useRef(0);
  const started = React.useRef(false);
  const timer = React.useRef<number | undefined>(undefined);
  const lastTheme = React.useRef("");
  const handlers = React.useRef({ onMessage, onProblem });

  React.useEffect(() => {
    handlers.current = { onMessage, onProblem };
  });
  const pendingHeight = React.useRef<number | null>(null);
  const heightFrame = React.useRef(0);

  // Only messages from this frame's window, in the closed shape, get through.
  React.useEffect(() => {
    const onWindowMessage = (event: MessageEvent) => {
      const frame = ref.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const msg = parseInlineAppMessage(event.data);
      if (!msg) return;
      started.current = true;
      if (msg.type === "resize") {
        // However often an app reports its size, the page updates at most once a frame.
        pendingHeight.current = msg.height;
        if (!heightFrame.current) {
          heightFrame.current = window.requestAnimationFrame(() => {
            heightFrame.current = 0;
            const next = pendingHeight.current;
            if (next !== null) setHeight((h) => (h === next ? h : next));
          });
        }
      } else handlers.current.onMessage(msg);
    };
    window.addEventListener("message", onWindowMessage);
    return () => {
      window.removeEventListener("message", onWindowMessage);
      window.clearTimeout(timer.current);
      window.cancelAnimationFrame(heightFrame.current);
    };
  }, []);

  const pushTheme = React.useCallback(() => {
    const frame = ref.current;
    if (!frame?.contentWindow) return;
    const theme = readHostTheme(frame);
    const json = JSON.stringify(theme);
    if (json === lastTheme.current) return;
    lastTheme.current = json;
    // The frame's origin is opaque ("null"), so "*" is the only target. Tokens aren't secret.
    frame.contentWindow.postMessage(
      { type: INLINE_APP_MESSAGE.theme, ...theme },
      "*",
    );
  }, []);

  // Follow the host's light/dark switch without reloading the app.
  React.useEffect(() => {
    const observer = new MutationObserver(pushTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    return () => observer.disconnect();
  }, [pushTheme]);

  const handleLoad = () => {
    loads.current += 1;
    // A second load means the app navigated its frame away from our document.
    if (loads.current > 1) {
      handlers.current.onProblem("navigated", "The app navigated its frame");
      return;
    }
    lastTheme.current = "";
    pushTheme();
    timer.current = window.setTimeout(() => {
      if (!started.current) {
        handlers.current.onProblem("start", "The app's script didn't run");
      }
    }, START_TIMEOUT_MS);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={genuiMotion.fade}
    >
      <iframe
        ref={ref}
        title={title}
        sandbox={INLINE_APP_SANDBOX}
        allow=""
        referrerPolicy="no-referrer"
        srcDoc={doc}
        aria-describedby={describedBy}
        onLoad={handleLoad}
        style={{ height }}
        className={cn(
          "block w-full rounded-[10px] border-0 bg-transparent",
          "transition-[height] duration-200 ease-out motion-reduce:transition-none",
        )}
      />
    </motion.div>
  );
}
