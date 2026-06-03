import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Channel = "website" | "ebay" | "amazon" | "other";

type AnalyticsRow = {
  metric_date: string;
  channel: Channel;
  grain_type: "channel_day" | "product_day";
  product_bucket: string;
  product_code: string | null;
  orders_count: number;
  units_sold: number;
  revenue_cents: number;
  abandoned_carts: number;
  recovered_carts: number;
};

type RequestPayload = {
  start_date?: string;
  end_date?: string;
  days?: number;
  refresh?: boolean;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDateRange(payload: RequestPayload) {
  const days = Math.min(120, Math.max(1, Number(payload.days ?? 30)));
  const now = new Date();
  const endDefault = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const startDefault = new Date(endDefault.getTime() - (days - 1) * 86400000);

  const start = payload.start_date ? new Date(payload.start_date + "T00:00:00Z") : startDefault;
  const end = payload.end_date ? new Date(payload.end_date + "T00:00:00Z") : endDefault;

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid date range");
  }
  if (end < start) {
    throw new Error("end_date must be on or after start_date");
  }

  return {
    startDate: toIsoDate(start),
    endDate: toIsoDate(end),
  };
}

function mapChannel(sessionId: string | null | undefined): Channel {
  const s = sessionId || "";
  if (s.startsWith("ebay_api_") || s.startsWith("ebay_")) return "ebay";
  if (s.startsWith("amazon_")) return "amazon";
  if (s.startsWith("cs_")) return "website";
  return "other";
}

function decodeJwtRole(authHeader: string | null): string | null {
  if (!authHeader?.toLowerCase().startsWith("bearer ")) return null;
  const token = authHeader.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const jsonPayload = atob(padded);
    const parsed = JSON.parse(jsonPayload) as { role?: string };
    return parsed.role || null;
  } catch {
    return null;
  }
}

function sumChannelRows(rows: AnalyticsRow[]) {
  const byChannel = new Map<Channel, {
    channel: Channel;
    orders: number;
    units: number;
    revenue_cents: number;
  }>();

  for (const row of rows) {
    const prev = byChannel.get(row.channel) || {
      channel: row.channel,
      orders: 0,
      units: 0,
      revenue_cents: 0,
    };
    prev.orders += Number(row.orders_count || 0);
    prev.units += Number(row.units_sold || 0);
    prev.revenue_cents += Number(row.revenue_cents || 0);
    byChannel.set(row.channel, prev);
  }

  return ["website", "ebay", "amazon", "other"].map((channel) => {
    const base = byChannel.get(channel as Channel) || {
      channel: channel as Channel,
      orders: 0,
      units: 0,
      revenue_cents: 0,
    };
    const aov_cents = base.orders > 0 ? Math.round(base.revenue_cents / base.orders) : 0;
    return { ...base, aov_cents };
  });
}

function buildTimeSeries(channelRows: AnalyticsRow[]) {
  const map = new Map<string, {
    metric_date: string;
    website_revenue_cents: number;
    ebay_revenue_cents: number;
    amazon_revenue_cents: number;
    other_revenue_cents: number;
    website_orders: number;
    ebay_orders: number;
    amazon_orders: number;
    other_orders: number;
  }>();

  for (const row of channelRows) {
    const rec = map.get(row.metric_date) || {
      metric_date: row.metric_date,
      website_revenue_cents: 0,
      ebay_revenue_cents: 0,
      amazon_revenue_cents: 0,
      other_revenue_cents: 0,
      website_orders: 0,
      ebay_orders: 0,
      amazon_orders: 0,
      other_orders: 0,
    };

    const revenue = Number(row.revenue_cents || 0);
    const orders = Number(row.orders_count || 0);
    if (row.channel === "website") {
      rec.website_revenue_cents += revenue;
      rec.website_orders += orders;
    } else if (row.channel === "ebay") {
      rec.ebay_revenue_cents += revenue;
      rec.ebay_orders += orders;
    } else if (row.channel === "amazon") {
      rec.amazon_revenue_cents += revenue;
      rec.amazon_orders += orders;
    } else {
      rec.other_revenue_cents += revenue;
      rec.other_orders += orders;
    }

    map.set(row.metric_date, rec);
  }

  return [...map.values()].sort((a, b) => a.metric_date.localeCompare(b.metric_date));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    return json({ error: "Server misconfigured" }, 500);
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const jwtRole = decodeJwtRole(authHeader);
    const isServiceRoleToken = jwtRole === "service_role";

    if (!isServiceRoleToken) {
      const caller = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });

      const { data: userData, error: userErr } = await caller.auth.getUser();
      if (userErr || !userData?.user) {
        return json({ error: "Unauthorized" }, 401);
      }

      const { data: isAdmin, error: adminErr } = await caller.rpc("is_admin");
      if (adminErr || !isAdmin) {
        return json({ error: "Forbidden" }, 403);
      }
    }

    const payload: RequestPayload = req.method === "POST"
      ? ((await req.json()) as RequestPayload)
      : {
          start_date: new URL(req.url).searchParams.get("start_date") || undefined,
          end_date: new URL(req.url).searchParams.get("end_date") || undefined,
          days: Number(new URL(req.url).searchParams.get("days") || 30),
          refresh: ["1", "true", "yes"].includes((new URL(req.url).searchParams.get("refresh") || "").toLowerCase()),
        };

    const { startDate, endDate } = parseDateRange(payload);

    const sb = createClient(supabaseUrl, supabaseServiceKey);

    if (payload.refresh) {
      const { error: refreshErr } = await sb.rpc("analytics_backfill", {
        p_start: startDate,
        p_end: endDate,
      });
      if (refreshErr) {
        return json({ error: `Refresh failed: ${refreshErr.message}` }, 500);
      }
    }

    const { data: analyticsRows, error: analyticsErr } = await sb
      .from("analytics_daily")
      .select("metric_date,channel,grain_type,product_bucket,product_code,orders_count,units_sold,revenue_cents,abandoned_carts,recovered_carts")
      .gte("metric_date", startDate)
      .lte("metric_date", endDate);

    if (analyticsErr) {
      return json({ error: analyticsErr.message }, 500);
    }

    const typedRows = (analyticsRows || []) as AnalyticsRow[];
    const channelRows = typedRows.filter((r) => r.grain_type === "channel_day");
    const productRows = typedRows.filter((r) => r.grain_type === "product_day");

    const channelKpis = sumChannelRows(channelRows);
    const timeseries = buildTimeSeries(channelRows);

    const websiteChannelRows = channelRows.filter((r) => r.channel === "website");
    const abandoned = websiteChannelRows.reduce((s, r) => s + Number(r.abandoned_carts || 0), 0);
    const recovered = websiteChannelRows.reduce((s, r) => s + Number(r.recovered_carts || 0), 0);
    const websiteTotals = channelKpis.find((k) => k.channel === "website") || {
      channel: "website",
      orders: 0,
      units: 0,
      revenue_cents: 0,
      aov_cents: 0,
    };

    const websiteFunnel = {
      website_orders: websiteTotals.orders,
      website_revenue_cents: websiteTotals.revenue_cents,
      abandoned_carts: abandoned,
      recovered_carts: recovered,
      recovery_rate_pct: abandoned > 0 ? Number(((recovered / abandoned) * 100).toFixed(2)) : 0,
    };

    const productMap = new Map<string, {
      product_code: string;
      product_bucket: string;
      orders: number;
      units: number;
      revenue_cents: number;
    }>();

    for (const row of productRows) {
      const key = `${row.product_bucket}::${row.product_code || "__unmatched__"}`;
      const prev = productMap.get(key) || {
        product_code: row.product_code || "__unmatched__",
        product_bucket: row.product_bucket,
        orders: 0,
        units: 0,
        revenue_cents: 0,
      };
      prev.orders += Number(row.orders_count || 0);
      prev.units += Number(row.units_sold || 0);
      prev.revenue_cents += Number(row.revenue_cents || 0);
      productMap.set(key, prev);
    }

    const topProductsRaw = [...productMap.values()]
      .map((p) => ({
        ...p,
        aov_cents: p.orders > 0 ? Math.round(p.revenue_cents / p.orders) : 0,
      }))
      .sort((a, b) => b.revenue_cents - a.revenue_cents)
      .slice(0, 20);

    const productIds = [
      ...new Set(
        topProductsRaw
          .map((p) => p.product_bucket)
          .filter((id) => id && id !== "__unmatched__"),
      ),
    ];
    const productCodes = [
      ...new Set(
        topProductsRaw
          .map((p) => p.product_code)
          .filter((code) => code && code !== "__unmatched__"),
      ),
    ];

    const productById = new Map<string, Record<string, unknown>>();
    const productByCode = new Map<string, Record<string, unknown>>();

    if (productIds.length) {
      const { data: productsById, error: productsByIdErr } = await sb
        .from("products")
        .select("id,code,name,catalog_image_url,primary_image_url")
        .in("id", productIds);
      if (productsByIdErr) return json({ error: productsByIdErr.message }, 500);
      for (const row of productsById || []) {
        productById.set(String(row.id), row);
        if (row.code) productByCode.set(String(row.code), row);
      }
    }

    const missingCodes = productCodes.filter((code) => !productByCode.has(code));
    if (missingCodes.length) {
      const { data: productsByCode, error: productsByCodeErr } = await sb
        .from("products")
        .select("id,code,name,catalog_image_url,primary_image_url")
        .in("code", missingCodes);
      if (productsByCodeErr) return json({ error: productsByCodeErr.message }, 500);
      for (const row of productsByCode || []) {
        productById.set(String(row.id), row);
        if (row.code) productByCode.set(String(row.code), row);
      }
    }

    const topProducts = topProductsRaw.map((p) => {
      const product = productById.get(p.product_bucket) || productByCode.get(p.product_code) || null;
      const imageUrl = product?.catalog_image_url || product?.primary_image_url || null;
      const productName = product?.name
        || (p.product_code === "__unmatched__" ? "Unmatched item" : p.product_code);

      return {
        ...p,
        product_name: String(productName),
        image_url: imageUrl ? String(imageUrl) : null,
      };
    });

    const { data: rawOrders, error: rawOrdersErr } = await sb
      .from("orders_raw")
      .select("stripe_checkout_session_id,total_paid_cents")
      .gte("order_date", `${startDate}T00:00:00Z`)
      .lte("order_date", `${endDate}T23:59:59Z`);

    if (rawOrdersErr) {
      return json({ error: rawOrdersErr.message }, 500);
    }

    const sessionIds = (rawOrders || [])
      .map((r) => r.stripe_checkout_session_id)
      .filter(Boolean) as string[];

    const ebayIds = sessionIds.filter((id) => id.startsWith("ebay_"));
    const amazonIds = sessionIds.filter((id) => id.startsWith("amazon_"));

    const ebayFinanceMap = new Map<string, { earnings: number | null; status: string | null }>();
    const amazonFinanceMap = new Map<string, { earnings: number | null; status: string | null }>();

    if (ebayIds.length) {
      const { data: ebayRows, error: ebayErr } = await sb
        .from("v_ebay_order_profit")
        .select("stripe_checkout_session_id,ebay_order_earnings_cents,finance_status")
        .in("stripe_checkout_session_id", ebayIds);
      if (ebayErr) return json({ error: ebayErr.message }, 500);
      for (const row of ebayRows || []) {
        ebayFinanceMap.set(String(row.stripe_checkout_session_id), {
          earnings: row.ebay_order_earnings_cents == null ? null : Number(row.ebay_order_earnings_cents),
          status: row.finance_status == null ? null : String(row.finance_status),
        });
      }
    }

    if (amazonIds.length) {
      const { data: amazonRows, error: amazonErr } = await sb
        .from("v_amazon_order_profit")
        .select("stripe_checkout_session_id,amazon_order_earnings_cents,finance_status")
        .in("stripe_checkout_session_id", amazonIds);
      if (amazonErr) return json({ error: amazonErr.message }, 500);
      for (const row of amazonRows || []) {
        amazonFinanceMap.set(String(row.stripe_checkout_session_id), {
          earnings: row.amazon_order_earnings_cents == null ? null : Number(row.amazon_order_earnings_cents),
          status: row.finance_status == null ? null : String(row.finance_status),
        });
      }
    }

    function rawRevenueCents(sessionId: string, totalPaidCents: number | null | undefined): number {
      const totalPaid = Number(totalPaidCents || 0);
      if (sessionId.startsWith("ebay_")) {
        const fin = ebayFinanceMap.get(sessionId);
        if (fin?.earnings != null && fin.status !== "estimated") return fin.earnings;
      }
      if (sessionId.startsWith("amazon_")) {
        const fin = amazonFinanceMap.get(sessionId);
        if (fin?.earnings != null) return fin.earnings;
      }
      return totalPaid;
    }

    const { data: rawLineItems, error: rawLinesErr } = await sb
      .from("line_items_raw")
      .select("stripe_checkout_session_id,quantity")
      .gte("order_date", `${startDate}T00:00:00Z`)
      .lte("order_date", `${endDate}T23:59:59Z`);

    if (rawLinesErr) {
      return json({ error: rawLinesErr.message }, 500);
    }

    const rawByChannel = new Map<Channel, { orders: number; units: number; revenue_cents: number }>();

    for (const r of rawOrders || []) {
      const channel = mapChannel(r.stripe_checkout_session_id);
      const prev = rawByChannel.get(channel) || { orders: 0, units: 0, revenue_cents: 0 };
      prev.orders += 1;
      prev.revenue_cents += rawRevenueCents(
        String(r.stripe_checkout_session_id || ""),
        r.total_paid_cents,
      );
      rawByChannel.set(channel, prev);
    }

    for (const li of rawLineItems || []) {
      const channel = mapChannel(li.stripe_checkout_session_id);
      const prev = rawByChannel.get(channel) || { orders: 0, units: 0, revenue_cents: 0 };
      prev.units += Number(li.quantity || 0);
      rawByChannel.set(channel, prev);
    }

    const reconciliation = channelKpis.map((agg) => {
      const raw = rawByChannel.get(agg.channel) || { orders: 0, units: 0, revenue_cents: 0 };
      return {
        channel: agg.channel,
        analytics_orders: agg.orders,
        raw_orders: raw.orders,
        orders_diff: agg.orders - raw.orders,
        analytics_units: agg.units,
        raw_units: raw.units,
        units_diff: agg.units - raw.units,
        analytics_revenue_cents: agg.revenue_cents,
        raw_revenue_cents: raw.revenue_cents,
        revenue_diff_cents: agg.revenue_cents - raw.revenue_cents,
      };
    });

    return json({
      success: true,
      meta: {
        start_date: startDate,
        end_date: endDate,
        refreshed: Boolean(payload.refresh),
      },
      channel_kpis: channelKpis,
      website_funnel: websiteFunnel,
      reconciliation,
      timeseries,
      top_products: topProducts,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[analytics-aggregate]", message);
    return json({ error: message }, 500);
  }
});
