/**
 * Auto-open Returns dashboard from inventory page URL params (Phase 10V).
 */

import { parseDashboardParams } from "../ui/returnsRestockDashboardDeepLink.js";

export async function maybeOpenDashboardFromUrl() {
  const params = parseDashboardParams();
  if (!params) return;
  const { openReturnsRestockDashboardModal } = await import("../ui/returnsRestockDashboardModal.js");
  await openReturnsRestockDashboardModal(params);
}
