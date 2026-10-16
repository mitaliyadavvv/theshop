import { test } from "node:test";
import assert from "node:assert/strict";
import { diversify, longestRun, type Ranked } from "../src/lib/diversify";

const make = (spec: [string, number][]) => spec.flatMap(([brand, n]) => Array.from({ length: n }, (_, i) => ({ id: `${brand}-${i}`, brand })));
const sameSet = (a: Ranked[], b: Ranked[]) => assert.deepEqual(a.map((x) => x.id).sort(), b.map((x) => x.id).sort());
const firstIndex = (list: Ranked[], id: string) => list.findIndex((x) => x.id === id);

test("one brand: order is completely unchanged", () => {
  const feed = make([["solo", 30]]);
  assert.deepEqual(diversify(feed), feed);
});

test("two brands: alternate where practical, then show the rest normally", () => {
  const feed = make([["a", 10], ["b", 4]]);                 // batch-published: all of a, then all of b
  const out = diversify(feed);
  sameSet(out, feed);
  assert.ok(longestRun(out.slice(0, 8)) <= 2, `early feed alternates: ${out.map((x) => x.brand).join("")}`);
  assert.equal(out.length, 14, "the larger brand's extra products are still shown");
  for (let i = 1; i < 10; i++) assert.ok(firstIndex(out, `a-${i - 1}`) < firstIndex(out, `a-${i}`), "brand's own order kept");
});

test("many brands batch-published: long runs broken up, nothing lost or duplicated", () => {
  const feed = make([["rerunn", 23], ["korakagaz", 12], ["basata", 9], ["sundazed", 3], ["bisou", 1], ["noises", 1]]);
  const out = diversify(feed);
  sameSet(out, feed);
  assert.equal(new Set(out.map((x) => x.id)).size, out.length, "no duplicates");
  assert.ok(longestRun(feed) === 23 && longestRun(out) <= 3, `longest run ${longestRun(out)}`);
  const adjacentBefore = feed.filter((x, i) => i && x.brand === feed[i - 1].brand).length;
  const adjacentAfter = out.filter((x, i) => i && x.brand === out[i - 1].brand).length;
  assert.ok(adjacentAfter < adjacentBefore / 3, `${adjacentBefore} → ${adjacentAfter} same-brand neighbours`);
});

test("soft, not strict: a dominant brand still fills the feed when others run out", () => {
  const feed = make([["big", 40], ["small", 2]]);
  const out = diversify(feed);
  sameSet(out, feed);
  // Its products are the oldest here (positions 41–42); mixing moves them well up, recency still counts.
  assert.ok(firstIndex(out, "small-0") < firstIndex(feed, "small-0") - 12, `small brand moves up: ${firstIndex(out, "small-0")}`);
  assert.ok(longestRun(out) > 10, "remaining products of the only brand left are shown, not withheld");
});

test("recency still leads: the newest item stays near the top", () => {
  const feed = make([["a", 20], ["b", 20], ["c", 20]]);
  const out = diversify(feed);
  assert.ok(firstIndex(out, "a-0") <= 1, "newest product is still first or second");
});

test("deterministic → stable pagination", () => {
  const feed = make([["a", 30], ["b", 17], ["c", 5]]);
  const once = diversify(feed), twice = diversify(feed);
  assert.deepEqual(once, twice);
  const pages = [once.slice(0, 12), once.slice(12, 24), once.slice(24)];
  assert.equal(new Set(pages.flat().map((x) => x.id)).size, feed.length, "pages never repeat or skip items");
});
