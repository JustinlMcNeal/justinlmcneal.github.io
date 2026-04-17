export default {
  async fetch(request) {
    const url = new URL(request.url);
    const slug = url.pathname.replace(/^\/s\//, "").replace(/\/+$/, "");

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
