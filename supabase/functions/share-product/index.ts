import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  // Extract slug from URL path: /share-product/my-product-slug
  const url = new URL(req.url);
  const slug = url.pathname.split("/").pop() || "";

  if (!slug) {
    return new Response("Missing product slug", { status: 400 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: product, error } = await supabase
    .from("products")
    .select("name, slug, price, catalog_image_url")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !product) {
    return new Response(null, {
      status: 302,
      headers: { Location: "https://karrykraze.com/" },
    });
  }

  const siteUrl = "https://karrykraze.com";
  const productUrl = `${siteUrl}/pages/product.html?slug=${encodeURIComponent(product.slug)}`;
  const title = product.name || "Karry Kraze";
  const price = product.price
    ? `$${Number(product.price).toFixed(2)}`
    : "";
  const description = `${title}${price ? ` - ${price}` : ""} | Shop at Karry Kraze`;
  const image = product.catalog_image_url || `${siteUrl}/imgs/brand/logo.png`;

  // Sanitize for HTML attributes
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} | Karry Kraze</title>

  <!-- Open Graph (iMessage, Discord, Facebook, etc.) -->
  <meta property="og:type" content="product">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${esc(image)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:url" content="${esc(productUrl)}">
  <meta property="og:site_name" content="Karry Kraze">
  ${price ? `<meta property="product:price:amount" content="${esc(String(product.price))}">
  <meta property="product:price:currency" content="USD">` : ""}

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(image)}">

  <!-- Redirect real users to the product page -->
  <meta http-equiv="refresh" content="0;url=${esc(productUrl)}">
  <link rel="canonical" href="${esc(productUrl)}">
</head>
<body>
  <p>Redirecting to <a href="${esc(productUrl)}">${esc(title)}</a>...</p>
  <script>window.location.replace(${JSON.stringify(productUrl)});</script>
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
