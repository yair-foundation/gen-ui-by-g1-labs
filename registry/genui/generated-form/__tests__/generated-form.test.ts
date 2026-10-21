import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  activeMention,
  applyMention,
  currencyDigits,
  extractMentions,
  isPlausiblePhone,
  matchMentions,
  normalizeTags,
  parseMoney,
  splitTags,
  tooPrecise,
} from "../generated-form-utils";
import {
  collectMentions,
  toFormValue,
  validateFormField,
} from "../generated-form.schema";

const people = [
  { value: "u1", label: "Dana Reyes" },
  { value: "u2", label: "Dan Okafor" },
  { value: "u3", label: "Priya Nair" },
];

describe("money", () => {
  it("parses plain amounts and separators, rejects the rest", () => {
    assert.equal(parseMoney("1,234.50"), 1234.5);
    assert.equal(parseMoney(" 80 "), 80);
    assert.equal(parseMoney(".5"), 0.5);
    assert.equal(parseMoney("12abc"), null);
    assert.equal(parseMoney(""), null);
    assert.equal(parseMoney("1.2.3"), null);
  });

  it("knows how many decimals a currency has", () => {
    assert.equal(currencyDigits("USD"), 2);
    assert.equal(currencyDigits("JPY"), 0);
    assert.equal(tooPrecise(12.345, 2), true);
    assert.equal(tooPrecise(12.34, 2), false);
    assert.equal(tooPrecise(100.5, 0), true);
  });

  it("validates range, sign and precision, and returns a number", () => {
    const f = {
      label: "Budget",
      type: "money" as const,
      required: true,
      currency: "EUR",
      min: 10,
      max: 500,
    };
    assert.equal(validateFormField(f, "120"), null);
    assert.equal(validateFormField(f, "5"), "Use 10 or more.");
    assert.equal(validateFormField(f, "900"), "Use 500 or less.");
    assert.equal(
      validateFormField(f, "12.345"),
      "Use at most 2 decimal places.",
    );
    assert.equal(validateFormField(f, "abc"), "Enter an amount.");
    assert.equal(
      validateFormField({ ...f, min: undefined }, "-3"),
      "Enter an amount of zero or more.",
    );
    assert.equal(toFormValue({ type: "money" }, "1,200.50"), 1200.5);
    assert.equal(
      validateFormField({ ...f, currency: "JPY", min: undefined }, "100.5"),
      "Use at most 0 decimal places.",
    );
  });
});

describe("phone", () => {
  it("accepts 7–15 digits with common punctuation", () => {
    assert.equal(isPlausiblePhone("+1 (555) 010-0100"), true);
    assert.equal(isPlausiblePhone("020 7946 0958"), true);
    assert.equal(isPlausiblePhone("12345"), false);
    assert.equal(isPlausiblePhone("call me"), false);
    assert.equal(isPlausiblePhone("+1234567890123456"), false);
  });

  it("validates through the field and sends the trimmed text", () => {
    const f = { label: "Phone", type: "phone" as const, required: true };
    assert.equal(validateFormField(f, "abc"), "Enter a valid phone number.");
    assert.equal(validateFormField(f, "+44 20 7946 0958"), null);
    assert.equal(
      toFormValue({ type: "phone" }, " +44 20 7946 0958 "),
      "+44 20 7946 0958",
    );
  });
});

describe("tags", () => {
  it("trims, drops empties, and removes repeats", () => {
    assert.deepEqual(normalizeTags([" Design ", "design", "", "Ops"]), [
      "Design",
      "Ops",
    ]);
    assert.deepEqual(splitTags("a, b ,A,, c"), ["a", "b", "c"]);
  });

  it("validates the count and sends an array, or null when empty", () => {
    const f = {
      label: "Topics",
      type: "tags" as const,
      required: true,
      min: 2,
      max: 3,
    };
    assert.equal(validateFormField(f, []), "Topics is required.");
    assert.equal(validateFormField(f, ["a"]), "Add at least 2.");
    assert.equal(validateFormField(f, ["a", "b", "c", "d"]), "Use 3 or fewer.");
    assert.equal(validateFormField(f, ["a", "b"]), null);
    assert.deepEqual(toFormValue({ type: "tags" }, ["a ", "a", "b"]), [
      "a",
      "b",
    ]);
    assert.equal(toFormValue({ type: "tags" }, []), null);
  });
});

describe("mentions", () => {
  it("finds the @query at the caret", () => {
    assert.deepEqual(activeMention("hi @Dan", 7), { start: 3, query: "Dan" });
    assert.deepEqual(activeMention("@", 1), { start: 0, query: "" });
    assert.deepEqual(activeMention("hi @Dana Re", 11), {
      start: 3,
      query: "Dana Re",
    });
    assert.equal(activeMention("mail me@dan", 11), null);
    assert.equal(activeMention("hi @Dan\nnext", 12), null);
    assert.equal(activeMention("no at sign", 5), null);
  });

  it("matches by label, prefix first, and applies a choice", () => {
    assert.deepEqual(
      matchMentions(people, "dan").map((o) => o.value),
      ["u1", "u2"],
    );
    assert.deepEqual(
      matchMentions(people, "ok").map((o) => o.value),
      ["u2"],
    );
    assert.deepEqual(matchMentions(people, "zzz"), []);
    const { text, caret } = applyMention("hi @Da", 3, 6, "Dana Reyes");
    assert.equal(text, "hi @Dana Reyes ");
    assert.equal(caret, text.length);
  });

  it("lists mentioned ids from the final text, so edits are respected", () => {
    assert.deepEqual(
      extractMentions("Ask @Dana Reyes and @Priya Nair.", people),
      ["u1", "u3"],
    );
    assert.deepEqual(extractMentions("@Dana", people), []);
    assert.deepEqual(extractMentions("email@Dana Reyes", people), []);
  });

  it("collects mentions per field for the result", () => {
    const fields = [
      { id: "note", type: "mention" as const, options: people },
      { id: "title", type: "text" as const },
    ];
    assert.deepEqual(
      collectMentions(fields, { note: "cc @Priya Nair", title: "x" }),
      { note: ["u3"] },
    );
    assert.deepEqual(
      collectMentions(fields, { note: "nobody", title: "x" }),
      {},
    );
  });
});
