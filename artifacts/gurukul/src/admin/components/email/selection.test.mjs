import assert from "node:assert/strict";
import { test } from "node:test";
import { addAll, allSelected, hiddenCount, keepExisting, toggleId, togglePage } from "./selection.ts";

// 250 filtered records over three pages of 100.
const filtered = Array.from({ length: 250 }, (_, i) => i + 1);
const page1 = filtered.slice(0, 100);
const page2 = filtered.slice(100, 200);

test("AC01: selecting one record makes the selection non-empty (Send Email enabled)", () => {
  const selected = toggleId(new Set(), 7);
  assert.equal(selected.size, 1);
  assert.equal(toggleId(selected, 7).size, 0);
});

test("AC04: select all filtered results covers every page, not just the visible one", () => {
  const selected = addAll(new Set(), filtered);
  assert.equal(selected.size, 250);
  assert.ok(allSelected(selected, filtered));
});

test("AC05: selections are kept when changing page; the header checkbox affects only the current page", () => {
  let selected = togglePage(new Set(), page1);
  assert.equal(selected.size, 100);
  selected = toggleId(selected, 150); // on page 2
  assert.ok(allSelected(selected, page1));
  assert.ok(!allSelected(selected, page2));
  selected = togglePage(selected, page2); // select the rest of page 2
  assert.equal(selected.size, 200);
  selected = togglePage(selected, page1); // clearing page 1 keeps page 2
  assert.equal(selected.size, 100);
  assert.ok(allSelected(selected, page2));
});

test("AC03: after a filter change, earlier selections stay selected and are counted as hidden", () => {
  const selected = new Set([1, 2, 3, 400]);
  const narrowed = new Set([2, 3, 4]);
  assert.equal(hiddenCount(selected, narrowed), 2);
  assert.ok(!allSelected(selected, [...narrowed]));
});

test("selections for records that no longer exist are dropped after a reload", () => {
  const selected = addAll(new Set(), filtered);
  const kept = keepExisting(selected, filtered.slice(0, 10));
  assert.equal(kept.size, 10);
  assert.equal(keepExisting(kept, filtered), kept); // unchanged set is returned as is (no re-render)
});
