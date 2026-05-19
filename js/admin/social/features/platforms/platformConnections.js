// Platform connect buttons and connection status UI

import { getPlatformsContext } from "./platformsContext.js";

export function setupPlatformConnectButtons() {
  const pinBtn = document.getElementById("connect-pinterest");
  if (pinBtn) {
    pinBtn.addEventListener("click", () => {
      const appId = "1542566";
      const redirectUri = encodeURIComponent("https://karrykraze.com/pages/admin/social.html");
      const scope = "pins:read,pins:write,boards:read,boards:write";
      window.location.href = `https://www.pinterest.com/oauth/?response_type=code&client_id=${appId}&redirect_uri=${redirectUri}&scope=${scope}`;
    });
  }

  const igBtn = document.getElementById("connect-instagram");
  if (igBtn) {
    igBtn.addEventListener("click", () => {
      const appId = "2162145877936737";
      const redirectUri = encodeURIComponent("https://karrykraze.com/pages/admin/social.html");
      const scope = "instagram_basic,instagram_content_publish,instagram_manage_insights,pages_read_engagement,business_management,pages_show_list";
      const oauthState = "instagram";
      window.location.href = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code&state=${oauthState}`;
    });
  }
}

export async function checkConnectionStatus() {
  const { getSupabaseClient } = getPlatformsContext();
  const client = getSupabaseClient();

  const { data: igData } = await client
    .from("social_settings").select("setting_key, setting_value")
    .in("setting_key", ["instagram_connected", "instagram_username"]);

  const igConnected = igData?.find(s => s.setting_key === "instagram_connected")?.setting_value?.connected;
  const igUsername = igData?.find(s => s.setting_key === "instagram_username")?.setting_value?.username;

  const igStatusIcon = document.getElementById("instagramStatusIcon");
  const igStatusText = document.getElementById("instagramStatusText");
  const igConnectBtn = document.getElementById("connect-instagram");
  const igTestBtn = document.getElementById("instagramTestBtn");

  if (igConnected && igUsername) {
    if (igStatusIcon) igStatusIcon.textContent = "\u25cf";
    if (igStatusIcon) igStatusIcon.classList.replace("text-gray-400", "text-green-500");
    if (igStatusText) igStatusText.textContent = `@${igUsername}`;
    if (igStatusText) igStatusText.classList.replace("text-gray-400", "text-green-600");
    if (igTestBtn) igTestBtn.classList.remove("hidden");
    if (igConnectBtn) {
      igConnectBtn.innerHTML = `
        <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
        </svg>
        <span class="hidden xs:inline">\u2713</span> Instagram
      `;
      igConnectBtn.classList.remove("from-purple-500", "via-pink-500", "to-orange-500");
      igConnectBtn.classList.add("bg-green-600");
    }
  }

  const { data: pinData } = await client
    .from("social_settings").select("setting_key, setting_value")
    .in("setting_key", ["pinterest_connected"]);

  const pinConnected = pinData?.find(s => s.setting_key === "pinterest_connected")?.setting_value?.connected;

  const pinStatusIcon = document.getElementById("pinterestStatusIcon");
  const pinStatusText = document.getElementById("pinterestStatusText");
  const pinConnectBtn = document.getElementById("connect-pinterest");

  if (pinConnected) {
    if (pinStatusIcon) pinStatusIcon.textContent = "\u25cf";
    if (pinStatusIcon) pinStatusIcon.classList.replace("text-gray-400", "text-green-500");
    if (pinStatusText) pinStatusText.textContent = "Connected";
    if (pinStatusText) pinStatusText.classList.replace("text-gray-400", "text-green-600");
    if (pinConnectBtn) {
      pinConnectBtn.innerHTML = `
        <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.406.042-3.442.218-.936 1.407-5.965 1.407-5.965s-.359-.719-.359-1.781c0-1.669.967-2.914 2.171-2.914 1.024 0 1.518.769 1.518 1.69 0 1.03-.655 2.569-.994 3.995-.283 1.195.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.208 0 1.031.397 2.137.893 2.739.098.119.112.223.083.344-.091.378-.293 1.194-.333 1.361-.052.218-.173.265-.4.16-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.966 7.398 6.931 0 4.136-2.608 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/>
        </svg>
        <span class="hidden xs:inline">\u2713</span> Pinterest
      `;
      pinConnectBtn.classList.remove("bg-pinterest");
      pinConnectBtn.classList.add("bg-green-600");
    }
  }
}
