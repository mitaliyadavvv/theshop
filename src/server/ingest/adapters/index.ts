import type { IngestionAdapter } from "../types";
import { shopifyAdapter } from "./shopify";
import { wooAdapter } from "./woocommerce";

/**
 * Automated adapters, tried in order during detection. Add a new platform by
 * implementing IngestionAdapter and registering it here — the pipeline, the
 * catalogue and the UI don't change.
 *
 * Social sources (Instagram etc.) intentionally have no automated adapter:
 * they use ingestion_method = "manual" and products are entered by hand via
 * POST /api/sources/:id/products. A permitted integration (e.g. the Instagram
 * Graph API for an account you manage) would slot in here as another adapter.
 */
export const ADAPTERS: IngestionAdapter[] = [shopifyAdapter, wooAdapter];

export const adapterFor = (method: string | null) => ADAPTERS.find((a) => a.method === method) ?? null;
