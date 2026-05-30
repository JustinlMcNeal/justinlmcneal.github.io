import { qs, setHydrateText } from "./dom.js";

const DEFAULT_PUSH = {
  title: "Cat Ear Beanie",
  sku: "KK-BEANIE-CAT",
  price: "$14.99",
  stock: "56",
  readiness: "Ready",
};

/**
 * @param {ParentNode} root
 * @param {string} label
 * @returns {string}
 */
function readLabeledValue(root, label) {
  const nodes = root.querySelectorAll("dl div, .grid div");
  for (const node of nodes) {
    const dt = node.querySelector("dt, span.text-gray-400");
    const dd = node.querySelector("dd, span.font-bold, span.font-medium");
    if (dt?.textContent?.trim().startsWith(label)) {
      return dd?.textContent?.trim() || "";
    }
    if (dt?.textContent?.trim() === label) {
      return dd?.textContent?.trim() || "";
    }
  }

  const spans = root.querySelectorAll("div");
  for (const span of spans) {
    if (span.querySelector(".text-gray-400")?.textContent?.trim() === label) {
      const value = span.querySelector(".font-bold, .font-medium");
      if (value) return value.textContent.trim();
    }
  }

  return "";
}

/**
 * @param {HTMLElement | null | undefined} card
 * @returns {{ title: string, sku: string, price: string, stock: string, readiness: string }}
 */
function readPushCard(card) {
  if (!card) return { ...DEFAULT_PUSH };

  const title = card.querySelector("h3")?.textContent?.trim() || DEFAULT_PUSH.title;
  const sku = card.dataset.sku || card.querySelector(".font-mono")?.textContent?.trim() || DEFAULT_PUSH.sku;
  const price = readLabeledValue(card, "KK Price") || DEFAULT_PUSH.price;
  const stockRaw = readLabeledValue(card, "Website Stock");
  const stock = stockRaw.replace(/\s*units?$/i, "") || DEFAULT_PUSH.stock;
  const readiness =
    card.dataset.readiness?.replace(/-/g, " ") ||
    card.querySelector("[class*='rounded-full']")?.textContent?.trim() ||
    DEFAULT_PUSH.readiness;

  return { title, sku, price, stock, readiness };
}

/**
 * @param {HTMLElement | null | undefined} card
 * @returns {Record<string, string>}
 */
function readMappingCard(card) {
  if (!card) {
    return {
      title: "Blush Everyday Tote",
      asin: "B0KK4LEGACY1",
      amazonSku: "AMZ-BLUSH-TOTE-OLD",
      status: "Active",
      suggestedMatch: "KK-TOTE-BLSH",
      confidence: "High",
    };
  }

  const title = card.querySelector("h3")?.textContent?.trim() || "—";
  const asin = card.dataset.asin || readLabeledValue(card, "ASIN") || "—";
  const amazonSku = card.dataset.amazonSku || readLabeledValue(card, "Amazon SKU") || "—";
  const status =
    readLabeledValue(card, "Status") ||
    card.querySelector("dl [class*='rounded-full']")?.textContent?.trim() ||
    "—";
  let suggestedMatch = readLabeledValue(card, "Suggested match");
  if (!suggestedMatch || suggestedMatch.toLowerCase() === "none found") {
    suggestedMatch = "None found";
  }
  const confidenceRaw = card.dataset.confidence || "";
  const confidence = confidenceRaw
    ? confidenceRaw.charAt(0).toUpperCase() + confidenceRaw.slice(1)
    : card.textContent.match(/Confidence:\s*(\w+)/i)?.[1] || "—";

  return { title, asin, amazonSku, status, suggestedMatch, confidence };
}

export function initAmazonMockHydration() {
  /**
   * @param {HTMLElement | null | undefined} trigger
   * @param {{ draftMode?: boolean }} [options]
   */
  function hydratePushModal(trigger, options = {}) {
    const modal = qs("#amazonPushModal");
    if (!modal) return;

    const card = trigger?.closest("article");
    const data = readPushCard(card);
    const sku = trigger?.dataset?.sku || data.sku;

    setHydrateText(modal, "push-title", data.title);
    setHydrateText(modal, "push-sku", sku);
    setHydrateText(modal, "push-price", data.price);
    setHydrateText(modal, "push-stock", data.stock);
    setHydrateText(modal, "push-readiness", data.readiness);
    setHydrateText(modal, "push-review-product", data.title);
    setHydrateText(modal, "push-review-price-qty", `${data.price} · ${data.stock} units · FBM`);

    const titleEl = qs("#amazonPushModalTitle", modal);
    if (titleEl) {
      titleEl.textContent = options.draftMode
        ? "Create Amazon Draft"
        : "Push Product to Amazon";
    }

    const statusEl = qs('[data-hydrate="push-review-status"]', modal);
    if (statusEl) {
      statusEl.textContent = options.draftMode ? "Draft — not saved" : "Draft — not submitted";
    }
  }

  /** @param {HTMLElement | null | undefined} trigger */
  function hydrateMappingModal(trigger) {
    const modal = qs("#amazonMappingModal");
    if (!modal) return;

    const card = trigger?.closest("article");
    const data = readMappingCard(card);

    setHydrateText(modal, "mapping-title", data.title);
    setHydrateText(modal, "mapping-asin", data.asin);
    setHydrateText(modal, "mapping-amazon-sku", data.amazonSku);
    setHydrateText(modal, "mapping-status", data.status);
    setHydrateText(modal, "mapping-suggested-match", data.suggestedMatch);
    setHydrateText(modal, "mapping-confidence", data.confidence);
    setHydrateText(modal, "mapping-suggested-name", data.suggestedMatch === "None found" ? data.title : data.title);
    setHydrateText(modal, "mapping-suggested-sku", data.suggestedMatch);
  }

  return { hydratePushModal, hydrateMappingModal };
}
