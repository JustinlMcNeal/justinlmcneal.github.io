/** Parcel mapping memory suggestions + persistence (Phase 7). */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";
import { formatVariantLabel } from "./productsApi.js";
import { requireAuthenticatedSession } from "./parcelImportsApi.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MEMORY_SELECT =
  "id, seller_name, normalized_source_item_name, source_item_name_sample, product_id, product_variant_id, confidence_score, usage_count, last_used_at, products(name, code), product_variants(title, option_name, option_value, sku)";

/**
 * @param {string} text
 */
export function normalizeSourceItemName(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {{ sellerName?: string | null, sourceItemName?: string | null }} params
 */
export async function findMappingSuggestions({ sellerName, sourceItemName }) {
  await requireAuthenticatedSession();

  const normalized = normalizeSourceItemName(sourceItemName);
  const seller = String(sellerName || "").trim();
  const seen = new Set();
  /** @type {object[]} */
  const merged = [];

  const pushRows = (rows) => {
    for (const row of rows || []) {
      if (!row?.id || seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(enrichSuggestion(row));
    }
  };

  if (seller) {
    const { data, error } = await supabase
      .from("parcel_mapping_memory")
      .select(MEMORY_SELECT)
      .ilike("seller_name", seller)
      .order("confidence_score", { ascending: false, nullsFirst: false })
      .order("usage_count", { ascending: false })
      .order("last_used_at", { ascending: false })
      .limit(5);
    if (error) throw new Error(error.message);
    pushRows(data);
  }

  if (normalized) {
    const { data, error } = await supabase
      .from("parcel_mapping_memory")
      .select(MEMORY_SELECT)
      .eq("normalized_source_item_name", normalized)
      .order("confidence_score", { ascending: false, nullsFirst: false })
      .order("usage_count", { ascending: false })
      .order("last_used_at", { ascending: false })
      .limit(5);
    if (error) throw new Error(error.message);
    pushRows(data);
  }

  return merged.slice(0, 5);
}

/**
 * @param {object[]} rowMappings
 * @param {object[]} items
 */
export async function saveMappingMemoryFromMappedRows(rowMappings, items) {
  await requireAuthenticatedSession();

  const itemByRow = new Map(items.map((i) => [i.rowNumber, i]));
  const warnings = [];

  for (const row of rowMappings) {
    if (!row.productId) continue;

    const item = itemByRow.get(row.rowNumber);
    const sellerName = item?.sellerName?.trim() || null;
    const sourceSample = item?.sourceItemName?.trim() || null;
    const normalized = normalizeSourceItemName(sourceSample);

    try {
      let query = supabase
        .from("parcel_mapping_memory")
        .select("id, usage_count")
        .eq("product_id", row.productId);

      if (sellerName) query = query.eq("seller_name", sellerName);
      else query = query.is("seller_name", null);

      if (normalized) query = query.eq("normalized_source_item_name", normalized);
      else query = query.is("normalized_source_item_name", null);

      if (row.productVariantId) {
        query = query.eq("product_variant_id", row.productVariantId);
      } else {
        query = query.is("product_variant_id", null);
      }

      const { data: existing, error: findErr } = await query.maybeSingle();
      if (findErr) throw findErr;

      const now = new Date().toISOString();
      if (existing?.id) {
        const { error } = await supabase
          .from("parcel_mapping_memory")
          .update({
            usage_count: (existing.usage_count ?? 0) + 1,
            last_used_at: now,
            source_item_name_sample: sourceSample,
            confidence_score: 0.85,
          })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("parcel_mapping_memory").insert({
          seller_name: sellerName,
          normalized_source_item_name: normalized || null,
          source_item_name_sample: sourceSample,
          product_id: row.productId,
          product_variant_id: row.productVariantId ?? null,
          confidence_score: 0.75,
          usage_count: 1,
          last_used_at: now,
        });
        if (error) throw error;
      }
    } catch (err) {
      console.warn("[parcelImports] mapping memory save skipped", err);
      warnings.push(
        `Row ${row.rowNumber}: memory save skipped (${err?.message || "error"})`,
      );
    }
  }

  return { warnings };
}

function enrichSuggestion(row) {
  const productName = row.products?.name || "Unknown product";
  const variantLabel = formatVariantLabel(row.product_variants);
  return {
    ...row,
    productName,
    variantLabel,
    mappedProductLabel: productName,
    mappedVariantLabel: variantLabel,
  };
}
