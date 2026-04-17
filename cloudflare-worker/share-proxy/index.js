export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // /s/img/* → proxy product images from Supabase storage
    if (path.startsWith("/s/img/")) {
      const imagePath = path.replace("/s/img/", "");
      const imageUrl =
        "https://yxdzvzscufkvewecvagq.supabase.co/storage/v1/object/public/products/catalog/" +
        imagePath;
      const imgRes = await fetch(imageUrl);
      return new Response(imgRes.body, {
        status: imgRes.status,
        headers: {
          "content-type": imgRes.headers.get("content-type") || "image/png",
          "cache-control": "public, max-age=86400",
        },
      });
    }

    // /s/{slug} → share page with OG tags
    const slug = path.replace(/^\/s\//, "").replace(/\/+$/, "");

    if (!slug) {
      return Response.redirect("https://karrykraze.com/", 302);
    }

    const supabaseUrl =
      "https://yxdzvzscufkvewecvagq.supabase.co/functions/v1/share-product/" +
      encodeURIComponent(slug);

    const res = await fetch(supabaseUrl);
    const html = await res.text();

    return new Response(html, {
      status: res.status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    });
  },
};
