/** Normalised category system. Order = display order. */
export const CATEGORIES = [
  { id: "tops", label: "Tops & shirts", short: "Tops" },
  { id: "bottoms", label: "Trousers & bottoms", short: "Bottoms" },
  { id: "dresses", label: "Dresses", short: "Dresses" },
  { id: "skirts", label: "Skirts", short: "Skirts" },
  { id: "coords", label: "Co-ord sets", short: "Co-ords" },
  { id: "jumpsuits", label: "Jumpsuits", short: "Jumpsuits" },
  { id: "outerwear", label: "Jackets & layers", short: "Layers" },
  { id: "jewellery", label: "Jewellery", short: "Jewellery" },
  { id: "bags", label: "Bags", short: "Bags" },
  { id: "footwear", label: "Footwear", short: "Footwear" },
  { id: "accessories", label: "Accessories", short: "Accessories" },
  { id: "other", label: "Other", short: "Other" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export const categoryLabel = (id: string) => CATEGORIES.find((c) => c.id === id)?.label ?? "Other";
