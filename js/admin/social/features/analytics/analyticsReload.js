// Orchestrate full analytics tab refresh (avoids circular imports)

import { loadAnalyticsDashboard } from "./analyticsCharts.js";

export async function reloadAnalyticsTab() {
  await loadAnalyticsDashboard();
}
