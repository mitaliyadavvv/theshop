import { test } from "node:test";
import assert from "node:assert/strict";
import { colourFromText, familyOf, matchesFamily } from "../src/lib/colour";
import { anchorOf, canvasHeight, curate, layoutScatter, tierOf } from "../src/lib/colour-scatter";

test("colour comes from the name first, then a single unambiguous tag", () => {
  assert.equal(colourFromText("Olive Linen Boxy Pants")?.term, "olive");
  assert.equal(colourFromText("Softest Oversized Pullover in Beige")?.family, "neutrals");
  assert.equal(colourFromText("Black Linen summer Shirt")?.family, "dark");
  assert.equal(colourFromText("Cozy Tie-Up Cardigan in Blush")?.family, "pinks");
  assert.equal(colourFromText("Light Blue Shirt")?.term, "light blue");
  assert.ok(colourFromText("Light Blue Shirt")!.l > colourFromText("Blue Shirt")!.l);
  const navy = colourFromText("Navy Ribbed Top")!;
  assert.equal(navy.family, "blues", "navy sits at the dark end of the blues");
  assert.ok(matchesFamily(navy, "dark") && matchesFamily(navy, "blues"), "…and also shows under Dark tones");
  assert.equal(colourFromText("Viola Tube Dress"), null, "no colour word → left out, never guessed");
  assert.equal(colourFromText("Skyline Vest"), null, "word boundaries: 'skyline' isn't 'sky'");
  assert.equal(colourFromText("Halter Top", ["Red"])?.term, "red");
  assert.equal(colourFromText("Halter Top", ["Red", "Black"]), null, "several colour tags = ambiguous");
  assert.equal(colourFromText("Floral Midi Dress", ["Pink"]), null, "prints aren't one colour");
});

test("families", () => {
  assert.equal(familyOf({ h: 0, s: 0, l: 97 }), "neutrals");
  assert.equal(familyOf({ h: 0, s: 0, l: 8 }), "dark");
  assert.equal(familyOf({ h: 215, s: 70, l: 50 }), "blues");
  assert.equal(familyOf({ h: 340, s: 70, l: 74 }), "pinks");
  assert.equal(familyOf({ h: 36, s: 38, l: 77 }), "neutrals", "beige");
  assert.equal(familyOf({ h: 150, s: 45, l: 78 }), "greens", "mint stays green");
  assert.equal(familyOf({ h: 350, s: 60, l: 82 }), "pinks", "blush stays pink");
});

const NAMES = ["White Shirt", "Ivory Dress", "Cream Top", "Beige Pants", "Grey Tee", "Charcoal Coat", "Black Dress", "Black Top", "Black Skirt",
  "Red Dress", "Cherry Top", "Burgundy Skirt", "Rust Shirt", "Mustard Top", "Lemon Dress", "Olive Pants", "Mint Top", "Forest Coat",
  "Navy Blazer", "Blue Shirt", "Sky Blue Dress", "Lavender Top", "Purple Skirt", "Plum Dress", "Pink Top", "Blush Dress", "Fuchsia Top",
  "Brown Pants", "Chocolate Jacket", "Peach Top", "Teal Dress", "Light Blue Shirt", "Dark Green Coat", "Pale Pink Tee"];
const sample = Array.from({ length: 6 }, (_, k) => NAMES.map((n, i) => ({ id: `p${k}-${i}`, colour: colourFromText(n)!, aspect: i % 3 ? 0.75 : 1 }))).flat();

test("colour plane: spectrum left→right, saturation pulls to the centre, light at top", () => {
  const at = (name: string) => anchorOf(colourFromText(name)!, "x");
  assert.ok(at("Red Dress").x < at("Green Dress").x && at("Green Dress").x < at("Blue Dress").x && at("Blue Dress").x < at("Pink Dress").x);
  assert.ok(Math.abs(at("Grey Dress").x - 0.5) < 0.06, "neutrals sit on the central spine");
  assert.ok(at("White Dress").y < at("Grey Dress").y && at("Grey Dress").y < at("Black Dress").y, "light → dark top → bottom");
  assert.ok(Math.abs(at("Dusty Pink Dress").x - 0.5) < Math.abs(at("Hot Pink Dress").x - 0.5), "dusty sits nearer the centre than vivid");
});

test("scatter layout: deterministic, inside the canvas, no overlaps, mixed sizes, all four quadrants", () => {
  const W = 1200, H = canvasHeight(sample, W, 700);
  const a = layoutScatter(sample, W, H), b = layoutScatter([...sample].reverse(), W, H);
  assert.deepEqual(a, b, "same input → same positions, regardless of order");
  for (const p of a) assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= W && p.y + p.h <= H, "inside canvas");
  let overlaps = 0;
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) {
    const p = a[i], q = a[j];
    if (p.x < q.x + q.w - 2 && q.x < p.x + p.w - 2 && p.y < q.y + q.h - 2 && q.y < p.y + p.h - 2) overlaps++;
  }
  assert.equal(overlaps, 0, "pieces never cover each other");
  const tiers = new Set(a.map((p) => p.tier));
  assert.deepEqual([...tiers].sort(), ["l", "m", "s"], "small, medium and large pieces");
  const quad = new Set(a.map((p) => `${p.x + p.w / 2 < W / 2 ? "L" : "R"}${p.y + p.h / 2 < H / 2 ? "T" : "B"}`));
  assert.equal(quad.size, 4, "all four quadrants populated");
});

test("family zoom fills the canvas and stays overlap-free", () => {
  const greens = sample.filter((p) => p.colour.family === "greens");
  const W = 900, H = canvasHeight(greens, W, 400);
  const placed = layoutScatter(greens, W, H, { fit: true });
  const xs = placed.map((p) => p.x + p.w / 2);
  assert.ok(Math.max(...xs) - Math.min(...xs) > W * 0.5, "zoomed view spreads across the width");
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const p = placed[i], q = placed[j];
    assert.ok(!(p.x < q.x + q.w - 2 && q.x < p.x + p.w - 2 && p.y < q.y + q.h - 2 && q.y < p.y + p.h - 2), "no overlaps");
  }
});

test("curated subset covers the whole plane and is stable", () => {
  const picked = curate(sample, 60);
  assert.equal(picked.length, 60);
  assert.deepEqual(curate([...sample].reverse(), 60).map((p) => p.id).sort(), picked.map((p) => p.id).sort());
  const fams = new Set(picked.map((p) => p.colour.family));
  assert.ok(fams.size >= 8, `families represented: ${[...fams]}`);
  assert.equal(tierOf("abc"), tierOf("abc"));
  // Even a small selection reaches light and deep shades on both sides of the spine.
  const small = curate(sample, 20).map((p) => anchorOf(p.colour, p.id));
  const quads = new Set(small.map((a) => `${a.x < 0.5 ? "L" : "R"}${a.y < 0.5 ? "T" : "B"}`));
  assert.equal(quads.size, 4, "a 20-piece selection covers all four quadrants");
});
