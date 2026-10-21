import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { StylePin } from "../style-board.schema";
import {
  boardColumns,
  categoriesOf,
  distribute,
  filterPins,
  orderSaved,
  pinAspect,
  readyPins,
  safeImageSrc,
  savedLabel,
  savedSummary,
  toggleSaved,
} from "../style-board-utils";

const pin = (id: string, aspect?: number, category?: string): StylePin => ({
  id,
  title: `Look ${id}`,
  image: { src: `/${id}.jpg`, alt: `Alt ${id}`, ...(aspect ? { aspect } : {}) },
  ...(category ? { category } : {}),
});

describe("safeImageSrc", () => {
  it("allows http(s) and same-origin paths only", () => {
    assert.equal(safeImageSrc("https://a.example/x.jpg"), "https://a.example/x.jpg");
    assert.equal(safeImageSrc("/gen/fashion/a.jpg"), "/gen/fashion/a.jpg");
    assert.equal(safeImageSrc("//evil.example/a.jpg"), null);
    assert.equal(safeImageSrc("javascript:alert(1)"), null);
    assert.equal(safeImageSrc("data:image/png;base64,AAAA"), null);
    assert.equal(safeImageSrc(42), null);
  });
});

describe("pinAspect", () => {
  it("clamps and falls back", () => {
    assert.equal(pinAspect(0.67), 0.67);
    assert.equal(pinAspect(5), 1.6);
    assert.equal(pinAspect(0.1), 0.5);
    assert.equal(pinAspect(undefined), 0.8);
    assert.equal(pinAspect(Number.NaN), 0.8);
    assert.equal(pinAspect(-1), 0.8);
  });
});

describe("readyPins", () => {
  it("keeps complete pins and skips partial or duplicate ones", () => {
    const out = readyPins([
      pin("a"),
      { id: "b", title: "Half" },
      { id: "c", title: "No alt", image: { src: "/c.jpg" } },
      pin("a"),
      pin("d"),
    ]);
    assert.deepEqual(out.map((p) => p.id), ["a", "d"]);
  });

  it("caps the board at 12", () => {
    const many = Array.from({ length: 20 }, (_, i) => pin(String(i)));
    assert.equal(readyPins(many).length, 12);
  });
});

describe("categories and filter", () => {
  const pins = [
    pin("1", 0.7, "Outerwear"),
    pin("2", 0.7, "Dresses"),
    pin("3", 0.7, "Outerwear"),
    pin("4", 0.7),
  ];
  it("lists categories in first-seen order", () => {
    assert.deepEqual(categoriesOf(pins), ["Outerwear", "Dresses"]);
  });
  it("caps the filter row", () => {
    const many = ["A", "B", "C", "D", "E", "F"].map((c, i) => pin(String(i), 0.7, c));
    assert.equal(categoriesOf(many).length, 4);
  });
  it("filters by category, or returns all", () => {
    assert.deepEqual(filterPins(pins, "Outerwear").map((p) => p.id), ["1", "3"]);
    assert.equal(filterPins(pins, null).length, 4);
  });
});

describe("boardColumns", () => {
  it("uses 2 on narrow containers and honours the request otherwise", () => {
    assert.equal(boardColumns(3, 700), 3);
    assert.equal(boardColumns(2, 700), 2);
    assert.equal(boardColumns(3, 400), 2);
    assert.equal(boardColumns(undefined, null), 3);
  });
});

describe("distribute", () => {
  it("sends each pin to the shortest column, left first on a tie", () => {
    const cols = distribute([pin("a", 0.5), pin("b", 1.5), pin("c", 1.5), pin("d", 1.5)], 2);
    // a is tall (2.3). b, c and d are short (0.97 each), so they stack in column 1
    // until it passes column 0: 0.97, 1.93, 2.9.
    assert.deepEqual(cols.map((c) => c.map((p) => p.id)), [["a"], ["b", "c", "d"]]);
  });

  it("keeps earlier pins in place when later ones arrive", () => {
    const first = distribute([pin("a", 0.7), pin("b", 1), pin("c", 0.6)], 3);
    const more = distribute(
      [pin("a", 0.7), pin("b", 1), pin("c", 0.6), pin("d", 0.8)],
      3,
    );
    for (let i = 0; i < 3; i++) {
      assert.deepEqual(
        more[i].filter((p) => p.id !== "d").map((p) => p.id),
        first[i].map((p) => p.id),
      );
    }
  });

  it("handles no pins and odd column counts", () => {
    assert.deepEqual(distribute([], 3), [[], [], []]);
    assert.equal(distribute([pin("a")], 0).length, 1);
  });
});

describe("saving", () => {
  const pins = [pin("a"), pin("b"), pin("c")];
  it("toggles ids", () => {
    assert.deepEqual(toggleSaved([], "a"), ["a"]);
    assert.deepEqual(toggleSaved(["a", "b"], "a"), ["b"]);
  });
  it("orders by board order and drops unknown ids", () => {
    assert.deepEqual(orderSaved(["c", "a", "zzz"], pins), ["a", "c"]);
  });
  it("summarises", () => {
    assert.equal(savedSummary(0), "Tap the heart on the looks you like");
    assert.equal(savedSummary(1), "1 look saved");
    assert.equal(savedSummary(3), "3 looks saved");
  });
  it("labels the saved looks", () => {
    assert.equal(savedLabel(["a"], pins), "Look a");
    assert.equal(savedLabel(["a", "b"], pins), "Look a and Look b");
    assert.equal(savedLabel(["a", "b", "c"], pins), "Look a, Look b and 1 more");
    assert.equal(savedLabel([], pins), "nothing");
  });
});
