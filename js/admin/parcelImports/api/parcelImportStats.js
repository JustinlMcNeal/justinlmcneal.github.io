/** Live KPI counts from parcel_imports (Phase 10). */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "/js/config/env.js";
import { requireAuthenticatedSession } from "./parcelImportsApi.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function countImports(filter) {
  let query = supabase
    .from("parcel_imports")
    .select("id", { count: "exact", head: true });

  if (filter) query = filter(query);

  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** @returns {Promise<{ total: number, draft: number, needsReview: number, readyToApprove: number, approved: number, expenseLinked: number }>} */
export async function fetchParcelImportKpis() {
  await requireAuthenticatedSession();

  const [total, draft, needsReview, readyToApprove, approved, expenseLinked] =
    await Promise.all([
      countImports(),
      countImports((q) => q.eq("status", "draft")),
      countImports((q) => q.eq("status", "needs_review")),
      countImports((q) => q.eq("status", "ready_to_approve")),
      countImports((q) => q.eq("status", "approved")),
      countImports((q) => q.not("expense_id", "is", null)),
    ]);

  return {
    total,
    draft,
    needsReview,
    readyToApprove,
    approved,
    expenseLinked,
  };
}
