/**
 * Kanban Board: pure helpers for arranging cards, diffing arrangements, WIP
 * limits and due dates. No React, no Zod, so they run anywhere.
 *
 * A board is an ordered list of card ids per column id (top card first).
 * Every helper returns a new board and never mutates its input.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale";

export type Board = Record<string, string[]>;

export type BoardMove = {
  cardId: string;
  fromColumnId: string;
  toColumnId: string;
  /** The card's final 0-based position in the target column. */
  index: number;
};

export type CardPosition = { columnId: string; index: number };

/** Builds a board from columns and cards. Unknown columns and repeat ids are skipped. */
export function buildBoard(
  columnIds: string[],
  cards: { id: string; columnId: string }[],
): Board {
  const board: Board = {};
  for (const id of columnIds) board[id] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    if (seen.has(card.id) || !(card.columnId in board)) continue;
    seen.add(card.id);
    board[card.columnId].push(card.id);
  }
  return board;
}

export function findCard(board: Board, cardId: string): CardPosition | null {
  for (const [columnId, ids] of Object.entries(board)) {
    const index = ids.indexOf(cardId);
    if (index !== -1) return { columnId, index };
  }
  return null;
}

/**
 * Moves a card. `toIndex` is its position in the target column once the card
 * has been taken out of its current place; it is clamped to the column.
 */
export function moveCard(
  board: Board,
  cardId: string,
  toColumnId: string,
  toIndex: number,
): Board {
  const from = findCard(board, cardId);
  if (!from || !(toColumnId in board)) return board;
  const next: Board = { ...board };
  next[from.columnId] = board[from.columnId].filter((id) => id !== cardId);
  const target = [...next[toColumnId]];
  const index = Math.max(0, Math.min(Math.trunc(toIndex), target.length));
  target.splice(index, 0, cardId);
  next[toColumnId] = target;
  return next;
}

/**
 * Applies a move list where each `index` is the card's final position (as
 * returned by `diffBoards`): the moved cards are lifted out first, then
 * inserted from the lowest final index up. Unknown cards or columns are
 * skipped.
 */
export function applyMoves(
  board: Board,
  moves: Pick<BoardMove, "cardId" | "toColumnId" | "index">[],
): Board {
  const valid = moves.filter(
    (m) => m.toColumnId in board && findCard(board, m.cardId) !== null,
  );
  const lifted = new Set(valid.map((m) => m.cardId));
  const next: Board = {};
  for (const [columnId, ids] of Object.entries(board)) {
    next[columnId] = ids.filter((id) => !lifted.has(id));
  }
  const placed = new Set<string>();
  for (const m of [...valid].sort((a, b) => a.index - b.index)) {
    if (placed.has(m.cardId)) continue;
    placed.add(m.cardId);
    const column = next[m.toColumnId];
    column.splice(Math.max(0, Math.min(m.index, column.length)), 0, m.cardId);
  }
  return next;
}

/**
 * Pre-applies the agent's suggested moves: each card goes to the end of its
 * target column. Proposals for unknown cards or columns are ignored.
 */
export function applyProposals(
  board: Board,
  proposals: { cardId: string; toColumnId: string }[],
): Board {
  let next = board;
  for (const p of proposals) {
    const from = findCard(next, p.cardId);
    if (!from || from.columnId === p.toColumnId || !(p.toColumnId in next)) {
      continue;
    }
    next = moveCard(next, p.cardId, p.toColumnId, next[p.toColumnId].length);
  }
  return next;
}

/** Ids of a longest common subsequence of `a` and `b`. */
export function longestCommonSubsequence(a: string[], b: string[]) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Array<number>(rows * cols).fill(0);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        a[i] === b[j]
          ? table[(i + 1) * cols + j + 1] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }
  const kept = new Set<string>();
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      kept.add(a[i]);
      i++;
      j++;
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) i++;
    else j++;
  }
  return kept;
}

/**
 * The fewest card moves that turn `original` into `current`.
 *
 * A card moves when it changed column, or when it is out of order among the
 * cards that stayed in its column. Each `index` is the card's final position;
 * moves are sorted by column (in `columnOrder`) and index, and
 * `applyMoves(original, moves)` reproduces `current`.
 */
export function diffBoards(
  original: Board,
  current: Board,
  columnOrder: string[] = Object.keys(current),
): BoardMove[] {
  const home = new Map<string, string>();
  for (const [columnId, ids] of Object.entries(original)) {
    for (const id of ids) home.set(id, columnId);
  }
  const order = [
    ...columnOrder.filter((id) => id in current),
    ...Object.keys(current).filter((id) => !columnOrder.includes(id)),
  ];
  const moves: BoardMove[] = [];
  for (const columnId of order) {
    const ids = current[columnId] ?? [];
    const stayedNow = ids.filter((id) => home.get(id) === columnId);
    const stayedBefore = (original[columnId] ?? []).filter((id) =>
      stayedNow.includes(id),
    );
    const inOrder = longestCommonSubsequence(stayedBefore, stayedNow);
    ids.forEach((cardId, index) => {
      const fromColumnId = home.get(cardId);
      if (fromColumnId === undefined) return;
      if (fromColumnId !== columnId || !inOrder.has(cardId)) {
        moves.push({ cardId, fromColumnId, toColumnId: columnId, index });
      }
    });
  }
  return moves;
}

export function boardsEqual(a: Board, b: Board) {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(
    (k) =>
      Array.isArray(b[k]) &&
      a[k].length === b[k].length &&
      a[k].every((id, i) => b[k][i] === id),
  );
}

/**
 * Keeps a user's arrangement in step with the latest data: drops cards and
 * columns that no longer exist and adds new ones where `base` has them.
 */
export function reconcileBoard(board: Board, base: Board): Board {
  const known = new Set(Object.values(base).flat());
  const next: Board = {};
  const placed = new Set<string>();
  for (const columnId of Object.keys(base)) {
    next[columnId] = (board[columnId] ?? []).filter((id) => {
      if (!known.has(id) || placed.has(id)) return false;
      placed.add(id);
      return true;
    });
  }
  for (const [columnId, ids] of Object.entries(base)) {
    for (const id of ids) if (!placed.has(id)) next[columnId].push(id);
  }
  return next;
}

/**
 * Where a card goes back to on undo: its original column, just after the
 * cards that preceded it there and are still in that column.
 */
export function restorePosition(
  original: Board,
  current: Board,
  cardId: string,
): CardPosition | null {
  const home = findCard(original, cardId);
  if (!home) return null;
  const before = original[home.columnId].slice(0, home.index);
  const column = (current[home.columnId] ?? []).filter((id) => id !== cardId);
  let index = 0;
  column.forEach((id, i) => {
    if (before.includes(id)) index = i + 1;
  });
  return { columnId: home.columnId, index };
}

export type WipState = "none" | "under" | "at" | "over";

/** How a column's card count compares with its work-in-progress limit. */
export function wipState(count: number, limit?: number): WipState {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return "none";
  }
  if (count > limit) return "over";
  return count === limit ? "at" : "under";
}

/**
 * Parses an ISO date ('2026-10-14') or date-time to a local calendar day.
 * Date-only strings are read as local dates, not UTC midnight.
 */
export function parseDueDate(value: string | undefined): Date | null {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return date.getMonth() === Number(m) - 1 ? date : null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** True when the due day is before `now`'s day. Due today is not overdue. */
export function isOverdue(due: string | undefined, now: Date | number) {
  const day = parseDueDate(due);
  if (!day) return false;
  return day.getTime() < startOfDay(new Date(now)).getTime();
}

export type DueInfo = {
  /** 'Oct 14', with the year when it differs from now's. */
  label: string;
  overdue: boolean;
  today: boolean;
};

/** Display facts for a due date. Without `now`, nothing is overdue. */
export function dueInfo(
  due: string | undefined,
  now: Date | number | null,
  locale: string = DEFAULT_LOCALE,
): DueInfo | null {
  const day = parseDueDate(due);
  if (!day) return null;
  const today = now === null ? null : startOfDay(new Date(now));
  const showYear = today !== null && today.getFullYear() !== day.getFullYear();
  const label = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(showYear ? { year: "numeric" } : {}),
  }).format(day);
  return {
    label,
    overdue: today !== null && day.getTime() < today.getTime(),
    today: today !== null && day.getTime() === today.getTime(),
  };
}

/**
 * Drop position in a column from the pointer's y: the number of cards whose
 * vertical midpoint lies above it.
 */
export function indexFromMidpoints(midpoints: number[], y: number) {
  let index = 0;
  for (const mid of midpoints) if (mid < y) index++;
  return index;
}

/** The column under (or nearest to) the pointer's x. -1 when there are none. */
export function nearestColumnIndex(
  spans: { left: number; right: number }[],
  x: number,
) {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  spans.forEach((s, i) => {
    const distance = x < s.left ? s.left - x : x > s.right ? x - s.right : 0;
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return best;
}

export function pluralize(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/** The URL when it is an absolute http(s) link, otherwise null. */
export function safeHttpUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}
