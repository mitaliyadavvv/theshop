/** What every adapter returns for one product — already normalised. */
export type NormalizedProduct = {
  externalId: string;
  handle: string | null;
  name: string;
  description: string | null;
  sourceCategory: string | null;   // raw product_type / category names
  tags: string[];
  vendor: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  url: string;
  price: number | null;
  priceMax: number | null;
  currency: string | null;
  originalPrice: number | null;    // only when the source marks a sale
  available: boolean | null;
  sourcePublishedAt: string | null;
  sourceCreatedAt: string | null;
  raw?: unknown;
};

export type NormalizedCollection = {
  externalId: string;
  title: string;
  handle: string | null;
  url: string;
  imageUrl: string | null;
  productsCount: number | null;
  publishedAt: string | null;
};

export type SourceContext = {
  id: string;
  name: string;
  origin: string;                  // https://host
  scope: "store" | "collection";
  collectionHandle: string | null;
};

export type FetchResult = {
  products: NormalizedProduct[];
  collections: NormalizedCollection[];
  /** true only when every page was fetched; removals are only applied on complete runs. */
  complete: boolean;
  warnings: string[];
  requests: number;
};

export type DetectResult = {
  platform: string;
  method: string;
  sample: number;                  // products seen in the probe
  detail?: string;
};

export interface IngestionAdapter {
  /** Stable id stored on the source (sources.ingestion_method). */
  method: string;
  platform: string;
  /** Cheap probe: does this origin speak our protocol? Returns null if not. */
  detect(origin: string, collectionHandle: string | null): Promise<DetectResult | null>;
  /** Retrieve and normalise the full catalogue for a source. */
  fetchCatalogue(ctx: SourceContext): Promise<FetchResult>;
}

export class SourceError extends Error {
  constructor(message: string, readonly kind: "network" | "http" | "rate_limited" | "robots" | "parse" | "unsupported" | "blocked", readonly status?: number) {
    super(message);
  }
}
