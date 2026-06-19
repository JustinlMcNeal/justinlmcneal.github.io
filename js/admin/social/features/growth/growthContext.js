// Growth tab — DOM element lookup

/** @typedef {Record<string, HTMLElement|null>} GrowthElements */

let _els = null;

export function resolveGrowthElements() {
  if (_els) return _els;

  const $ = (id) => document.getElementById(id);

  _els = {
    filterRange: $("growthFilterRange"),
    filterPlatform: $("growthFilterPlatform"),
    filterMetric: $("growthFilterMetric"),
    btnRefresh: $("btnGrowthRefresh"),
    btnGoAnalytics: $("btnGrowthGoAnalytics"),
    btnRetry: $("btnGrowthRetry"),
    scoreValue: $("growthScoreValue"),
    scoreBadge: $("growthScoreBadge"),
    scoreHelper: $("growthScoreHelper"),
    cardLikes: $("growthCardLikes"),
    cardLikesChange: $("growthCardLikesChange"),
    cardComments: $("growthCardComments"),
    cardCommentsChange: $("growthCardCommentsChange"),
    cardSaves: $("growthCardSaves"),
    cardSavesChange: $("growthCardSavesChange"),
    cardImpressions: $("growthCardImpressions"),
    cardImpressionsChange: $("growthCardImpressionsChange"),
    cardReach: $("growthCardReach"),
    cardReachChange: $("growthCardReachChange"),
    cardEngRate: $("growthCardEngRate"),
    cardEngRateChange: $("growthCardEngRateChange"),
    mainChart: $("growthMainChart"),
    platformBreakdown: $("growthPlatformBreakdown"),
    platformBarInstagram: $("growthPlatformBarInstagram"),
    platformBarFacebook: $("growthPlatformBarFacebook"),
    platformBarPinterest: $("growthPlatformBarPinterest"),
    coverageDetails: $("growthCoverageDetails"),
    loadingState: $("growthLoadingState"),
    emptyState: $("growthEmptyState"),
    errorState: $("growthErrorState"),
  };

  return _els;
}

export function getGrowthElements() {
  return _els || resolveGrowthElements();
}
