// Amazon Orders API — confirmShipment after Shippo label purchase.

import type { AmazonCredentials } from "./amazonPtdAuthUtils.ts";
import { spApiPost } from "./amazonSpApiRequestUtils.ts";

const SHIPPO_TO_AMAZON_CARRIER: Record<string, string> = {
  usps: "USPS",
  ups: "UPS",
  fedex: "FedEx",
  dhl_express: "DHL",
  dhl: "DHL",
};

export function amazonOrderIdFromSession(sessionId: string): string | null {
  if (!sessionId.startsWith("amazon_")) return null;
  return sessionId.slice("amazon_".length) || null;
}

export function parseOrderItemIdFromLineKey(stripeLineItemId: string): string | null {
  const prefix = "_li_";
  const idx = stripeLineItemId.lastIndexOf(prefix);
  if (idx < 0) return null;
  return stripeLineItemId.slice(idx + prefix.length) || null;
}

export function mapCarrierToAmazonCode(carrier: string): string {
  const key = String(carrier || "").trim().toLowerCase();
  return SHIPPO_TO_AMAZON_CARRIER[key] || String(carrier || "USPS").toUpperCase();
}

type LineItemRow = { stripe_line_item_id: string; quantity: number | null };

export async function confirmAmazonShipment(
  creds: AmazonCredentials,
  input: {
    amazonOrderId: string;
    marketplaceId: string;
    trackingNumber: string;
    carrier: string;
    lineItems: LineItemRow[];
    packageReferenceId?: string;
  },
): Promise<{ ok: true } | { ok: false; error: string; hint?: string }> {
  const orderItems = input.lineItems
    .map((row) => {
      const orderItemId = parseOrderItemIdFromLineKey(row.stripe_line_item_id);
      if (!orderItemId) return null;
      return { orderItemId, quantity: Number(row.quantity || 1) || 1 };
    })
    .filter((row): row is { orderItemId: string; quantity: number } => row !== null);

  if (!orderItems.length) {
    return { ok: false, error: "missing_order_items" };
  }

  const carrierCode = mapCarrierToAmazonCode(input.carrier);
  const base = creds.endpoint.replace(/\/$/, "");
  const url = `${base}/orders/v0/orders/${encodeURIComponent(input.amazonOrderId)}/shipmentConfirmation`;

  const body = {
    marketplaceId: input.marketplaceId,
    packageDetail: {
      packageReferenceId: input.packageReferenceId || "1",
      carrierCode,
      carrierName: carrierCode === "Others" ? input.carrier : carrierCode,
      trackingNumber: input.trackingNumber,
      shipDate: new Date().toISOString(),
      orderItems,
    },
  };

  const result = await spApiPost(url, creds.accessToken, body, creds.aws);
  if (!result.ok) return result;
  return { ok: true };
}
