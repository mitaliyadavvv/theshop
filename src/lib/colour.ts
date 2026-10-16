/**
 * Colour from product text. Products have no colour metadata, so we read the colour words
 * brands already put in names (and tags) — "Olive Linen Pants", "Pullover in Beige" — and map
 * them to HSL with a fashion-colour vocabulary. Deterministic, instant, no image processing.
 * Products with no recognisable colour word are left out rather than guessed.
 */
export type Hsl = { h: number; s: number; l: number };
export type ColourFamily = "neutrals" | "dark" | "reds" | "pinks" | "oranges" | "yellows" | "greens" | "blues" | "purples";
export type ProductColour = Hsl & { family: ColourFamily; term: string };

// h 0–360, s/l 0–100. Multi-word terms are matched before single words.
const VOCAB: Record<string, [number, number, number]> = {
  // whites, creams & beiges
  "off white": [40, 25, 94], "off-white": [40, 25, 94], offwhite: [40, 25, 94], white: [0, 0, 97], ivory: [48, 55, 92],
  cream: [45, 50, 89], creamy: [45, 50, 89], ecru: [42, 35, 85], oat: [38, 30, 80], oatmeal: [38, 30, 80], beige: [36, 38, 77],
  sand: [36, 35, 72], nude: [25, 40, 74], latte: [30, 30, 68], taupe: [30, 14, 55], stone: [35, 12, 64], khaki: [50, 25, 55],
  camel: [30, 45, 55], tan: [30, 45, 58], mushroom: [30, 12, 60],
  // greys & blacks
  grey: [0, 0, 55], gray: [0, 0, 55], silver: [0, 0, 75], ash: [0, 0, 65], charcoal: [0, 0, 24], black: [0, 0, 8], onyx: [0, 0, 10],
  // reds
  red: [0, 75, 45], cherry: [350, 75, 38], crimson: [348, 80, 40], scarlet: [5, 85, 48], wine: [345, 55, 25], burgundy: [345, 60, 25],
  maroon: [350, 60, 22], oxblood: [355, 55, 22], rust: [15, 65, 40], brick: [8, 55, 40], tomato: [8, 80, 50],
  // pinks
  pink: [340, 70, 74], "baby pink": [345, 70, 84], "hot pink": [330, 85, 58], "dusty pink": [345, 30, 70], blush: [350, 60, 82],
  rose: [345, 55, 68], fuchsia: [320, 80, 50], magenta: [320, 80, 48], coral: [10, 80, 65], peach: [25, 80, 78], salmon: [8, 70, 70],
  mauve: [320, 25, 60], bubblegum: [330, 70, 78], rani: [330, 80, 45], gulabi: [340, 70, 65], gulkand: [340, 50, 50], berry: [330, 55, 35],
  // oranges & browns
  orange: [28, 90, 55], tangerine: [25, 90, 55], mango: [38, 90, 58], mustard: [45, 75, 45], ochre: [40, 70, 45], haldi: [45, 90, 50],
  brown: [25, 45, 30], chocolate: [20, 50, 22], coffee: [25, 40, 28], mocha: [25, 30, 35], espresso: [20, 35, 18], cinnamon: [22, 55, 40],
  caramel: [30, 60, 45], cognac: [25, 65, 35], terracotta: [15, 55, 45], copper: [22, 65, 45], bronze: [30, 50, 40], toffee: [30, 55, 42],
  chestnut: [15, 45, 30], walnut: [25, 40, 28], mahogany: [5, 50, 25], rust_: [15, 65, 40],
  // yellows
  yellow: [52, 90, 58], lemon: [55, 90, 65], "butter yellow": [50, 70, 80], gold: [45, 70, 50], golden: [45, 70, 50], canary: [55, 90, 60],
  sunflower: [48, 90, 55],
  // greens
  green: [130, 45, 40], olive: [70, 40, 35], sage: [100, 15, 60], mint: [150, 45, 78], emerald: [150, 70, 32], jade: [160, 50, 45],
  forest: [130, 45, 22], "bottle green": [150, 60, 20], moss: [85, 35, 38], lime: [80, 75, 55], pistachio: [85, 40, 72], seafoam: [160, 40, 70],
  teal: [180, 60, 32], army: [80, 25, 30], mehendi: [70, 45, 35], mehndi: [70, 45, 35], hara: [130, 50, 40], parrot: [110, 70, 45],
  // blues
  blue: [215, 70, 50], navy: [222, 55, 22], indigo: [235, 50, 35], cobalt: [220, 85, 45], "royal blue": [225, 75, 45], sky: [200, 70, 75],
  "sky blue": [200, 70, 75], "baby blue": [205, 65, 80], "powder blue": [205, 45, 80], "ice blue": [200, 50, 88], denim: [215, 40, 45],
  turquoise: [175, 65, 50], aqua: [180, 60, 65], aquamarine: [170, 55, 68], cerulean: [200, 70, 50], azure: [205, 75, 55], midnight: [230, 50, 15], ink: [225, 40, 18],
  periwinkle: [230, 55, 75], "steel blue": [210, 30, 50], slate: [210, 15, 40],
  // purples
  purple: [275, 50, 40], lavender: [265, 50, 80], lilac: [280, 40, 75], violet: [270, 60, 50], plum: [300, 35, 30], aubergine: [300, 40, 20],
  eggplant: [300, 40, 20], grape: [285, 45, 35], orchid: [300, 45, 65], mulberry: [320, 40, 30], wisteria: [270, 40, 72], amethyst: [275, 45, 55],
  jamuni: [285, 50, 30],
};
delete (VOCAB as Record<string, unknown>).rust_;

const MODIFIERS: Record<string, (c: Hsl) => Hsl> = {
  light: (c) => ({ ...c, l: Math.min(95, c.l + 14) }), pale: (c) => ({ ...c, l: Math.min(95, c.l + 16), s: c.s * 0.8 }),
  pastel: (c) => ({ ...c, l: Math.min(92, c.l + 18), s: c.s * 0.7 }), soft: (c) => ({ ...c, l: Math.min(92, c.l + 8) }),
  dark: (c) => ({ ...c, l: Math.max(8, c.l - 18) }), deep: (c) => ({ ...c, l: Math.max(8, c.l - 14), s: Math.min(100, c.s + 8) }),
  dusty: (c) => ({ ...c, s: c.s * 0.55 }), muted: (c) => ({ ...c, s: c.s * 0.55 }), bright: (c) => ({ ...c, s: Math.min(100, c.s + 12) }),
};

const TERMS = Object.keys(VOCAB).sort((a, b) => b.length - a.length);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TERM_RE = new RegExp(`\\b(?:(${Object.keys(MODIFIERS).join("|")})[\\s-]+)?(${TERMS.map(esc).join("|")})\\b`, "gi");
// Words that look like colours but, in these catalogues, usually aren't (or mean several colours).
const SKIP = /\b(multi-?colou?r|multi|rainbow|tie-?dye|ombre|print(ed)?|floral|stripes?|checks?|plaid)\b/i;

export function familyOf(c: Hsl): ColourFamily {
  const warm = c.h < 70 || c.h > 330;
  // Greys/blacks, plus light low-saturation warm tones: beige, sand, oat, nude, cream, ivory.
  if (c.s < 18 || (warm && c.l > 84 && c.s < 60) || (c.h >= 15 && c.h < 60 && c.l >= 70 && c.s <= 45)) return c.l < 22 ? "dark" : "neutrals";
  if (c.l < 22) return "dark";
  const h = c.h;
  if (h >= 285 && h < 320) return "purples";
  if (h >= 320 || h < 12) return c.l >= 60 || (h >= 320 && h < 350 && c.l >= 40) ? "pinks" : "reds";
  if (h < 40) return c.l >= 70 && c.s > 50 ? "pinks" : "oranges";   // peach / coral read pink-ish
  if (h < 65) return "yellows";
  if (h < 185) return "greens";
  if (h < 255) return "blues";
  return "purples";
}

/** First colour named in the product name (dominant by convention), else a single colour tag. */
export function colourFromText(name: string, tags: string[] = []): ProductColour | null {
  const pick = (text: string) => {
    TERM_RE.lastIndex = 0;
    const m = TERM_RE.exec(text);
    if (!m) return null;
    const term = m[2].toLowerCase();
    let c: Hsl = { h: VOCAB[term][0], s: VOCAB[term][1], l: VOCAB[term][2] };
    if (m[1]) c = MODIFIERS[m[1].toLowerCase()](c);
    return { ...c, family: familyOf(c), term: (m[1] ? `${m[1]} ${term}` : term).toLowerCase() };
  };
  const fromName = pick(name.replace(/’|‘/g, "'"));
  if (fromName) return fromName;
  if (SKIP.test(name)) return null;
  const colourTags = tags.map((t) => pick(t)).filter(Boolean) as ProductColour[];
  const distinct = new Set(colourTags.map((c) => c.term));
  return distinct.size === 1 ? colourTags[0] : null;   // several colour tags = ambiguous
}

export const FAMILIES: { id: ColourFamily; label: string; short: string; swatch: string }[] = [
  { id: "neutrals", label: "Neutrals", short: "Neutrals", swatch: "#e9e2d6" },
  { id: "dark", label: "Dark tones", short: "Dark", swatch: "#2a2a2c" },
  { id: "reds", label: "Reds", short: "Reds", swatch: "#b8322f" },
  { id: "pinks", label: "Pinks", short: "Pinks", swatch: "#f2a8c7" },
  { id: "oranges", label: "Oranges & browns", short: "Browns", swatch: "#b8692f" },
  { id: "yellows", label: "Yellows", short: "Yellows", swatch: "#e8c33c" },
  { id: "greens", label: "Greens", short: "Greens", swatch: "#5f8a4e" },
  { id: "blues", label: "Blues", short: "Blues", swatch: "#4c6fff" },
  { id: "purples", label: "Purples", short: "Purples", swatch: "#b9a3f5" },
]

/** Filter membership. "Dark tones" means any deep shade (navy, burgundy, chocolate, black…), not only black/charcoal. */
export function matchesFamily(c: Hsl & { family: ColourFamily }, f: ColourFamily): boolean {
  if (f === "dark") return c.family === "dark" || c.l <= 25;
  return c.family === f;
}
