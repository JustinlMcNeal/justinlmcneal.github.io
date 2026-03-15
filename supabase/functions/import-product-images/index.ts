// Import Product Images — Downloads supplier/external images to Supabase Storage
// Decouples the store from supplier CDNs, ensures images are always available.
// Called after product save or manually from admin.
//
// POST body:
//   { product_id: string }               — import all images for one product
//   { product_ids: string[] }             — batch import for multiple products
//   { product_id, urls: string[] }        — import specific URLs for a product

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Supported image types
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

// Guess extension from content-type
function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
  };
  return map[mime] || "jpg";
}

// Detect mime from bytes if Content-Type is missing/wrong
function detectMime(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 &&
    bytes[2] === 0x46 && bytes[3] === 0x46
  ) return "image/webp";
  if (
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46
  ) return "image/gif";
  return "image/jpeg"; // fallback
}

interface ImportResult {
  url: string;
  type: string;
  success: boolean;
  storage_path?: string;
  public_url?: string;
  size_bytes?: number;
  error?: string;
  skipped?: boolean;
}

async function downloadAndStore(
  supabase: any,
  productSlug: string,
  productId: string,
  url: string,
  imageType: string,
): Promise<ImportResult> {
  // Check if already imported
  const { data: existing } = await supabase
    .from("imported_product_images")
    .select("id, public_url, storage_path")
    .eq("product_id", productId)
    .eq("original_url", url)
    .single();

  if (existing) {
    return {
      url,
      type: imageType,
      success: true,
      storage_path: existing.storage_path,
      public_url: existing.public_url,
      skipped: true,
    };
  }

  // Download the image
  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; KarryKraze/1.0; +https://karrykraze.com)",
      },
    });
  } catch (fetchErr: any) {
    return { url, type: imageType, success: false, error: `Download failed: ${fetchErr.message}` };
  }

  if (!resp.ok) {
    return { url, type: imageType, success: false, error: `HTTP ${resp.status}` };
  }

  const bytes = new Uint8Array(await resp.arrayBuffer());

  if (bytes.length < 100) {
    return { url, type: imageType, success: false, error: "File too small — not a valid image" };
  }

  // Determine mime type
  const contentType = resp.headers.get("content-type")?.split(";")[0]?.trim() || "";
  const mime = ALLOWED_TYPES.has(contentType) ? contentType : detectMime(bytes);
  const ext = extFromMime(mime);

  // Upload to Supabase Storage
  const timestamp = Date.now();
  const rnd = Math.random().toString(36).substring(2, 6);
  const storagePath = `product-imports/${productSlug}/${imageType}_${timestamp}_${rnd}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from("social-media")
    .upload(storagePath, bytes, {
      contentType: mime,
      upsert: false,
    });

  if (uploadErr) {
    return { url, type: imageType, success: false, error: `Upload failed: ${uploadErr.message}` };
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from("social-media")
    .getPublicUrl(storagePath);

  const publicUrl = urlData.publicUrl;

  // Record the import
  await supabase.from("imported_product_images").insert({
    product_id: productId,
    original_url: url,
    storage_path: storagePath,
    public_url: publicUrl,
    image_type: imageType,
    file_size_bytes: bytes.length,
    mime_type: mime,
  });

  return {
    url,
    type: imageType,
    success: true,
    storage_path: storagePath,
    public_url: publicUrl,
    size_bytes: bytes.length,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { product_id, product_ids, urls } = body;

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Determine which products to process
    const ids: string[] = product_ids?.length
      ? product_ids
      : product_id
        ? [product_id]
        : [];

    if (!ids.length) {
      return new Response(
        JSON.stringify({ success: false, error: "product_id or product_ids[] required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Fetch product details
    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select(`
        id, name, slug,
        catalog_image_url,
        catalog_hover_url,
        primary_image_url
      `)
      .in("id", ids);

    if (prodErr || !products?.length) {
      return new Response(
        JSON.stringify({ success: false, error: "Products not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const allResults: { product_id: string; product_name: string; imports: ImportResult[] }[] = [];

    for (const product of products) {
      const imports: ImportResult[] = [];

      // If specific URLs provided, import those
      if (urls?.length && ids.length === 1) {
        for (const url of urls) {
          const result = await downloadAndStore(supabase, product.slug, product.id, url, "manual");
          imports.push(result);
        }
      } else {
        // Auto-detect all external image URLs for this product
        const imagesToImport: { url: string; type: string }[] = [];

        if (product.catalog_image_url && isExternalUrl(product.catalog_image_url)) {
          imagesToImport.push({ url: product.catalog_image_url, type: "catalog" });
        }
        if (product.catalog_hover_url && isExternalUrl(product.catalog_hover_url)) {
          imagesToImport.push({ url: product.catalog_hover_url, type: "hover" });
        }
        if (product.primary_image_url && isExternalUrl(product.primary_image_url)) {
          imagesToImport.push({ url: product.primary_image_url, type: "primary" });
        }

        // Also grab gallery images
        const { data: galleryRows } = await supabase
          .from("product_gallery_images")
          .select("url, position")
          .eq("product_id", product.id)
          .order("position");

        for (const row of galleryRows || []) {
          if (row.url && isExternalUrl(row.url)) {
            imagesToImport.push({ url: row.url, type: `gallery_${row.position}` });
          }
        }

        if (!imagesToImport.length) {
          allResults.push({
            product_id: product.id,
            product_name: product.name,
            imports: [{ url: "", type: "none", success: true, skipped: true }],
          });
          console.log(`[import-images] No external images for "${product.name}" — all already local`);
          continue;
        }

        console.log(`[import-images] Importing ${imagesToImport.length} images for "${product.name}"`);

        for (const img of imagesToImport) {
          const result = await downloadAndStore(supabase, product.slug, product.id, img.url, img.type);
          imports.push(result);

          // If catalog image was imported successfully, update the product record
          // to point to the local copy
          if (result.success && !result.skipped && result.public_url) {
            if (img.type === "catalog") {
              await supabase.from("products")
                .update({ catalog_image_url: result.public_url })
                .eq("id", product.id);
              console.log(`[import-images] Updated catalog_image_url for "${product.name}" to local copy`);
            } else if (img.type === "hover") {
              await supabase.from("products")
                .update({ catalog_hover_url: result.public_url })
                .eq("id", product.id);
            } else if (img.type === "primary") {
              await supabase.from("products")
                .update({ primary_image_url: result.public_url })
                .eq("id", product.id);
            } else if (img.type.startsWith("gallery_")) {
              // Update gallery image URL
              const pos = parseInt(img.type.split("_")[1]) || 0;
              await supabase.from("product_gallery_images")
                .update({ url: result.public_url })
                .eq("product_id", product.id)
                .eq("url", img.url);
            }
          }
        }
      }

      allResults.push({
        product_id: product.id,
        product_name: product.name,
        imports,
      });
    }

    const totalImported = allResults.reduce(
      (sum, r) => sum + r.imports.filter((i) => i.success && !i.skipped).length,
      0,
    );
    const totalSkipped = allResults.reduce(
      (sum, r) => sum + r.imports.filter((i) => i.skipped).length,
      0,
    );
    const totalFailed = allResults.reduce(
      (sum, r) => sum + r.imports.filter((i) => !i.success).length,
      0,
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: `Imported ${totalImported}, skipped ${totalSkipped}, failed ${totalFailed}`,
        imported: totalImported,
        skipped: totalSkipped,
        failed: totalFailed,
        results: allResults,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[import-images] Error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// Check if a URL is external (not already in our Supabase Storage)
function isExternalUrl(url: string): boolean {
  if (!url) return false;
  // Already in our storage — skip
  if (url.includes("supabase.co/storage")) return false;
  // Must be a valid http(s) URL
  return url.startsWith("http://") || url.startsWith("https://");
}
