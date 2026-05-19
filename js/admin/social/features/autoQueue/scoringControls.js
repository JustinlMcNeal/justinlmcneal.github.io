// Scoring weight form controls and compare toggle

import { getAutoQueueContext } from "./autoQueueContext.js";

export const DEFAULT_SCORING_WEIGHTS = {
  recency: 40,
  category: 25,
  image_freshness: 25,
  inventory_health: 10,
  penalties_enabled: true,
};

export function clampScoringWeight(val, fallback) {
  const n = parseInt(String(val ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(50, Math.max(0, n));
}

export function applyScoringWeightsToForm(weights) {
  const w = weights || DEFAULT_SCORING_WEIGHTS;
  const recency = document.getElementById("aqWeightRecency");
  const category = document.getElementById("aqWeightCategory");
  const imageFreshness = document.getElementById("aqWeightImageFreshness");
  const inventoryHealth = document.getElementById("aqWeightInventoryHealth");
  const penalties = document.getElementById("aqPenaltiesEnabled");
  if (recency) recency.value = String(clampScoringWeight(w.recency, DEFAULT_SCORING_WEIGHTS.recency));
  if (category) category.value = String(clampScoringWeight(w.category, DEFAULT_SCORING_WEIGHTS.category));
  if (imageFreshness) {
    imageFreshness.value = String(clampScoringWeight(w.image_freshness, DEFAULT_SCORING_WEIGHTS.image_freshness));
  }
  if (inventoryHealth) {
    inventoryHealth.value = String(clampScoringWeight(w.inventory_health, DEFAULT_SCORING_WEIGHTS.inventory_health));
  }
  if (penalties) penalties.checked = w.penalties_enabled !== false;
}

export function getScoringWeightsFromForm() {
  return {
    recency: clampScoringWeight(
      document.getElementById("aqWeightRecency")?.value,
      DEFAULT_SCORING_WEIGHTS.recency
    ),
    category: clampScoringWeight(
      document.getElementById("aqWeightCategory")?.value,
      DEFAULT_SCORING_WEIGHTS.category
    ),
    image_freshness: clampScoringWeight(
      document.getElementById("aqWeightImageFreshness")?.value,
      DEFAULT_SCORING_WEIGHTS.image_freshness
    ),
    inventory_health: clampScoringWeight(
      document.getElementById("aqWeightInventoryHealth")?.value,
      DEFAULT_SCORING_WEIGHTS.inventory_health
    ),
    penalties_enabled: document.getElementById("aqPenaltiesEnabled")?.checked !== false,
  };
}

export function resetScoringWeightsForm() {
  const { showToast } = getAutoQueueContext();
  applyScoringWeightsToForm(DEFAULT_SCORING_WEIGHTS);
  showToast?.("Scoring weights reset to defaults — click Save to persist") ||
    alert("Scoring weights reset to defaults. Click Save Auto-Queue Settings to persist.");
}

export function isCompareScoringEnabled() {
  const el = document.getElementById("aqCompareScoring");
  return el ? el.checked : true;
}
