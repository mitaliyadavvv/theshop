/** Client-safe shapes shared by API routes and components. */
export type ReleasedBasis = "published" | "created" | "first_seen" | null;

export type ProductDTO = {
  id: string;
  name: string;
  brandId: string;
  brandName: string;
  category: string;
  imageUrl: string | null;
  url: string;
  price: number | null;
  priceMax: number | null;
  currency: string | null;
  originalPrice: number | null;
  available: boolean | null;
  releasedAt: string | null;
  releasedBasis: ReleasedBasis;
  firstSeenAt: string;
  isNew: boolean;
  saved: boolean;
  removed: boolean;
  manual: boolean;
  demo: boolean;
};

export type SortKey = "newest" | "relevance" | "price_asc" | "price_desc" | "brand";
export type DropWindow = "today" | "week" | "month" | "recent";

export type CatalogQuery = {
  q?: string;
  categories?: string[];
  brands?: string[];
  sort?: SortKey;
  minPrice?: number | null;
  maxPrice?: number | null;
  inStock?: boolean;
  onSale?: boolean;
  savedOnly?: boolean;
  newOnly?: boolean;
  drop?: DropWindow | null;
  page?: number;
  limit?: number;
};

export type Facet = { id: string; label: string; count: number };

export type CatalogResult = {
  items: ProductDTO[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  sort: SortKey;
  facets: { categories: Facet[]; brands: Facet[]; price: { min: number | null; max: number | null } };
};

export type SourceDTO = {
  /** The viewer's subscription to this source (null for suggestions). */
  subscriptionId: string | null; addedAt: string | null;
  id: string; name: string; originalUrl: string; canonicalUrl: string | null; host: string | null;
  sourceType: string; platform: string | null; ingestionMethod: string | null;
  scope: string; collectionHandle: string | null; status: string; statusDetail: string | null;
  verified: boolean; logoUrl: string | null; lastAttemptedSync: string | null; lastSuccessfulSync: string | null;
  productCount: number; syncing: boolean; notes: string | null; syncIntervalHours: number | null;
  runs: { id: number; trigger: string; startedAt: string; finishedAt: string | null; status: string;
    seen: number; created: number; removed: number; error: string | null; warnings: string[] }[];
};

export type CollectionDTO = {
  id: string; title: string; url: string; imageUrl: string | null; productsCount: number | null;
  publishedAt: string; brandId: string; brandName: string;
};
