// Shared injected dependencies for analytics feature modules

let _state;
let _els;
let _showToast;
let _getClient;
let _loadCalendarPosts;
let _loadQueuePosts;

/**
 * @param {object} deps
 */
export function initAnalyticsContext(deps) {
  _state = deps.state;
  _els = deps.els;
  _showToast = deps.showToast;
  _getClient = deps.getClient;
  _loadCalendarPosts = deps.loadCalendarPosts;
  _loadQueuePosts = deps.loadQueuePosts;
}

export function getAnalyticsContext() {
  return {
    state: _state,
    els: _els,
    showToast: _showToast,
    getClient: _getClient,
    loadCalendarPosts: _loadCalendarPosts,
    loadQueuePosts: _loadQueuePosts,
  };
}
