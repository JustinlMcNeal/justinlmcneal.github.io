// /js/admin/tax/api.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Fetch all tax-relevant data for a given calendar year.
 * Runs orders, expenses, and shipment queries in parallel.
 */
export async function fetchTaxData(year) {
  const from = `${year}-01-01`;
  const to   = `${year}-12-31T23:59:59.999Z`;

  const [ordersRes, expensesRes, shipmentsRes] = await Promise.all([
    supabase
      .from("orders_raw")
      .select("stripe_checkout_session_id,kk_order_id,order_date,total_paid_cents,subtotal_paid_cents,tax_cents,shipping_paid_cents,order_cost_total_cents")
      .gte("order_date", from)
      .lte("order_date", to),

    supabase
      .from("expenses")
      .select("expense_date,category,description,amount_cents,vendor")
      .gte("expense_date", from)
      .lte("expense_date", to)
      .order("expense_date", { ascending: true }),

    supabase
      .from("fulfillment_shipments")
      .select("stripe_checkout_session_id,label_cost_cents,carrier,shipped_at")
      .gte("shipped_at", from)
      .lte("shipped_at", to),
  ]);

  if (ordersRes.error)   throw ordersRes.error;
  if (expensesRes.error) throw expensesRes.error;
  if (shipmentsRes.error) throw shipmentsRes.error;

  return {
    orders:    ordersRes.data    || [],
    expenses:  expensesRes.data  || [],
    shipments: shipmentsRes.data || [],
  };
}
