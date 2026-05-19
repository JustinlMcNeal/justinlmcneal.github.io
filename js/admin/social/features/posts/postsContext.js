// Shared injected dependencies for posts / queue / post-detail modules

let _state;
let _els;
let _showToast;
let _getClient;
let _postToInstagram;
let _postToFacebook;
let _postToPinterest;
let _loadStats;
let _loadAutoQueueStats;
let _loadCalendarPosts;
let _loadQueuePosts;
let _switchTab;
let _populateBoardDropdown;

/**
 * @param {object} deps
 */
export function initPostsContext(deps) {
  if (deps.state !== undefined) _state = deps.state;
  if (deps.els !== undefined) _els = deps.els;
  if (deps.showToast !== undefined) _showToast = deps.showToast;
  if (deps.getClient !== undefined) _getClient = deps.getClient;
  if (deps.postToInstagram !== undefined) _postToInstagram = deps.postToInstagram;
  if (deps.postToFacebook !== undefined) _postToFacebook = deps.postToFacebook;
  if (deps.postToPinterest !== undefined) _postToPinterest = deps.postToPinterest;
  if (deps.loadStats !== undefined) _loadStats = deps.loadStats;
  if (deps.loadAutoQueueStats !== undefined) _loadAutoQueueStats = deps.loadAutoQueueStats;
  if (deps.loadCalendarPosts !== undefined) _loadCalendarPosts = deps.loadCalendarPosts;
  if (deps.loadQueuePosts !== undefined) _loadQueuePosts = deps.loadQueuePosts;
  if (deps.switchTab !== undefined) _switchTab = deps.switchTab;
  if (deps.populateBoardDropdown !== undefined) _populateBoardDropdown = deps.populateBoardDropdown;
}

export function getPostsContext() {
  return {
    state: _state,
    els: _els,
    showToast: _showToast,
    getClient: _getClient,
    postToInstagram: _postToInstagram,
    postToFacebook: _postToFacebook,
    postToPinterest: _postToPinterest,
    loadStats: _loadStats,
    loadAutoQueueStats: _loadAutoQueueStats,
    loadCalendarPosts: _loadCalendarPosts,
    loadQueuePosts: _loadQueuePosts,
    switchTab: _switchTab,
    populateBoardDropdown: _populateBoardDropdown,
  };
}
