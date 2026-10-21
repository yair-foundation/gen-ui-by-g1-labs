"use client";

import * as React from "react";
import {
  CheckIcon,
  CopyIcon,
  PencilIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { MotionConfig, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height";
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WhyDisabled } from "@/components/genui/hint";
import { useGenUILocale } from "@/components/genui/locale";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface";

import {
  addTags,
  diffStats,
  diffWords,
  documentToMarkdown,
  type EditState,
  editedIds,
  editFor,
  emptyEditState,
  type FieldValue,
  fieldLength,
  type InlineNode,
  layoutSection,
  mapRenderedRange,
  normalizeEditedText,
  plural,
  resetAll,
  type SectionLayout,
  type SourceSelection,
  sealHistory,
  setEdit,
  toPlainText,
  undo,
  dropEdits,
  validateField,
  validateSectionText,
} from "./inline-editor-utils";
import type {
  InlineEditorField,
  InlineEditorInput,
  InlineEditorResult,
  InlineEditorSection,
} from "./inline-editor.schema";

export type InlineEditorStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "saved"
  | "discarded";

type PartialField = Partial<InlineEditorField>;
type ReadyField = PartialField & {
  id: string;
  label: string;
  type: InlineEditorField["type"];
};

export type InlineEditorProps = Partial<
  Omit<InlineEditorInput, "sections" | "fields">
> & {
  /** Sections may be partial while the tool call streams. */
  sections?: Partial<InlineEditorSection>[];
  /** Fields may be partial while the tool call streams. */
  fields?: PartialField[];
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props; 'submitting' while the host saves the result.
   * When omitted, the component tracks the user's decision itself.
   */
  status?: InlineEditorStatus;
  /**
   * Called with 'save' or 'discard' (once, then the editor locks) and with
   * 'rewrite' (any number of times; the editor stays open). Reply to a
   * rewrite by passing new `sections` in which that section's text changed.
   */
  onResult?: (result: InlineEditorResult) => void;
  /**
   * A result from history. 'save' restores the final version read-only,
   * 'discard' the original; never calls onResult.
   */
  result?: InlineEditorResult;
  className?: string;
};

const DEFAULT_INSTRUCTIONS = ["Shorter", "More formal", "Fix grammar"];

type Toolbar = SourceSelection & {
  sectionId: string;
  top: number;
  left: number;
};
type Panel = { sectionId: string; selection?: SourceSelection; auto?: boolean };

// ---- DOM selection → source range -------------------------------------------

function proseOf(node: Node | null) {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  return el?.closest<HTMLElement>("[data-inline-editor-prose]") ?? null;
}

/** Characters of rendered text between the start of `root` and a DOM point. */
function offsetIn(root: HTMLElement, node: Node, offset: number) {
  const range = document.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(node, offset);
  } catch {
    return 0;
  }
  return range.toString().length;
}

/** The current selection, if it lies inside one section's prose. */
function readSelection(
  root: HTMLElement | null,
  textOf: (id: string) => string | undefined,
): Toolbar | null {
  const sel = typeof window === "undefined" ? null : window.getSelection();
  if (!root || !sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const prose = proseOf(range.startContainer);
  if (!prose || prose !== proseOf(range.endContainer)) return null;
  if (!root.contains(prose)) return null;
  const sectionId = prose.dataset.sectionId;
  const text = sectionId ? textOf(sectionId) : undefined;
  if (!sectionId || text === undefined) return null;
  const mapped = mapRenderedRange(
    text,
    layoutSection(text),
    offsetIn(prose, range.startContainer, range.startOffset),
    offsetIn(prose, range.endContainer, range.endOffset),
  );
  const box = prose.closest<HTMLElement>("[data-slot=inline-editor-section]");
  if (!mapped || !box) return null;
  // Anchor the toolbar above the selection, or below it near the top edge.
  const rect = range.getBoundingClientRect();
  const outer = box.getBoundingClientRect();
  const center = rect.left + rect.width / 2 - outer.left;
  const left = Math.min(Math.max(center, 88), Math.max(88, outer.width - 88));
  const above = rect.top - outer.top;
  const top = above >= 40 ? above - 36 : rect.bottom - outer.top + 6;
  return { ...mapped, sectionId, top, left };
}

// ---- Rendering ----------------------------------------------------------------

function renderText(
  node: Extract<InlineNode, { type: "text" }>,
  highlight: [number, number] | null,
) {
  const key = `t${node.start}`;
  const end = node.start + node.value.length;
  const a = highlight ? Math.max(node.start, highlight[0]) : 0;
  const b = highlight ? Math.min(end, highlight[1]) : 0;
  if (!highlight || a >= b) {
    return <React.Fragment key={key}>{node.value}</React.Fragment>;
  }
  return (
    <React.Fragment key={key}>
      {node.value.slice(0, a - node.start)}
      <mark className="rounded-sm bg-foreground/10 text-foreground">
        {node.value.slice(a - node.start, b - node.start)}
      </mark>
      {node.value.slice(b - node.start)}
    </React.Fragment>
  );
}

function renderNodes(
  nodes: InlineNode[],
  highlight: [number, number] | null,
): React.ReactNode[] {
  return nodes.map((n) => {
    if (n.type === "text") return renderText(n, highlight);
    const children = renderNodes(n.children, highlight);
    return n.type === "strong" ? (
      <strong key={`s${n.outer[0]}`} className="font-semibold">
        {children}
      </strong>
    ) : (
      <em key={`e${n.outer[0]}`}>{children}</em>
    );
  });
}

/**
 * The section as prose. Only source text goes inside this element (no
 * screen-reader-only extras), so rendered offsets map back to the source.
 */
function Prose({
  layout,
  sectionId,
  highlight,
}: {
  layout: SectionLayout;
  sectionId: string;
  highlight: [number, number] | null;
}) {
  return (
    <div
      data-inline-editor-prose=""
      data-section-id={sectionId}
      className="flex flex-col gap-2 text-[13px] leading-relaxed break-words"
    >
      {layout.blocks.map((b) => {
        if (b.type === "paragraph") {
          return (
            <p key={`p${b.start}`}>
              {b.lines.map((line, i) => (
                <React.Fragment key={`l${line.start}`}>
                  {i > 0 && <br />}
                  {renderNodes(line.nodes, highlight)}
                </React.Fragment>
              ))}
            </p>
          );
        }
        const List = b.ordered ? "ol" : "ul";
        return (
          <List
            key={`b${b.start}`}
            className={cn(
              "flex flex-col gap-1 pl-5",
              b.ordered ? "list-decimal" : "list-disc",
            )}
          >
            {b.items.map((item) => (
              <li key={`i${item.start}`}>
                {renderNodes(item.nodes, highlight)}
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

function ChangesView({ before, after }: { before: string; after: string }) {
  const parts = diffWords(toPlainText(before), toPlainText(after));
  const stats = diffStats(parts);
  return (
    <div className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
      <span className="sr-only">
        {`Changes from the original: ${plural(stats.added, "word")} added, ${plural(stats.removed, "word")} removed. `}
      </span>
      {parts.map((p, i) => {
        const Tag =
          p.type === "added" ? "ins" : p.type === "removed" ? "del" : "span";
        return (
          <Tag
            // biome-ignore lint/suspicious/noArrayIndexKey: diff parts are positional
            key={i}
            className={cn(
              p.type === "added" &&
                "font-medium text-foreground underline decoration-foreground/40 underline-offset-[3px]",
              p.type === "removed" && "text-muted-foreground line-through",
            )}
          >
            {p.type !== "equal" && (
              <span className="sr-only">
                {p.type === "added" ? "added: " : "removed: "}
              </span>
            )}
            {p.text}
          </Tag>
        );
      })}
    </div>
  );
}

/** Grows with its content; falls back to measuring where field-sizing isn't supported. */
function AutoGrowTextarea({
  value,
  className,
  ...props
}: React.ComponentProps<typeof Textarea> & { value: string }) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  // Caret at the end when the editor opens.
  React.useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement === el) {
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the value changes
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el || CSS.supports?.("field-sizing", "content")) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <Textarea
      ref={ref}
      value={value}
      className={cn("min-h-16 resize-none leading-relaxed", className)}
      {...props}
    />
  );
}

function RewritePanel({
  name,
  selection,
  instructions,
  autoFocus,
  onSubmit,
  onClose,
}: {
  name: string;
  selection?: SourceSelection;
  instructions: string[];
  autoFocus: boolean;
  onSubmit: (instruction: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = React.useState("");
  const quote = selection ? toPlainText(selection.text) : "";
  return (
    <motion.div
      role="group"
      aria-label={`Rewrite ${name}`}
      data-slot="inline-editor-rewrite"
      initial={{ opacity: 0, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className="mt-3 flex flex-col gap-3 rounded-[10px] border border-border bg-background p-3"
    >
      {selection && (
        <p className={cn(genuiType.meta, "line-clamp-2")}>
          <span className="sr-only">Rewrite the selected text: </span>
          <q className="text-foreground">{quote}</q>
        </p>
      )}
      {instructions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {instructions.map((instruction) => (
            <Button
              key={instruction}
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onSubmit(instruction)}
            >
              {instruction}
            </Button>
          ))}
        </div>
      )}
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onSubmit(text.trim());
        }}
      >
        <Input
          autoFocus={autoFocus}
          aria-label={`What should change in ${name}?`}
          placeholder="Or say what to change"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="flex-1"
        />
        <div className="flex gap-2">
          <WhyDisabled when={!text.trim()} reason="Describe the change first">
            <Button type="submit" size="sm" disabled={!text.trim()}>
              Rewrite
            </Button>
          </WhyDisabled>
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </motion.div>
  );
}

// ---- Text mode: one section -------------------------------------------------

type SectionViewProps = {
  section: InlineEditorSection;
  name: string;
  headingId: string;
  editorId: string;
  text: string;
  original: string;
  edited: boolean;
  partial: boolean;
  interactive: boolean;
  canRewrite: boolean;
  pending: boolean;
  focused: boolean;
  flash: number;
  draft: string | undefined;
  draftError: string | undefined;
  showDiff: boolean;
  canToggleDiff: boolean;
  panel: Panel | null;
  toolbar: Toolbar | null;
  instructions: string[];
  setEditButton: (el: HTMLButtonElement | null) => void;
  setRewriteButton: (el: HTMLButtonElement | null) => void;
  onEdit: () => void;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onRevert: () => void;
  onToggleDiff: () => void;
  onRewriteClick: () => void;
  onToolbarRewrite: () => void;
  onPanelSubmit: (instruction: string) => void;
  onPanelClose: () => void;
};

function SectionView({
  section,
  name,
  headingId,
  editorId,
  text,
  original,
  edited,
  partial,
  interactive,
  canRewrite,
  pending,
  focused,
  flash,
  draft,
  draftError,
  showDiff,
  canToggleDiff,
  panel,
  toolbar,
  instructions,
  setEditButton,
  setRewriteButton,
  onEdit,
  onDraftChange,
  onSave,
  onCancel,
  onRevert,
  onToggleDiff,
  onRewriteClick,
  onToolbarRewrite,
  onPanelSubmit,
  onPanelClose,
}: SectionViewProps) {
  const layout = React.useMemo(
    () => layoutSection(text, partial),
    [text, partial],
  );
  const editing = draft !== undefined;
  const highlight: [number, number] | null = panel?.selection
    ? [panel.selection.start, panel.selection.end]
    : null;
  const hintId = `${editorId}-hint`;
  const errorId = `${editorId}-error`;

  return (
    <motion.section
      data-slot="inline-editor-section"
      data-section-id={section.id}
      data-edited={edited || undefined}
      data-focused={focused || undefined}
      data-pending={pending || undefined}
      aria-labelledby={section.heading ? headingId : undefined}
      aria-label={section.heading ? undefined : name}
      aria-busy={pending || undefined}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={genuiMotion.fade}
      className={cn(
        "group/section relative px-3 py-2.5",
        focused && interactive && "bg-muted",
      )}
    >
      {flash > 0 && (
        // The agent just rewrote this section: a brief wash that fades out.
        <motion.span
          key={flash}
          aria-hidden
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 1.4, ease: "easeOut" }}
          className="pointer-events-none absolute inset-0 bg-muted"
        />
      )}

      {(section.heading || edited || pending) && (
        <div className="relative mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {section.heading && (
            <h4 id={headingId} className="text-[13px] font-semibold">
              {section.heading}
            </h4>
          )}
          {edited && <Badge variant="outline">Edited</Badge>}
          {edited && canToggleDiff && !editing && (
            <Button
              size="xs"
              variant="ghost"
              aria-pressed={showDiff}
              aria-label={`${showDiff ? "Hide" : "Show"} changes in ${name}`}
              onClick={onToggleDiff}
            >
              {showDiff ? "Hide changes" : "Show changes"}
            </Button>
          )}
          {pending && (
            <span className="text-[13px]">
              <ShimmeringText
                text="Rewriting…"
                color="var(--muted-foreground)"
                shimmeringColor="var(--foreground)"
              />
            </span>
          )}
        </div>
      )}

      {editing ? (
        <div className="relative flex flex-col gap-2">
          <AutoGrowTextarea
            id={editorId}
            autoFocus
            aria-label={`Edit ${name}`}
            aria-describedby={draftError ? `${hintId} ${errorId}` : hintId}
            aria-invalid={draftError ? true : undefined}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onSave();
              }
            }}
          />
          {draftError && (
            <p id={errorId} className="text-[13px] text-destructive">
              {draftError}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={onSave}>
              Save
            </Button>
            <Button size="sm" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <span id={hintId} className="sr-only">
              Control or Command plus Enter saves, Escape cancels. Use double
              asterisks for bold, single asterisks for italic, and a dash for
              lists.
            </span>
          </div>
        </div>
      ) : (
        <motion.div
          key={flash}
          initial={{ opacity: flash > 0 ? 0.4 : 1 }}
          animate={{ opacity: pending ? 0.6 : 1 }}
          transition={{ duration: 0.4 }}
          className="relative"
        >
          {showDiff && edited ? (
            <ChangesView before={original} after={text} />
          ) : (
            <Prose
              layout={layout}
              sectionId={section.id}
              highlight={highlight}
            />
          )}
        </motion.div>
      )}

      {toolbar && interactive && !editing && (
        <div
          className="absolute z-20 -translate-x-1/2"
          style={{ top: toolbar.top, left: toolbar.left }}
        >
          <Button
            size="sm"
            variant="secondary"
            className="bg-popover shadow-sm dark:shadow-none"
            // Keep the text selected while pressing the button.
            onMouseDown={(e) => e.preventDefault()}
            onClick={onToolbarRewrite}
          >
            <RefreshCwIcon aria-hidden />
            Rewrite selection
          </Button>
        </div>
      )}

      {interactive && !editing && (
        <div
          className={cn(
            "absolute -top-5 right-3 z-10 flex gap-0.5 rounded-full border bg-popover p-1 shadow-xs dark:shadow-none transition-opacity",
            "pointer-events-none opacity-0 group-focus-within/section:pointer-events-auto group-focus-within/section:opacity-100 group-hover/section:pointer-events-auto group-hover/section:opacity-100",
            // No hover on touch screens: always show, below the text.
            "[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:static [@media(hover:none)]:mt-2 [@media(hover:none)]:w-fit [@media(hover:none)]:opacity-100",
            (focused || panel) && "pointer-events-auto opacity-100",
          )}
        >
          <Button
            ref={setEditButton}
            size="sm"
            variant="secondary"
            aria-label={`Edit ${name}`}
            disabled={pending}
            onClick={onEdit}
          >
            <PencilIcon aria-hidden />
            Edit
          </Button>
          {canRewrite && (
            <Button
              ref={setRewriteButton}
              size="sm"
              variant="secondary"
              aria-label={`Rewrite ${name}`}
              aria-expanded={Boolean(panel)}
              disabled={pending}
              // Keep a text selection alive so the rewrite can target it.
              onMouseDown={(e) => e.preventDefault()}
              onClick={onRewriteClick}
            >
              <RefreshCwIcon aria-hidden />
              Rewrite
            </Button>
          )}
          {edited && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Revert ${name} to the original`}
                    disabled={pending}
                    onClick={onRevert}
                    className="hover:bg-muted dark:hover:bg-white/10"
                  />
                }
              >
                <RotateCcwIcon aria-hidden />
              </TooltipTrigger>
              <TooltipContent>{`Revert ${name} to the original`}</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}

      {panel && interactive && !editing && !pending && (
        <RewritePanel
          name={name}
          selection={panel.selection}
          instructions={instructions}
          autoFocus={!panel.auto}
          onSubmit={onPanelSubmit}
          onClose={onPanelClose}
        />
      )}
    </motion.section>
  );
}

// ---- Fields mode ---------------------------------------------------------------

function RequiredMark() {
  return (
    <span aria-hidden className="text-muted-foreground">
      {" "}
      *
    </span>
  );
}

function emptyValue(type: InlineEditorField["type"]): FieldValue {
  if (type === "tags") return [];
  if (type === "number") return null;
  return "";
}

function displayValue(value: FieldValue, locale: string) {
  if (value === null || value === "") return null;
  if (Array.isArray(value)) return value.length ? value.join(", ") : null;
  if (typeof value === "number")
    return new Intl.NumberFormat(locale).format(value);
  return value;
}

function TagInput({
  id,
  label,
  tags,
  options,
  disabled,
  invalid,
  describedBy,
  onChange,
  onBlur,
}: {
  id: string;
  label: string;
  tags: string[];
  options?: string[];
  disabled: boolean;
  invalid: boolean;
  describedBy: string | undefined;
  onChange: (tags: string[]) => void;
  onBlur: () => void;
}) {
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listId = `${id}-suggestions`;
  const commit = () => {
    if (!draft.trim()) return;
    onChange(addTags(tags, draft));
    setDraft("");
  };
  return (
    <div
      className={cn(
        "flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-transparent bg-transparent px-1.5 py-1.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:focus-within:border-ring",
        !invalid && "border-border",
        invalid &&
          "border-destructive ring-3 ring-destructive/20 dark:border-destructive/50",
        disabled && "opacity-50",
      )}
    >
      {tags.length > 0 && (
        <ul
          aria-label={`${label}, ${plural(tags.length, "tag")}`}
          className="flex flex-wrap gap-1.5"
        >
          {tags.map((tag) => (
            <li
              key={tag}
              className="inline-flex h-7 items-center rounded-full border border-border bg-background pl-3 text-[13px] text-foreground"
            >
              {tag}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={`Remove ${tag} from ${label}`}
                      onClick={() => {
                        onChange(tags.filter((t) => t !== tag));
                        inputRef.current?.focus();
                      }}
                      className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-white/10"
                    />
                  }
                >
                  <XIcon aria-hidden className="size-3" />
                </TooltipTrigger>
                <TooltipContent>{`Remove ${tag} from ${label}`}</TooltipContent>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={inputRef}
        id={id}
        list={options?.length ? listId : undefined}
        value={draft}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        placeholder={tags.length ? "Add another" : "Add a tag"}
        onChange={(e) => {
          const v = e.target.value;
          if (v.includes(",")) {
            onChange(addTags(tags, v));
            setDraft("");
          } else {
            setDraft(v);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !draft && tags.length) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={() => {
          commit();
          onBlur();
        }}
        className="h-7 min-w-28 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed md:text-[14px]"
      />
      {options?.length ? (
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}

function FieldControl({
  field,
  controlId,
  labelId,
  describedBy,
  value,
  invalid,
  disabled,
  onChange,
  onBlur,
}: {
  field: ReadyField;
  controlId: string;
  labelId: string;
  describedBy: string | undefined;
  value: FieldValue;
  invalid: boolean;
  disabled: boolean;
  onChange: (value: FieldValue, typing: boolean) => void;
  onBlur: () => void;
}) {
  const common = {
    id: controlId,
    disabled,
    "aria-invalid": invalid || undefined,
    "aria-describedby": describedBy,
    "aria-required": field.required || undefined,
  };
  const text = typeof value === "string" ? value : "";
  switch (field.type) {
    case "textarea":
      return (
        <AutoGrowTextarea
          {...common}
          value={text}
          onChange={(e) => onChange(e.target.value, true)}
          onBlur={onBlur}
          className="min-h-20"
        />
      );
    case "number":
      return (
        <Input
          {...common}
          type="number"
          inputMode="decimal"
          value={typeof value === "number" ? String(value) : ""}
          onChange={(e) =>
            onChange(
              e.target.value === "" ? null : Number(e.target.value),
              true,
            )
          }
          onBlur={onBlur}
          className="w-full sm:w-40"
        />
      );
    case "select": {
      const options = field.options ?? [];
      if (!options.length)
        return <Skeleton className="h-10 w-48 rounded-full" />;
      return (
        <Select
          value={text === "" ? null : text}
          onValueChange={(v) => onChange(typeof v === "string" ? v : "", false)}
          items={options.map((o) => ({ value: o, label: o }))}
          disabled={disabled}
        >
          <SelectTrigger
            {...common}
            aria-labelledby={labelId}
            className="w-full sm:w-64"
          >
            <SelectValue placeholder="Choose an option" />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    case "tags":
      return (
        <TagInput
          id={controlId}
          label={field.label}
          tags={Array.isArray(value) ? value : []}
          options={field.options}
          disabled={disabled}
          invalid={invalid}
          describedBy={describedBy}
          onChange={(tags) => onChange(tags, false)}
          onBlur={onBlur}
        />
      );
    default:
      return (
        <Input
          {...common}
          value={text}
          onChange={(e) => onChange(e.target.value, true)}
          onBlur={onBlur}
        />
      );
  }
}

// ---- The editor -----------------------------------------------------------------

export function InlineEditor({
  title,
  mode: modeProp,
  sections = [],
  fields = [],
  allowAiRewrite = true,
  instructions,
  focusSectionId,
  status: statusProp,
  onResult,
  result,
  className,
}: InlineEditorProps) {
  const locale = useGenUILocale();
  const baseId = React.useId();
  const rootRef = React.useRef<HTMLElement>(null);
  const saved = result?.action === "save" ? result : null;

  // Edits and their undo history. Restored from a saved result.
  const [textState, setTextState] = React.useState<EditState<string>>(() =>
    emptyEditState(
      Object.fromEntries(
        (saved?.sections ?? [])
          .filter((s) => saved?.edited.includes(s.id))
          .map((s) => [s.id, s.text]),
      ),
    ),
  );
  const [fieldState, setFieldState] = React.useState<EditState<FieldValue>>(
    () =>
      emptyEditState(
        Object.fromEntries(
          Object.entries(saved?.fields ?? {}).filter(([id]) =>
            saved?.edited.includes(id),
          ),
        ),
      ),
  );
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [draftErrors, setDraftErrors] = React.useState<Record<string, string>>(
    {},
  );
  const [diffOn, setDiffOn] = React.useState<Set<string>>(() => new Set());
  const [panel, setPanel] = React.useState<Panel | null>(null);
  const [toolbar, setToolbar] = React.useState<Toolbar | null>(null);
  const [pending, setPending] = React.useState<Set<string>>(() => new Set());
  const [flash, setFlash] = React.useState<Record<string, number>>({});
  const [announcement, setAnnouncement] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const [touched, setTouched] = React.useState<Set<string>>(() => new Set());
  const [attempted, setAttempted] = React.useState(false);
  const [decision, setDecision] = React.useState<"saved" | "discarded" | null>(
    () =>
      result?.action === "save"
        ? "saved"
        : result?.action === "discard"
          ? "discarded"
          : null,
  );
  const editButtons = React.useRef(new Map<string, HTMLButtonElement>());
  const rewriteButtons = React.useRef(new Map<string, HTMLButtonElement>());

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: InlineEditorStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready");
  const streaming = status === "streaming";
  const final = status === "saved" || status === "discarded";
  // A result from history never calls onResult again, so nothing is editable.
  const interactive = status === "ready" && result === undefined;
  const mode =
    modeProp ?? (fields.length && !sections.length ? "fields" : "text");
  const chips = instructions?.length ? instructions : DEFAULT_INSTRUCTIONS;
  const canRewrite = allowAiRewrite !== false && mode === "text";

  const readySections = sections.filter(
    (s): s is InlineEditorSection =>
      typeof s.id === "string" && typeof s.text === "string",
  );
  const readyFields = fields.filter(
    (f): f is ReadyField =>
      typeof f.id === "string" &&
      typeof f.label === "string" &&
      typeof f.type === "string",
  );
  const sectionIds = readySections.map((s) => s.id);
  const fieldIds = readyFields.map((f) => f.id);

  const textOf = (s: InlineEditorSection) =>
    status === "discarded"
      ? s.text
      : s.id in textState.edits
        ? textState.edits[s.id]
        : s.text;
  const originalField = (f: ReadyField): FieldValue =>
    f.value === undefined ? emptyValue(f.type) : f.value;
  const fieldValue = (f: ReadyField): FieldValue =>
    status !== "discarded" && f.id in fieldState.edits
      ? fieldState.edits[f.id]
      : originalField(f);
  const nameOf = (s: InlineEditorSection, index: number) =>
    s.heading ?? `section ${index + 1}`;

  const edited =
    mode === "text"
      ? editedIds(textState, sectionIds)
      : editedIds(fieldState, fieldIds);
  const history = mode === "text" ? textState.history : fieldState.history;

  // Latest values for the document-level selection listener.
  const latest = React.useRef({ readySections, textOf });
  latest.current = { readySections, textOf };

  // ---- Text selection → floating "Rewrite selection" toolbar.
  const selectable = interactive && canRewrite;
  React.useEffect(() => {
    if (!selectable) {
      setToolbar(null);
      return;
    }
    let frame = 0;
    const textById = (id: string) => {
      const s = latest.current.readySections.find((x) => x.id === id);
      return s ? latest.current.textOf(s) : undefined;
    };
    const onChange = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setToolbar(readSelection(rootRef.current, textById)),
      );
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (readSelection(rootRef.current, textById)) {
        window.getSelection()?.removeAllRanges();
        setToolbar(null);
      }
    };
    document.addEventListener("selectionchange", onChange);
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", onChange);
      document.removeEventListener("keydown", onKey);
    };
  }, [selectable]);

  // ---- The host replied with new props: animate changed sections and drop
  // their local edits (the agent's version wins); other edits stay.
  const signature = JSON.stringify(readySections.map((s) => [s.id, s.text]));
  const baseline = React.useRef<Record<string, string> | null>(null);
  React.useEffect(() => {
    if (streaming) return;
    const next: Record<string, string> = Object.fromEntries(
      JSON.parse(signature) as [string, string][],
    );
    const prev = baseline.current;
    baseline.current = next;
    if (!prev) return;
    const changed = Object.keys(next).filter(
      (id) => id in prev && prev[id] !== next[id],
    );
    // Any reply ends the wait, even when the text came back unchanged.
    setPending((p) => (p.size ? new Set() : p));
    if (!changed.length) return;
    const without = <T,>(r: Record<string, T>) =>
      Object.fromEntries(
        Object.entries(r).filter(([k]) => !changed.includes(k)),
      );
    setTextState((s) => changed.reduce((acc, id) => dropEdits(acc, id), s));
    setDrafts(without);
    setDraftErrors(without);
    setDiffOn((d) => new Set([...d].filter((id) => !changed.includes(id))));
    setPanel((p) => (p && changed.includes(p.sectionId) ? null : p));
    setFlash((f) => {
      const out = { ...f };
      for (const id of changed) out[id] = (out[id] ?? 0) + 1;
      return out;
    });
    setAnnouncement(
      changed.length === 1
        ? "A section was rewritten."
        : `${changed.length} sections were rewritten.`,
    );
  }, [signature, streaming]);

  // ---- focusSectionId: open that section's rewrite panel once it's ready.
  const autoOpened = React.useRef(false);
  const focusReady =
    !!focusSectionId && readySections.some((s) => s.id === focusSectionId);
  React.useEffect(() => {
    if (autoOpened.current || !focusSectionId || !focusReady) return;
    if (!interactive || !canRewrite) return;
    autoOpened.current = true;
    setPanel({ sectionId: focusSectionId, auto: true });
  }, [focusSectionId, focusReady, interactive, canRewrite]);

  React.useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  const focusLater = (el: () => HTMLElement | null | undefined) =>
    requestAnimationFrame(() => el()?.focus());

  // ---- Text mode actions.
  const startEdit = (s: InlineEditorSection) => {
    setDrafts((d) => ({ ...d, [s.id]: textOf(s) }));
    setDiffOn((d) => {
      const n = new Set(d);
      n.delete(s.id);
      return n;
    });
    setPanel((p) => (p?.sectionId === s.id ? null : p));
  };
  const closeDraft = (id: string) => {
    setDrafts(({ [id]: _, ...rest }) => rest);
    setDraftErrors(({ [id]: _, ...rest }) => rest);
    focusLater(() => editButtons.current.get(id));
  };
  const saveDraft = (s: InlineEditorSection) => {
    const value = normalizeEditedText(drafts[s.id] ?? "");
    const error = validateSectionText(value);
    if (error) {
      setDraftErrors((e) => ({ ...e, [s.id]: error }));
      return;
    }
    setTextState((st) => setEdit(st, s.id, editFor(value, s.text)));
    closeDraft(s.id);
  };

  const requestRewrite = (
    s: InlineEditorSection,
    index: number,
    instruction: string,
    selection?: SourceSelection,
  ) => {
    if (!interactive) return;
    onResult?.({
      action: "rewrite",
      sectionId: s.id,
      text: textOf(s),
      ...(selection ? { selection } : {}),
      instruction,
      edits: readySections
        .filter((x) => x.id in textState.edits)
        .map((x) => ({ id: x.id, text: textState.edits[x.id] })),
    });
    setPending((p) => new Set(p).add(s.id));
    setPanel(null);
    setAnnouncement(
      `Asked for a rewrite of ${nameOf(s, index)}: ${instruction}.`,
    );
  };

  // ---- Fields mode actions.
  const touch = (id: string) =>
    setTouched((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  const controlId = (id: string) => `${baseId}-field-${id}`;

  // ---- Shared actions.
  const undoLast = () => {
    if (!interactive || !history.length) return;
    if (mode === "text") setTextState(undo);
    else setFieldState((s) => undo(sealHistory(s)));
    setAnnouncement("Undid the last edit.");
  };
  const resetEverything = () => {
    if (!interactive || !edited.length) return;
    if (mode === "text") setTextState(resetAll);
    else setFieldState((s) => resetAll(sealHistory(s)));
    setAnnouncement("All edits reset to the original.");
  };

  const save = () => {
    if (!interactive) return;
    if (mode === "text") {
      // Open editors are saved too.
      let state = textState;
      const errors: Record<string, string> = {};
      for (const s of readySections) {
        if (!(s.id in drafts)) continue;
        const value = normalizeEditedText(drafts[s.id]);
        const error = validateSectionText(value);
        if (error) errors[s.id] = error;
        else state = setEdit(state, s.id, editFor(value, s.text));
      }
      const firstError = readySections.find((s) => s.id in errors);
      if (firstError) {
        setDraftErrors(errors);
        document.getElementById(`${baseId}-edit-${firstError.id}`)?.focus();
        return;
      }
      setTextState(state);
      setDrafts({});
      setPanel(null);
      setDecision("saved");
      onResult?.({
        action: "save",
        sections: readySections.map((s) => ({
          id: s.id,
          text: s.id in state.edits ? state.edits[s.id] : s.text,
        })),
        edited: editedIds(state, sectionIds),
      });
    } else {
      setAttempted(true);
      const firstInvalid = readyFields.find((f) =>
        validateField(f, fieldValue(f)),
      );
      if (firstInvalid) {
        document.getElementById(controlId(firstInvalid.id))?.focus();
        return;
      }
      setDecision("saved");
      onResult?.({
        action: "save",
        fields: Object.fromEntries(
          readyFields.map((f) => [f.id, fieldValue(f)]),
        ),
        edited,
      });
    }
  };

  const discard = () => {
    if (!interactive) return;
    setDrafts({});
    setPanel(null);
    setDecision("discarded");
    onResult?.({ action: "discard" });
  };

  const markdown = () =>
    documentToMarkdown(
      title,
      readySections.map((s) => ({ heading: s.heading, text: textOf(s) })),
    );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown());
      setCopied(true);
      setAnnouncement("Copied as Markdown.");
    } catch {
      setAnnouncement("Couldn't copy. Select the text and copy it instead.");
    }
  };

  const invalidCount =
    mode === "fields" && attempted
      ? readyFields.filter((f) => validateField(f, fieldValue(f))).length
      : 0;
  const rewriteResult = result?.action === "rewrite" ? result : null;
  const rewriteTarget = rewriteResult
    ? readySections.findIndex((s) => s.id === rewriteResult.sectionId)
    : -1;

  // Compact fields (number, select) pair two to a row; the rest get a full row.
  const compactField = (f: (typeof readyFields)[number]) =>
    f.type === "number" || f.type === "select";
  const fieldRows: (typeof readyFields)[] = [];
  for (let i = 0; i < readyFields.length; i++) {
    const f = readyFields[i];
    const nextField = readyFields[i + 1];
    if (compactField(f) && nextField && compactField(nextField)) {
      fieldRows.push([f, nextField]);
      i++;
    } else fieldRows.push([f]);
  }

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        ref={rootRef}
        data-slot="inline-editor"
        data-status={status}
        data-mode={mode}
        aria-busy={streaming || status === "submitting"}
        aria-label={title ?? "Editor"}
        className={className}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Z undoes the last edit, outside text inputs.
          if (
            (e.metaKey || e.ctrlKey) &&
            !e.shiftKey &&
            e.key.toLowerCase() === "z" &&
            !(e.target as HTMLElement).closest(
              "input, textarea, [contenteditable]",
            )
          ) {
            e.preventDefault();
            undoLast();
          }
        }}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle>{title}</SurfaceTitle>
        </SurfaceHeader>

        {mode === "text" ? (
          // No AutoHeight here: its clipping would cut off the floating
          // toolbars at the first and last sections.
          <div className="flex flex-col border-t border-border pb-2">
            {readySections.map((s, index) => {
              const name = nameOf(s, index);
              const isEdited =
                status !== "discarded" && s.id in textState.edits;
              return (
                <SectionView
                  key={s.id}
                  section={s}
                  name={name}
                  headingId={`${baseId}-heading-${s.id}`}
                  editorId={`${baseId}-edit-${s.id}`}
                  text={textOf(s)}
                  original={s.text}
                  edited={isEdited}
                  partial={streaming && index === readySections.length - 1}
                  interactive={interactive}
                  canRewrite={canRewrite}
                  pending={pending.has(s.id)}
                  focused={s.id === focusSectionId}
                  flash={flash[s.id] ?? 0}
                  draft={interactive ? drafts[s.id] : undefined}
                  draftError={draftErrors[s.id]}
                  showDiff={diffOn.has(s.id)}
                  canToggleDiff={status !== "discarded"}
                  panel={panel?.sectionId === s.id ? panel : null}
                  toolbar={toolbar?.sectionId === s.id ? toolbar : null}
                  instructions={chips}
                  setEditButton={(el) => {
                    if (el) editButtons.current.set(s.id, el);
                    else editButtons.current.delete(s.id);
                  }}
                  setRewriteButton={(el) => {
                    if (el) rewriteButtons.current.set(s.id, el);
                    else rewriteButtons.current.delete(s.id);
                  }}
                  onEdit={() => startEdit(s)}
                  onDraftChange={(v) => setDrafts((d) => ({ ...d, [s.id]: v }))}
                  onSave={() => saveDraft(s)}
                  onCancel={() => closeDraft(s.id)}
                  onRevert={() => {
                    setTextState((st) => setEdit(st, s.id, undefined));
                    setAnnouncement(`Reverted ${name} to the original.`);
                  }}
                  onToggleDiff={() =>
                    setDiffOn((d) => {
                      const n = new Set(d);
                      if (n.has(s.id)) n.delete(s.id);
                      else n.add(s.id);
                      return n;
                    })
                  }
                  onRewriteClick={() => {
                    if (panel?.sectionId === s.id) {
                      setPanel(null);
                      return;
                    }
                    // A live selection in this section becomes the target.
                    const live = readSelection(rootRef.current, (id) =>
                      id === s.id ? textOf(s) : undefined,
                    );
                    setPanel({
                      sectionId: s.id,
                      selection: live
                        ? { start: live.start, end: live.end, text: live.text }
                        : undefined,
                    });
                  }}
                  onToolbarRewrite={() => {
                    if (!toolbar) return;
                    const { start, end, text } = toolbar;
                    window.getSelection()?.removeAllRanges();
                    setToolbar(null);
                    setPanel({
                      sectionId: s.id,
                      selection: { start, end, text },
                    });
                  }}
                  onPanelSubmit={(instruction) =>
                    requestRewrite(s, index, instruction, panel?.selection)
                  }
                  onPanelClose={() => {
                    setPanel(null);
                    focusLater(() => rewriteButtons.current.get(s.id));
                  }}
                />
              );
            })}
            {streaming && (
              <div aria-hidden className="flex flex-col gap-2 px-3 py-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            )}
          </div>
        ) : (
          <AutoHeight>
            {final ? (
              // Saved or discarded: a read-only record for the chat history.
              <motion.dl
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                className="flex flex-col divide-y divide-border border-t border-border px-3"
              >
                {readyFields.map((f) => {
                  const shown = displayValue(fieldValue(f), locale);
                  return (
                    <div
                      key={f.id}
                      className="grid grid-cols-1 gap-0.5 py-2.5 sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)] sm:gap-4"
                    >
                      <dt
                        className={cn(
                          genuiType.label,
                          "flex items-center gap-2 sm:items-start sm:pt-0.5",
                        )}
                      >
                        {f.label}
                        {status === "saved" && edited.includes(f.id) && (
                          <Badge variant="outline">Edited</Badge>
                        )}
                      </dt>
                      <dd
                        className={cn(
                          "min-w-0 flex-1 text-[13px] break-words whitespace-pre-line",
                          shown === null
                            ? "text-muted-foreground"
                            : "font-medium",
                        )}
                      >
                        {shown ?? "Not set"}
                      </dd>
                    </div>
                  );
                })}
              </motion.dl>
            ) : (
              <div className="flex flex-col">
                {fieldRows.map((row) => (
                  <div
                    key={row[0].id}
                    className={cn(
                      "border-t border-border",
                      row.length > 1 && "grid grid-cols-2",
                    )}
                  >
                    {row.map((f, ci) => {
                      const id = controlId(f.id);
                      const labelId = `${id}-label`;
                      const helpId = `${id}-help`;
                      const errorId = `${id}-error`;
                      const countId = `${id}-count`;
                      const value = fieldValue(f);
                      const isEdited = f.id in fieldState.edits;
                      const error =
                        touched.has(f.id) || attempted || isEdited
                          ? validateField(f, value)
                          : null;
                      const length = f.maxLength ? fieldLength(f, value) : null;
                      // The counter shows once the value nears its limit; screen
                      // readers always get it.
                      const nearLimit =
                        length !== null &&
                        !!f.maxLength &&
                        length >= f.maxLength * 0.8;
                      const describedBy =
                        [
                          f.help && helpId,
                          error && errorId,
                          length !== null && countId,
                        ]
                          .filter(Boolean)
                          .join(" ") || undefined;
                      const unit = f.type === "tags" ? "tags" : "characters";
                      return (
                        <motion.div
                          key={f.id}
                          data-slot="inline-editor-field"
                          data-edited={isEdited || undefined}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={genuiMotion.fade}
                          className={cn(
                            "flex min-w-0 flex-col gap-1.5 px-3 py-2.5",
                            ci > 0 && "border-l border-border",
                          )}
                        >
                          <div className="flex min-h-6 items-center gap-2">
                            <label
                              id={labelId}
                              htmlFor={id}
                              className={genuiType.label}
                            >
                              {f.label}
                              {f.required && <RequiredMark />}
                            </label>
                            {isEdited && (
                              <Badge variant="outline">Edited</Badge>
                            )}
                            {isEdited && interactive && (
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                className="ml-auto"
                                aria-label={`Reset ${f.label} to the original`}
                                onClick={() => {
                                  setFieldState((s) =>
                                    setEdit(sealHistory(s), f.id, undefined),
                                  );
                                  setAnnouncement(
                                    `Reset ${f.label} to the original.`,
                                  );
                                }}
                              >
                                <RotateCcwIcon aria-hidden />
                              </Button>
                            )}
                          </div>
                          {f.help && (
                            <p id={helpId} className="sr-only">
                              {f.help}
                            </p>
                          )}
                          <FieldControl
                            field={f}
                            controlId={id}
                            labelId={labelId}
                            describedBy={describedBy}
                            value={value}
                            invalid={Boolean(error)}
                            disabled={!interactive}
                            onChange={(v, typing) => {
                              setFieldState((s) =>
                                setEdit(
                                  typing ? s : sealHistory(s),
                                  f.id,
                                  editFor(v, originalField(f)),
                                  { coalesce: typing },
                                ),
                              );
                              if (!typing) touch(f.id);
                            }}
                            onBlur={() => {
                              touch(f.id);
                              setFieldState(sealHistory);
                            }}
                          />
                          {(error || length !== null) && (
                            <div
                              className={cn(
                                "flex items-start gap-3 text-[13px]",
                                !error && !nearLimit && "sr-only",
                              )}
                            >
                              {error && (
                                <p id={errorId} className="text-destructive">
                                  {error}
                                </p>
                              )}
                              {length !== null && f.maxLength && (
                                <span
                                  id={countId}
                                  className={cn(
                                    "ml-auto shrink-0 tabular-nums text-muted-foreground",
                                    length > f.maxLength && "text-destructive",
                                  )}
                                >
                                  <span aria-hidden>
                                    {length}/{f.maxLength}
                                  </span>
                                  <span className="sr-only">
                                    {`${length} of ${f.maxLength} ${unit} used`}
                                  </span>
                                </span>
                              )}
                            </div>
                          )}
                        </motion.div>
                      );
                    })}
                  </div>
                ))}
                {streaming && (
                  <div
                    aria-hidden
                    className="flex flex-col gap-1.5 border-t border-border px-3 py-3"
                  >
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-10 w-full rounded-lg" />
                  </div>
                )}
              </div>
            )}
          </AutoHeight>
        )}

        <SurfaceFooter
          aria-live="polite"
          className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <span className="sr-only">{announcement}</span>
          {status === "saved" ? (
            <p className="flex items-center gap-1.5 text-[13px]">
              <CheckIcon aria-hidden className="size-4 shrink-0" />
              Saved
            </p>
          ) : status === "discarded" ? (
            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <XIcon aria-hidden className="size-4 shrink-0" />
              Discarded
            </p>
          ) : rewriteResult ? (
            <p className="flex items-start gap-1.5 text-[13px] text-muted-foreground">
              <RefreshCwIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                Asked for a rewrite of{" "}
                {rewriteTarget >= 0
                  ? nameOf(readySections[rewriteTarget], rewriteTarget)
                  : "a section"}
                {rewriteResult.instruction && (
                  <span className="text-foreground">
                    : “{rewriteResult.instruction}”
                  </span>
                )}
              </span>
            </p>
          ) : (
            <p className={genuiType.meta}>
              {streaming ? (
                <ShimmeringText
                  text={mode === "text" ? "Writing…" : "Preparing fields…"}
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                />
              ) : status === "submitting" ? (
                "Saving…"
              ) : invalidCount > 0 ? (
                <span className="text-destructive">
                  {invalidCount === 1
                    ? "1 field needs attention."
                    : `${invalidCount} fields need attention.`}
                </span>
              ) : pending.size > 0 ? (
                `Waiting for ${plural(pending.size, "rewrite")}`
              ) : null}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            {mode === "text" && status !== "discarded" && (
              <WhyDisabled
                when={!streaming && readySections.length === 0}
                reason="Nothing to copy yet"
              >
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={
                          copied ? "Copied as Markdown" : "Copy as Markdown"
                        }
                        disabled={streaming || readySections.length === 0}
                        onClick={copy}
                        className="hover:bg-muted dark:hover:bg-white/10 relative after:absolute after:-inset-1"
                      />
                    }
                  >
                    {copied ? (
                      <CheckIcon aria-hidden />
                    ) : (
                      <CopyIcon aria-hidden />
                    )}
                  </TooltipTrigger>
                  <TooltipContent>
                    {copied ? "Copied as Markdown" : "Copy as Markdown"}
                  </TooltipContent>
                </Tooltip>
              </WhyDisabled>
            )}
            {!final && !rewriteResult && (
              <>
                <WhyDisabled
                  when={interactive && history.length === 0}
                  reason="Nothing to undo"
                >
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Undo last edit"
                          aria-keyshortcuts="Control+Z Meta+Z"
                          disabled={!interactive || history.length === 0}
                          onClick={undoLast}
                          className="hover:bg-muted dark:hover:bg-white/10 relative after:absolute after:-inset-1"
                        />
                      }
                    >
                      <Undo2Icon aria-hidden />
                    </TooltipTrigger>
                    <TooltipContent>Undo last edit</TooltipContent>
                  </Tooltip>
                </WhyDisabled>
                <WhyDisabled
                  when={interactive && edited.length === 0}
                  reason="No edits to reset"
                >
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Reset all edits"
                          disabled={!interactive || edited.length === 0}
                          onClick={resetEverything}
                          className="hover:bg-muted dark:hover:bg-white/10 relative after:absolute after:-inset-1"
                        />
                      }
                    >
                      <RotateCcwIcon aria-hidden />
                    </TooltipTrigger>
                    <TooltipContent>Reset all edits</TooltipContent>
                  </Tooltip>
                </WhyDisabled>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!interactive}
                  onClick={discard}
                >
                  Discard
                </Button>
                <WhyDisabled
                  when={
                    interactive &&
                    readySections.length + readyFields.length === 0
                  }
                  reason="Nothing to save yet"
                >
                  <Button
                    size="sm"
                    disabled={
                      !interactive ||
                      readySections.length + readyFields.length === 0
                    }
                    onClick={save}
                  >
                    {status === "submitting" ? "Saving…" : "Done"}
                  </Button>
                </WhyDisabled>
              </>
            )}
          </div>
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  );
}
