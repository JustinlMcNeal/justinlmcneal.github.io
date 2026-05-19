// Shared injected dependencies for auto-queue feature modules

let _state;
let _els;
let _showToast;
let _getClient;
let _SUPABASE_FUNCTIONS_URL;
let _loadStats;
let _loadAutoQueueStats;
let _switchTab;
let _loadQueuePosts;

/**
 * @param {object} deps
 */
export function initAutoQueueContext(deps) {
  _state = deps.state;
  _els = deps.els;
  _showToast = deps.showToast;
  _getClient = deps.getClient;
  _SUPABASE_FUNCTIONS_URL = deps.SUPABASE_FUNCTIONS_URL;
  _loadStats = deps.loadStats;
  _loadAutoQueueStats = deps.loadAutoQueueStats;
  _switchTab = deps.switchTab;
  _loadQueuePosts = deps.loadQueuePosts;
}

export function getAutoQueueContext() {
  return {
    state: _state,
    els: _els,
    showToast: _showToast,
    getClient: _getClient,
    SUPABASE_FUNCTIONS_URL: _SUPABASE_FUNCTIONS_URL,
    loadStats: _loadStats,
    loadAutoQueueStats: _loadAutoQueueStats,
    switchTab: _switchTab,
    loadQueuePosts: _loadQueuePosts,
  };
}
