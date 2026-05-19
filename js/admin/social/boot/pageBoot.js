// DOMContentLoaded entry — wire main init and analytics modal helpers

/**
 * @param {object} opts
 * @param {() => Promise<void>|void} opts.init
 * @param {() => void} opts.initPostAnalyticsModal
 * @param {() => void} opts.initLearningInsights
 */
export function startSocialAdminPage({ init, initPostAnalyticsModal, initLearningInsights }) {
  document.addEventListener("DOMContentLoaded", () => {
    init();
    initPostAnalyticsModal();
    initLearningInsights();
  });
}
