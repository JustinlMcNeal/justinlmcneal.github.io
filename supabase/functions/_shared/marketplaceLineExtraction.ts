// Phase 10O — Extract line-level identifiers from marketplace finance/order payloads.

type LineExtract = {
  sourceOrderItemId: string | null;
  lineAllocationConfidence: "line_confirmed" | "sku_inferred" | "order_level" | "manual_review";
  sellerSku: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Map Amazon OrderItemId → stripe_line_item_id format. */
export function amazonStripeLineItemId(
  sourceOrderId: string,
  orderItemId: string,
): string {
  const amazonOrderId = sourceOrderId.replace(/^amazon_/, "");
  return `amazon_${amazonOrderId}_li_${orderItemId}`;
}

/** Map eBay lineItemId → stripe_line_item_id format. */
export function ebayStripeLineItemId(lineItemId: string): string {
  return `ebay_li_${lineItemId}`;
}

/** Extract line id from eBay finance / order raw payload. */
export function extractEbayLineFromPayload(
  _sourceOrderId: string,
  rawPayload: unknown,
  feeBreakdown?: unknown,
): LineExtract {
  const payload = asRecord(rawPayload);
  const breakdown = asArray(feeBreakdown ?? payload?.orderLineItems ?? payload?.fee_breakdown);

  for (const entry of breakdown) {
    const rec = asRecord(entry);
    const lineItemId = rec?.lineItemId ?? rec?.orderLineItemId ?? rec?.legacyItemId;
    if (lineItemId) {
      return {
        sourceOrderItemId: ebayStripeLineItemId(String(lineItemId)),
        lineAllocationConfidence: "line_confirmed",
        sellerSku: rec?.sku ? String(rec.sku) : null,
      };
    }
  }

  const lineItems = asArray(payload?.lineItems ?? payload?.orderLineItems);
  if (lineItems.length === 1) {
    const only = asRecord(lineItems[0]);
    const lineItemId = only?.lineItemId ?? only?.legacyItemId;
    if (lineItemId) {
      return {
        sourceOrderItemId: ebayStripeLineItemId(String(lineItemId)),
        lineAllocationConfidence: "line_confirmed",
        sellerSku: only?.sku ? String(only.sku) : null,
      };
    }
    const sku = only?.sku ?? only?.legacyVariationId;
    if (sku) {
      return {
        sourceOrderItemId: null,
        lineAllocationConfidence: "sku_inferred",
        sellerSku: String(sku),
      };
    }
  }

  return { sourceOrderItemId: null, lineAllocationConfidence: "order_level", sellerSku: null };
}

/** Extract line id from Amazon finance / order-item raw payload. */
export function extractAmazonLineFromPayload(
  sourceOrderId: string,
  rawPayload: unknown,
  feeBreakdown?: unknown,
): LineExtract {
  const payload = asRecord(rawPayload);
  const breakdown = asArray(feeBreakdown ?? payload?.fee_breakdown ?? payload?.OrderItems);

  for (const entry of breakdown) {
    const rec = asRecord(entry);
    const orderItemId = rec?.OrderItemId ?? rec?.orderItemId ?? rec?.shipmentItemId;
    const sellerSku = rec?.SellerSKU ?? rec?.sellerSKU ?? rec?.sellerSku;
    if (orderItemId) {
      return {
        sourceOrderItemId: amazonStripeLineItemId(sourceOrderId, String(orderItemId)),
        lineAllocationConfidence: "line_confirmed",
        sellerSku: sellerSku ? String(sellerSku) : null,
      };
    }
    if (sellerSku) {
      return {
        sourceOrderItemId: null,
        lineAllocationConfidence: "sku_inferred",
        sellerSku: String(sellerSku),
      };
    }
  }

  const items = asArray(payload?.OrderItems ?? payload?.orderItems);
  if (items.length === 1) {
    const only = asRecord(items[0]);
    const orderItemId = only?.OrderItemId ?? only?.orderItemId;
    if (orderItemId) {
      return {
        sourceOrderItemId: amazonStripeLineItemId(sourceOrderId, String(orderItemId)),
        lineAllocationConfidence: "line_confirmed",
        sellerSku: only?.SellerSKU ? String(only.SellerSKU) : null,
      };
    }
  }

  const related = asArray(payload?.relatedIdentifiers ?? payload?.RelatedIdentifiers);
  for (const rel of related) {
    const rec = asRecord(rel);
    const name = String(rec?.relatedIdentifierName ?? rec?.RelatedIdentifierName ?? "");
    if (name === "ORDER_ITEM_ID") {
      const id = rec?.relatedIdentifierValue ?? rec?.RelatedIdentifierValue;
      if (id) {
        return {
          sourceOrderItemId: amazonStripeLineItemId(sourceOrderId, String(id)),
          lineAllocationConfidence: "line_confirmed",
          sellerSku: null,
        };
      }
    }
  }

  return { sourceOrderItemId: null, lineAllocationConfidence: "order_level", sellerSku: null };
}
