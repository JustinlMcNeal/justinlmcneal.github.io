import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  // Extract slug from URL path: /share-coupon/my-coupon-slug
  const url = new URL(req.url);
  const slug = url.pathname.split("/").pop() || "";

  if (!slug) {
    return new Response(null, {
      status: 302,
      headers: { Location: "https://karrykraze.com/" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: promo, error } = await supabase
    .from("promotions")
    .select("coupon_slug, coupon_page_title, coupon_page_note, name, description, value, type, banner_image_path, end_date")
    .eq("coupon_slug", slug)
    .eq("coupon_landing_enabled", true)
    .eq("is_active", true)
    .maybeSingle();

  const siteUrl = "https://karrykraze.com";
  const couponUrl = `${siteUrl}/pages/coupon.html?promo=${encodeURIComponent(slug)}`;

  if (error || !promo) {
    return new Response(null, {
      status: 302,
      headers: { Location: couponUrl },
    });
  }

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Format the offer value for the description
  function formatOffer(): string {
    const type = String(promo.type || "").toLowerCase();
    const val = Number(promo.value || 0);
    if (type === "percentage") return `${val}% off`;
    if (type === "fixed") return `$${val.toFixed(2)} off`;
    if (type === "free-shipping") return "free shipping";
    if (type === "bogo") return "a BOGO deal";
    return "an exclusive deal";
  }

  const title = promo.coupon_page_title || promo.name || "Your Karry Kraze Coupon";
  const offer = formatOffer();
  const description = promo.coupon_page_note
    || promo.description
    || `You've unlocked ${offer} at Karry Kraze! Tap to reveal your exclusive coupon code.`;

  // Resolve banner image to a full URL
  let image = `${siteUrl}/imgs/brand/logo.png`;
  if (promo.banner_image_path) {
    const raw = String(promo.banner_image_path).trim();
    if (/^https?:\/\//i.test(raw)) {
      image = raw;
    } else {
      image = siteUrl + (raw.startsWith("/") ? raw : `/${raw}`);
    }
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} | Karry Kraze</title>

  <!-- Open Graph (iMessage, Discord, Facebook, etc.) -->
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${esc(image)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:url" content="${esc(couponUrl)}">
  <meta property="og:site_name" content="Karry Kraze">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(image)}">

  <!-- Redirect real users to the coupon page -->
  <meta http-equiv="refresh" content="0;url=${esc(couponUrl)}">
  <link rel="canonical" href="${esc(couponUrl)}">
</head>
<body>
  <p>Redirecting to <a href="${esc(couponUrl)}">${esc(title)}</a>...</p>
  <script>window.location.replace(${JSON.stringify(couponUrl)});</script>
</body>
</html>`;

  const body = new TextEncoder().encode(html);
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
});
