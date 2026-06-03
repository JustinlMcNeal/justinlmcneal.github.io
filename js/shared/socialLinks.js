/**
 * Public Karry Kraze social profile URLs (customer-facing).
 * Used by the social landing page and footer icon href patching.
 */

export const PUBLIC_SOCIAL_PLATFORMS = [
  {
    id: "instagram",
    name: "Instagram",
    handle: "@karrykraze",
    url: "https://instagram.com/karrykraze",
    primary: true,
    cta: "Follow on Instagram",
  },
  {
    id: "tiktok",
    name: "TikTok",
    handle: "@karrykraze",
    url: "https://tiktok.com/@karrykraze",
    primary: false,
    cta: "Follow on TikTok",
  },
  {
    id: "pinterest",
    name: "Pinterest",
    handle: "@karrykraze",
    url: "https://pinterest.com/karrykraze",
    primary: false,
    cta: "Follow on Pinterest",
  },
];

/** @param {string} id */
export function getPublicSocialPlatform(id) {
  return PUBLIC_SOCIAL_PLATFORMS.find((p) => p.id === id);
}

/**
 * Set href on anchors marked with data-kk-social="{platformId}".
 * @param {ParentNode} [root]
 */
export function applyPublicSocialLinks(root = document) {
  for (const platform of PUBLIC_SOCIAL_PLATFORMS) {
    root.querySelectorAll(`[data-kk-social="${platform.id}"]`).forEach((el) => {
      if (el instanceof HTMLAnchorElement) {
        el.href = platform.url;
      }
    });
  }
}
