import { initFooter } from "/js/shared/footer.js";
import { initNavbar } from "/js/shared/navbar.js";
import { renderQuestionsCta } from "./render/cta.js";
import { renderHighlights } from "./render/highlights.js";
import { renderHowToSection } from "./render/howTo.js";
import { renderMarketplaceSection } from "./render/marketplace.js";
import { renderPolicySection } from "./render/policy.js";

async function initReturnsPage() {
  await initNavbar();
  await initFooter();

  renderHighlights(document.getElementById("returnsHighlights"));
  renderPolicySection(document.getElementById("returnsPolicy"));
  renderHowToSection(document.getElementById("returnsHowTo"));
  renderMarketplaceSection(document.getElementById("returnsMarketplace"));
  renderQuestionsCta(document.getElementById("returnsCta"));
}

document.addEventListener("DOMContentLoaded", initReturnsPage, { once: true });
