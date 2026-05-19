// Auto-queue edge function auth headers

import { getSupabaseClient } from "../../../../shared/supabaseClient.js";

export async function getAuthHeaders() {
  const session = (await getSupabaseClient().auth.getSession()).data.session;
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session?.access_token}`,
  };
}
