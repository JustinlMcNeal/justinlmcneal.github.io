// Operator alerts when submitted draft auto-verify reaches max_attempts.

type DraftAlertRow = {
  id: string;
  seller_sku: string | null;
  kk_sku: string | null;
  marketplace_id: string | null;
  verify_attempts: number | null;
  verify_last_error: string | null;
  verify_status: string;
  verify_max_attempts_alerted_at: string | null;
  kk_product_id: string | null;
};

function alertChannelsConfigured(): { slack: boolean; email: boolean } {
  const slack = Boolean(Deno.env.get("AMAZON_VERIFY_ALERT_SLACK_WEBHOOK_URL")?.trim());
  const email = Boolean(
    Deno.env.get("AMAZON_VERIFY_ALERT_EMAIL_TO")?.trim() &&
    Deno.env.get("RESEND_API_KEY")?.trim(),
  );
  return { slack, email };
}

function buildAlertText(draft: DraftAlertRow, productTitle: string | null): string {
  const sku = draft.seller_sku || draft.kk_sku || "unknown SKU";
  const title = productTitle || sku;
  const attempts = Number(draft.verify_attempts || 0);
  const error = draft.verify_last_error ? ` Last error: ${draft.verify_last_error}` : "";
  const adminUrl = Deno.env.get("AMAZON_ADMIN_PAGE_URL")?.trim() ||
    "https://karrykraze.com/pages/admin/amazon.html";

  return [
    "Amazon draft auto-verification stopped (max attempts).",
    `Draft: ${draft.id}`,
    `Product: ${title}`,
    `SKU: ${sku}`,
    `Marketplace: ${draft.marketplace_id || "—"}`,
    `Attempts: ${attempts}.${error}`,
    `Admin: ${adminUrl}`,
  ].join("\n");
}

async function sendSlackAlert(webhookUrl: string, text: string): Promise<void> {
  const resp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!resp.ok) throw new Error("slack_alert_failed");
}

async function sendEmailAlert(to: string, subject: string, text: string): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY")?.trim();
  if (!apiKey) throw new Error("email_alert_misconfigured");

  const from = Deno.env.get("AMAZON_VERIFY_ALERT_EMAIL_FROM")?.trim() ||
    "Karry Kraze Admin <noreply@karrykraze.com>";

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
    }),
  });

  if (!resp.ok) throw new Error("email_alert_failed");
}

async function markAlertSent(
  // deno-lint-ignore no-explicit-any
  client: any,
  draftId: string,
  now: string,
): Promise<void> {
  const { error } = await client
    .from("amazon_listing_drafts")
    .update({ verify_max_attempts_alerted_at: now, updated_at: now })
    .eq("id", draftId)
    .eq("verify_status", "max_attempts");

  if (error) throw new Error("database_error");
}

export async function maybeSendMaxAttemptsOperatorAlert(
  // deno-lint-ignore no-explicit-any
  client: any,
  draftId: string,
  now: string,
): Promise<{ sent: boolean; channels: string[]; skipped?: string }> {
  const { data: draftRaw, error: draftErr } = await client
    .from("amazon_listing_drafts")
    .select(
      "id, seller_sku, kk_sku, marketplace_id, verify_attempts, verify_last_error, verify_status, verify_max_attempts_alerted_at, kk_product_id",
    )
    .eq("id", draftId)
    .maybeSingle();

  if (draftErr) throw new Error("database_error");
  const draft = draftRaw as DraftAlertRow | null;
  if (!draft || draft.verify_status !== "max_attempts") {
    return { sent: false, channels: [], skipped: "not_max_attempts" };
  }
  if (draft.verify_max_attempts_alerted_at) {
    return { sent: false, channels: [], skipped: "already_alerted" };
  }

  let productTitle: string | null = null;
  if (draft.kk_product_id) {
    const { data: product } = await client
      .from("products")
      .select("name")
      .eq("id", draft.kk_product_id)
      .maybeSingle();
    productTitle = typeof product?.name === "string" ? product.name : null;
  }

  const channels = alertChannelsConfigured();
  const text = buildAlertText(draft, productTitle);
  const subject = `Amazon verify max attempts — ${draft.seller_sku || draft.kk_sku || draft.id}`;
  const sentChannels: string[] = [];

  if (!channels.slack && !channels.email) {
    await markAlertSent(client, draftId, now);
    return { sent: false, channels: [], skipped: "alerts_disabled" };
  }

  if (channels.slack) {
    await sendSlackAlert(String(Deno.env.get("AMAZON_VERIFY_ALERT_SLACK_WEBHOOK_URL")), text);
    sentChannels.push("slack");
  }

  if (channels.email) {
    await sendEmailAlert(String(Deno.env.get("AMAZON_VERIFY_ALERT_EMAIL_TO")), subject, text);
    sentChannels.push("email");
  }

  await markAlertSent(client, draftId, now);
  return { sent: true, channels: sentChannels };
}
