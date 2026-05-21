// Orchestrate full analytics tab refresh (avoids circular imports)

import { loadAnalyticsDashboard } from "./analyticsCharts.js";
import { loadLearningInsights } from "./learningInsights.js";
import { loadAccountLearningSummary } from "./accountLearningSummary.js";

export async function reloadAnalyticsTab() {
  await loadAnalyticsDashboard();
  await loadLearningInsights();
  await loadAccountLearningSummary();
}
