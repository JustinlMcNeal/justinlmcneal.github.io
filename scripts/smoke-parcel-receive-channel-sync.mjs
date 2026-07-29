#!/usr/bin/env node
/**
 * Smoke test: fake parcel receive → variants[] → eBay/Amazon channel push path.
 *
 * Creates a temporary approved parcel (qty 1), receives it via RPC, invokes
 * sync-ebay-inventory-quantity with service role, then rolls stock back and
 * deletes the fake import rows.
 *
 * Run: node scripts/smoke-parcel-receive-channel-sync.mjs
 */
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { getPoolerConnectionString } from "./supabase/dbConnect.mjs";

const ACTOR = "e4fe725f-256c-4353-bff9-9e5109f08ce6";
const FAKE_PARCEL_ID = `SMOKE-RECV-${Date.now()}`;

function loadEnv() {
  const env = {};
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

function summarizeChannelSteps(ebayStatus, amazonStatus) {
  const tallies = {
    ebay: { ok: 0, failed: 0, skipped: 0, other: 0 },
    amazon: { ok: 0, failed: 0, skipped: 0, other: 0 },
  };
  function count(channel, status) {
    if (status === "success") tallies[channel].ok += 1;
    else if (status === "failed") tallies[channel].failed += 1;
    else if (status === "skipped") tallies[channel].skipped += 1;
    else tallies[channel].other += 1;
  }
  count("ebay", ebayStatus);
  count("amazon", amazonStatus);
  const line =
    `Channels: eBay ${tallies.ebay.ok} ok` +
    (tallies.ebay.failed ? `, ${tallies.ebay.failed} failed` : "") +
    (tallies.ebay.skipped ? `, ${tallies.ebay.skipped} skipped` : "") +
    `; Amazon ${tallies.amazon.ok} ok` +
    (tallies.amazon.skipped ? `, ${tallies.amazon.skipped} skipped` : "") +
    ".";
  return { tallies, line, hasFailures: tallies.ebay.failed > 0 || tallies.amazon.failed > 0 };
}

async function main() {
  const env = loadEnv();
  process.env.SUPABASE_DB_PASSWORD =
    process.env.SUPABASE_DB_PASSWORD ||
    env.SUPABASE_DB_PASSWORD ||
    env.DB_PASSWORD ||
    env.POSTGRES_PASSWORD;

  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const errors = [];
  const notes = [];
  let importId = null;
  let variantId = null;
  let productId = null;
  let stockBefore = null;
  let reservedQty = 0;
  let receivePayload = null;
  let usedVariationMode = false;

  const pgClient = new pg.Client({
    connectionString: getPoolerConnectionString(),
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();

  try {
    const { data: cand, error: candErr } = await sb
      .from("v_inventory_channel_sync_candidates")
      .select(
        "variant_id, product_id, available_qty, reserved_qty, on_hand_qty, ebay_sync_action, amazon_sync_action, ebay_item_group_key, ebay_current_qty",
      )
      .eq("ebay_sync_action", "update_qty")
      .gte("on_hand_qty", 1)
      .limit(1)
      .maybeSingle();
    if (candErr || !cand) throw new Error(`No ebay update_qty candidate: ${candErr?.message}`);
    variantId = cand.variant_id;
    productId = cand.product_id;
    stockBefore = Number(cand.on_hand_qty);
    reservedQty = Number(cand.reserved_qty || 0);
    notes.push(
      `Using variant ${variantId} (on_hand=${stockBefore}, ebay=${cand.ebay_sync_action}, amazon=${cand.amazon_sync_action})`,
    );

    const { data: pv } = await sb
      .from("product_variants")
      .select("id, stock, option_value, sku")
      .eq("id", variantId)
      .single();
    notes.push(`Variant sku=${pv?.sku || "?"} label=${pv?.option_value || "?"}`);

    // 1) Create fake approved parcel
    const insImport = await pgClient.query(
      `INSERT INTO public.parcel_imports (
         parcel_id, source_file_name, source_format, status,
         approved_at, approved_by, notes, xls_total_items
       ) VALUES ($1, $2, 'baestao_html_xls', 'approved', now(), $3::uuid, $4, 1)
       RETURNING id`,
      [FAKE_PARCEL_ID, "smoke-parcel-receive-channel-sync.html", ACTOR, "smoke test fake parcel — safe to delete"],
    );
    importId = insImport.rows[0].id;
    notes.push(`Created fake import ${importId} (${FAKE_PARCEL_ID})`);

    const insItem = await pgClient.query(
      `INSERT INTO public.parcel_import_items (
         parcel_import_id, row_number, export_row_no, source_item_name,
         quantity, unit_price_cny, row_total_cny, line_item_subtotal_cny, raw
       ) VALUES ($1::uuid, 1, 1, $2, 1, 1, 1, 1, '{}'::jsonb)
       RETURNING id`,
      [importId, "SMOKE TEST ITEM — fake parcel receive"],
    );
    const itemId = insItem.rows[0].id;

    await pgClient.query(
      `INSERT INTO public.parcel_import_item_mappings (
         parcel_import_item_id, parcel_import_id, product_id, product_variant_id,
         mapped_product_label, mapped_variant_label, row_type, mapping_status, mapping_source
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 'business_inventory', 'matched', 'manual')`,
      [itemId, importId, productId, variantId, "Smoke Test Product", "Smoke Variant"],
    );

    // 2) Receive with auth.uid() via JWT claims
    const recv = await pgClient.query(
      `SELECT set_config('request.jwt.claims', $1, true),
              public.receive_parcel_import_inventory($2::uuid, $3) AS result`,
      [
        JSON.stringify({ sub: ACTOR, role: "authenticated" }),
        importId,
        `smoke-receive-${importId}`,
      ],
    );
    receivePayload = recv.rows[0].result;
    notes.push(`Receive result: ${JSON.stringify(receivePayload)}`);

    if (!receivePayload?.received) errors.push("Receive did not return received:true");
    if (receivePayload?.already_received) errors.push("Unexpected already_received on first receive");
    if (!Array.isArray(receivePayload?.variants) || receivePayload.variants.length !== 1) {
      errors.push(`Expected variants.length === 1, got ${JSON.stringify(receivePayload?.variants)}`);
    } else {
      const v = receivePayload.variants[0];
      if (v.variant_id !== variantId) errors.push("variants[0].variant_id mismatch");
      if (Number(v.qty_received) !== 1) errors.push(`qty_received expected 1, got ${v.qty_received}`);
      if (Number(v.stock_after) !== stockBefore + 1) {
        errors.push(`stock_after expected ${stockBefore + 1}, got ${v.stock_after}`);
      } else notes.push("RPC variants[] shape + stock_after OK");
    }

    const { data: afterPv } = await sb
      .from("product_variants")
      .select("stock")
      .eq("id", variantId)
      .single();
    if (Number(afterPv?.stock) !== stockBefore + 1) {
      errors.push(`product_variants.stock expected ${stockBefore + 1}, got ${afterPv?.stock}`);
    } else notes.push("KK on_hand bumped by parcel receive");

    // 3) Idempotent second receive — no re-push payload
    const recv2 = await pgClient.query(
      `SELECT set_config('request.jwt.claims', $1, true),
              public.receive_parcel_import_inventory($2::uuid, $3) AS result`,
      [
        JSON.stringify({ sub: ACTOR, role: "authenticated" }),
        importId,
        `smoke-receive-${importId}-again`,
      ],
    );
    const again = recv2.rows[0].result;
    if (!again?.already_received) errors.push("Second receive should set already_received");
    if (!Array.isArray(again?.variants) || again.variants.length !== 0) {
      errors.push("already_received must return empty variants[]");
    } else notes.push("already_received skips variants[] (no second channel push)");

    // 4) Channel sync path (same edges Adjust / receive UI use)
    const syncContext = {
      trigger_source: "parcel_receive",
      trigger_reference_type: "parcel_import",
      trigger_reference_id: importId,
      orchestration_id: `parcel_receive:${importId}`,
    };

    const { data: varCand } = await sb
      .from("v_inventory_ebay_variation_sync_candidates")
      .select("variant_id, product_id, candidate_state, ebay_child_qty, kk_available_qty")
      .eq("variant_id", variantId)
      .maybeSingle();

    const stockAfter = Number(receivePayload.variants?.[0]?.stock_after ?? stockBefore + 1);
    const availableQty = Math.max(0, stockAfter - reservedQty);
    const isVariation = Boolean(cand.ebay_item_group_key || varCand?.ebay_item_group_key || varCand);

    let ebayBody;
    if (isVariation) {
      usedVariationMode = true;
      ebayBody = {
        mode: "variation_child_update_qty",
        productId,
        variantId,
        quantity: availableQty,
        syncContext,
      };
      notes.push(
        `Using variation_child_update_qty (state=${varCand?.candidate_state || "n/a"}, qty=${availableQty})`,
      );
    } else {
      ebayBody = {
        mode: "update_qty",
        variantIds: [variantId],
        limit: 1,
        syncContext,
      };
      notes.push("Using single-SKU update_qty mode");
    }

    const ebayResp = await fetch(`${env.SUPABASE_URL}/functions/v1/sync-ebay-inventory-quantity`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(ebayBody),
    });
    const ebayJson = await ebayResp.json().catch(() => ({}));
    notes.push(`eBay sync HTTP ${ebayResp.status}: ${JSON.stringify(ebayJson).slice(0, 700)}`);

    let ebayStep = "failed";
    if (ebayJson.error === "live_patch_disabled") {
      ebayStep = "dry_run";
      notes.push("Live eBay patch disabled — path reached edge (expected in some envs)");
    } else if (ebayResp.ok && ebayJson.ok !== false) {
      const status = String(ebayJson.status || "").toLowerCase();
      const succeeded = Number(
        ebayJson.succeeded ?? ebayJson.summary?.succeeded ?? (status === "success" ? 1 : 0),
      );
      const skipped = Number(
        ebayJson.skipped ?? ebayJson.summary?.skipped ?? (status === "skipped" ? 1 : 0),
      );
      if (succeeded > 0 || status === "success") ebayStep = "success";
      else if (skipped > 0 || status === "skipped") ebayStep = "skipped";
      else if (status === "dry_run" || ebayJson.preview || ebayJson.dry_run) ebayStep = "dry_run";
      else if (Number(ebayJson.candidateCount ?? ebayJson.summary?.total ?? -1) === 0) {
        ebayStep = "failed";
        errors.push("eBay sync returned zero eligible candidates — push did not run");
      } else {
        ebayStep = "failed";
        errors.push(`eBay sync unexpected payload: ${JSON.stringify(ebayJson).slice(0, 300)}`);
      }
    } else {
      errors.push(
        `eBay sync failed HTTP ${ebayResp.status}: ${ebayJson.error || ebayJson.message || "unknown"}`,
      );
    }

    // Smoke expects a real marketplace attempt (success) or an intentional skip/dry-run — not silent failure.
    if (ebayStep === "failed") {
      /* already in errors */
    } else if (ebayStep === "skipped") {
      notes.push("eBay reported skipped (qty already matched) — path OK");
    }

    // Amazon: expect skip for missing_mapping / no_change
    const amazonAction = cand.amazon_sync_action;
    const amazonStep =
      amazonAction === "update_qty" || amazonAction === "inactive_can_update"
        ? "success"
        : "skipped";
    if (amazonStep === "skipped") {
      notes.push(`Amazon skipped as expected (action=${amazonAction})`);
    }

    const summary = summarizeChannelSteps(ebayStep, amazonStep);
    notes.push(`UI-style status would append: ${summary.line}`);
    if (!summary.line.includes("Channels:")) errors.push("Channel summary line malformed");

    // Confirm stock still at +1 after marketplace attempt (best-effort)
    const { data: still } = await sb
      .from("product_variants")
      .select("stock")
      .eq("id", variantId)
      .single();
    if (Number(still?.stock) !== stockBefore + 1) {
      errors.push("Marketplace sync must not undo KK stock receive");
    } else notes.push("KK stock unchanged by channel sync (best-effort)");
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    // Cleanup: reverse smoke stock delta + delete fake parcel
    try {
      if (importId && variantId != null && stockBefore != null) {
        const { data: cur } = await sb
          .from("product_variants")
          .select("stock, product_id")
          .eq("id", variantId)
          .single();
        const curStock = Number(cur?.stock ?? stockBefore);
        if (curStock === stockBefore + 1) {
          await sb
            .from("product_variants")
            .update({ stock: stockBefore, updated_at: new Date().toISOString() })
            .eq("id", variantId);
          await sb.from("stock_ledger").insert({
            variant_id: variantId,
            product_id: cur.product_id,
            change: -1,
            reason: "manual_adjustment",
            reference_id: "smoke_parcel_receive_rollback",
            stock_before: curStock,
            stock_after: stockBefore,
            note: "Rollback fake parcel smoke receive",
            source: "smoke_test",
            reference_type: "manual_adjust",
            created_by: ACTOR,
          });
          notes.push(`Rolled stock back to ${stockBefore}`);
        } else {
          notes.push(`Skip stock rollback (current=${curStock}, expected ${stockBefore + 1})`);
        }
      }

      if (importId) {
        await pgClient.query(
          `DELETE FROM public.parcel_import_item_mappings WHERE parcel_import_id = $1::uuid`,
          [importId],
        );
        await pgClient.query(
          `DELETE FROM public.parcel_import_items WHERE parcel_import_id = $1::uuid`,
          [importId],
        );
        await pgClient.query(
          `DELETE FROM public.parcel_import_events WHERE parcel_import_id = $1::uuid`,
          [importId],
        );
        await pgClient.query(`DELETE FROM public.parcel_imports WHERE id = $1::uuid`, [importId]);
        await pgClient.query(
          `DELETE FROM public.stock_ledger
           WHERE reason = 'parcel_receive' AND reference_id = $1`,
          [importId],
        );
        await pgClient.query(
          `DELETE FROM public.stock_ledger
           WHERE reference_id = 'smoke_parcel_receive_rollback'`,
        );
        notes.push("Deleted fake parcel rows + smoke ledger entries");
      }

      // Re-align eBay qty to post-rollback available (best effort)
      if (variantId && productId != null && stockBefore != null) {
        const restoreQty = Math.max(0, Number(stockBefore) - Number(reservedQty || 0));
        const restoreBody = usedVariationMode
          ? {
              mode: "variation_child_update_qty",
              productId,
              variantId,
              quantity: restoreQty,
              syncContext: {
                trigger_source: "parcel_receive",
                trigger_reference_type: "parcel_import",
                trigger_reference_id: "smoke_rollback",
              },
            }
          : {
              mode: "update_qty",
              variantIds: [variantId],
              limit: 1,
              syncContext: {
                trigger_source: "parcel_receive",
                trigger_reference_type: "parcel_import",
                trigger_reference_id: "smoke_rollback",
              },
            };
        const restore = await fetch(`${env.SUPABASE_URL}/functions/v1/sync-ebay-inventory-quantity`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(restoreBody),
        });
        const restoreJson = await restore.json().catch(() => ({}));
        notes.push(
          `Post-cleanup eBay restore qty=${restoreQty} HTTP ${restore.status}: ${JSON.stringify(restoreJson).slice(0, 240)}`,
        );
      }
    } catch (cleanupErr) {
      errors.push(
        `Cleanup failed: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
      );
    }
    await pgClient.end().catch(() => {});
  }

  console.log("\n=== Smoke: parcel receive → channel sync ===\n");
  for (const n of notes) console.log(`  ✓  ${n}`);
  for (const e of errors) console.log(`  ✗  ${e}`);
  if (errors.length) {
    console.log(`\nFAIL (${errors.length} error(s))\n`);
    process.exit(1);
  }
  console.log("\nPASS — fake parcel receive + channel sync path OK\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
