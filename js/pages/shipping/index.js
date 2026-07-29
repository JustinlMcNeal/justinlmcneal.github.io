import { initFooter } from "/js/shared/footer.js";
import { initNavbar } from "/js/shared/navbar.js";
import { renderPeakSeasonSection, renderQuestionsCta } from "./render/callouts.js";
import { renderNeedToKnowSection } from "./render/needToKnow.js";
import { renderRatesSection } from "./render/rates.js";
import { renderStatsGrid } from "./render/stats.js";
import { renderTimelineSection } from "./render/timeline.js";
import { loadFreeShippingDisplay } from "./ui/freeShippingSettings.js";

async function initShippingPage() {
  await initNavbar();
  await initFooter();

  let display;
  try {
    display = await loadFreeShippingDisplay();
    document.documentElement.dataset.shippingThreshold = String(display.threshold);
    document.documentElement.dataset.shippingFreeEnabled = String(display.enabled);
  } catch (err) {
    console.warn("[shipping] Failed to preload free shipping settings:", err);
    display = {
      statSublabel: "Orders $50+",
      ordersOverLabel: "Orders $50+",
      amount: "50",
      enabled: true,
    };
  }

  renderStatsGrid(document.getElementById("shippingStats"), display);
  renderRatesSection(document.getElementById("shippingRates"), display);
  renderTimelineSection(document.getElementById("shippingTimeline"));
  renderNeedToKnowSection(document.getElementById("shippingNeedToKnow"), display);
  renderPeakSeasonSection(document.getElementById("shippingPeakSeason"));
  renderQuestionsCta(document.getElementById("shippingCta"));
}

document.addEventListener("DOMContentLoaded", initShippingPage, { once: true });