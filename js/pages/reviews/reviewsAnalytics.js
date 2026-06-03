const firedEvents = new Set();

export function trackReviewsEvent(eventName, payload = {}) {
  if (!eventName || firedEvents.has(eventName)) return;
  firedEvents.add(eventName);

  try {
    if (typeof gtag === "function") {
      gtag("event", eventName, payload);
    }
  } catch (err) {
    console.warn("[reviews] analytics error:", err);
  }
}
