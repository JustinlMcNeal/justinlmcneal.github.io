// js/shared/pwa.js — PWA install prompt + push notification subscription
// Loaded by all pages via the shared head insert

const VAPID_PUBLIC_KEY = 'BGZxnWoDk6WbdvJXQFo9LVQJ1wyqig61T5A1bNvKeTHc1iJCe4t-xev1Bld0wmpSPpsbJiXLkEuuIlKKvdsbPLM';
const SUPABASE_URL = 'https://yxdzvzscufkvewecvagq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4ZHp2enNjdWZrdmV3ZWN2YWdxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU3MzQ5NDAsImV4cCI6MjA4MTMxMDk0MH0.cuCteItNo6yFCYcot0Vx7kUOUtV0r-iCwJ_ACAiKGso';

// ─── Service Worker Registration ─────────────────────────
let swRegistration = null;

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.log('[PWA] Service workers not supported');
    return null;
  }

  try {
    swRegistration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    console.log('[PWA] Service worker registered:', swRegistration.scope);

    // Check for updates every 60 minutes
    setInterval(() => swRegistration.update(), 60 * 60 * 1000);

    return swRegistration;
  } catch (err) {
    console.error('[PWA] Service worker registration failed:', err);
    return null;
  }
}

// ─── Install Prompt ──────────────────────────────────────
let deferredPrompt = null;
let installBanner = null;

function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('[PWA] Install prompt deferred');
    showInstallBanner();
  });

  window.addEventListener('appinstalled', () => {
    console.log('[PWA] App installed');
    deferredPrompt = null;
    hideInstallBanner();
    // Track install
    try {
      fetch(`${SUPABASE_URL}/rest/v1/pwa_events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ event_type: 'install', metadata: { timestamp: new Date().toISOString() } })
      }).catch(() => {});
    } catch {}
  });
}

function showInstallBanner() {
  // Don't show if already dismissed this session
  if (sessionStorage.getItem('kk-install-dismissed')) return;
  // Don't show if already installed (standalone mode)
  if (window.matchMedia('(display-mode: standalone)').matches) return;

  if (installBanner) return;

  installBanner = document.createElement('div');
  installBanner.id = 'kk-install-banner';
  installBanner.innerHTML = `
    <div style="
      position: fixed; bottom: 0; left: 0; right: 0; z-index: 9999;
      background: linear-gradient(135deg, #f58f86, #f6dcc6);
      color: #fff; padding: 14px 16px;
      display: flex; align-items: center; gap: 12px;
      box-shadow: 0 -2px 16px rgba(0,0,0,0.15);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      animation: slideUp 0.3s ease-out;
    ">
      <img src="/imgs/icons/icon-72x72.png" alt="KK" style="width:44px;height:44px;border-radius:10px;flex-shrink:0;" />
      <div style="flex:1;min-width:0;">
        <div style="font-weight:700;font-size:0.95rem;">Add Karry Kraze to Home Screen</div>
        <div style="font-size:0.8rem;opacity:0.9;">Quick access to deals & new arrivals</div>
      </div>
      <button id="kk-install-btn" style="
        background:#fff;color:#f58f86;border:none;padding:8px 18px;
        border-radius:6px;font-weight:700;font-size:0.85rem;cursor:pointer;
        white-space:nowrap;flex-shrink:0;
      ">Install</button>
      <button id="kk-install-close" style="
        background:none;border:none;color:#fff;font-size:1.4rem;
        cursor:pointer;padding:4px 8px;opacity:0.8;flex-shrink:0;
      ">&times;</button>
    </div>
    <style>
      @keyframes slideUp {
        from { transform: translateY(100%); }
        to { transform: translateY(0); }
      }
    </style>
  `;
  document.body.appendChild(installBanner);

  document.getElementById('kk-install-btn').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log('[PWA] Install choice:', outcome);
    deferredPrompt = null;
    hideInstallBanner();
  });

  document.getElementById('kk-install-close').addEventListener('click', () => {
    sessionStorage.setItem('kk-install-dismissed', '1');
    hideInstallBanner();
  });
}

function hideInstallBanner() {
  if (installBanner) {
    installBanner.remove();
    installBanner = null;
  }
}

// ─── Push Notification Subscription ──────────────────────
export async function subscribeToPush() {
  if (!('PushManager' in window)) {
    console.log('[PWA] Push not supported');
    return null;
  }

  const reg = swRegistration || await navigator.serviceWorker.ready;

  // Check existing subscription
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    console.log('[PWA] Already subscribed to push');
    return sub;
  }

  try {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    });

    console.log('[PWA] Push subscription created');

    // Save subscription to Supabase
    await saveSubscription(sub);

    return sub;
  } catch (err) {
    console.error('[PWA] Push subscription failed:', err);
    return null;
  }
}

export async function unsubscribeFromPush() {
  const reg = swRegistration || await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;

  const endpoint = sub.endpoint;
  await sub.unsubscribe();

  // Remove from Supabase
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      }
    });
  } catch {}

  console.log('[PWA] Unsubscribed from push');
}

async function saveSubscription(sub) {
  const subJSON = sub.toJSON();
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        endpoint: subJSON.endpoint,
        keys_p256dh: subJSON.keys?.p256dh || null,
        keys_auth: subJSON.keys?.auth || null,
        user_agent: navigator.userAgent,
        subscribed_at: new Date().toISOString(),
        is_active: true
      })
    });
    if (!resp.ok) {
      // Endpoint may already exist (unique constraint) — try updating instead
      if (resp.status === 409) {
        await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(subJSON.endpoint)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            keys_p256dh: subJSON.keys?.p256dh || null,
            keys_auth: subJSON.keys?.auth || null,
            user_agent: navigator.userAgent,
            is_active: true
          })
        });
        console.log('[PWA] Subscription updated in DB');
      } else {
        console.error('[PWA] Subscription save failed:', resp.status);
      }
    } else {
      console.log('[PWA] Subscription saved to DB');
    }
  } catch (err) {
    console.error('[PWA] Failed to save subscription:', err);
  }
}

// ─── Push Permission UI ─────────────────────────────────
export function showPushPrompt() {
  if (Notification.permission === 'granted') {
    subscribeToPush();
    return;
  }
  if (Notification.permission === 'denied') return;

  // Show a soft prompt first (better UX than raw browser prompt)
  if (sessionStorage.getItem('kk-push-dismissed')) return;

  // Wait 30 seconds after page load before showing
  setTimeout(() => {
    if (Notification.permission !== 'default') return;

    const prompt = document.createElement('div');
    prompt.id = 'kk-push-prompt';
    prompt.innerHTML = `
      <div style="
        position: fixed; bottom: 80px; right: 16px; z-index: 9998;
        background: #fff; border-radius: 12px; padding: 16px 20px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.15); max-width: 320px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        animation: fadeSlideUp 0.3s ease-out;
      ">
        <div style="font-weight:700;font-size:0.95rem;margin-bottom:6px;color:#333;">
          🔔 Stay in the loop!
        </div>
        <div style="font-size:0.85rem;color:#666;margin-bottom:12px;line-height:1.5;">
          Get notified about flash deals, new arrivals, and order updates.
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="kk-push-later" style="
            background:none;border:1px solid #ddd;padding:6px 14px;
            border-radius:6px;font-size:0.8rem;cursor:pointer;color:#999;
          ">Maybe Later</button>
          <button id="kk-push-allow" style="
            background:#f58f86;color:#fff;border:none;padding:6px 16px;
            border-radius:6px;font-weight:600;font-size:0.8rem;cursor:pointer;
          ">Enable</button>
        </div>
      </div>
      <style>
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      </style>
    `;
    document.body.appendChild(prompt);

    document.getElementById('kk-push-allow').addEventListener('click', async () => {
      prompt.remove();
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        await subscribeToPush();
      }
    });

    document.getElementById('kk-push-later').addEventListener('click', () => {
      sessionStorage.setItem('kk-push-dismissed', '1');
      prompt.remove();
    });
  }, 30_000);
}

// ─── Helpers ─────────────────────────────────────────────
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ─── Auto-init ───────────────────────────────────────────
export async function initPWA() {
  setupInstallPrompt();
  await registerServiceWorker();

  // Auto subscribe if already granted
  if (Notification.permission === 'granted') {
    subscribeToPush();
  } else {
    // Show soft push prompt on customer-facing pages (not admin)
    if (!window.location.pathname.includes('/admin/')) {
      showPushPrompt();
    }
  }
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPWA);
} else {
  initPWA();
}
