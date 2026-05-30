/** Local-only draft deletion helpers (no Amazon SP-API calls). */

const NON_DELETABLE_STATUSES = new Set(["published", "archived"]);

export function isDraftDeletableStatus(status: string): boolean {
  return !NON_DELETABLE_STATUSES.has(String(status || "").trim());
}

type DraftDeleteRow = {
  id: string;
  draft_status: string;
  kk_product_id: string | null;
  kk_sku: string | null;
  seller_sku: string | null;
};

type SupabaseClientLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{ data: DraftDeleteRow | null; error: unknown }>;
      };
    };
    delete: () => {
      eq: (column: string, value: string) => Promise<{ error: unknown }>;
    };
  };
};

export type DeleteLocalDraftResult = {
  draftId: string;
  draftStatus: string;
  kkProductId: string | null;
};

export async function deleteLocalAmazonDraft(
  client: SupabaseClientLike,
  draftId: string,
): Promise<DeleteLocalDraftResult> {
  const { data: draft, error: draftErr } = await client
    .from("amazon_listing_drafts")
    .select("id, draft_status, kk_product_id, kk_sku, seller_sku")
    .eq("id", draftId)
    .maybeSingle();

  if (draftErr) throw new Error("database_error");
  if (!draft) throw new Error("draft_not_found");

  const draftStatus = String(draft.draft_status || "");
  if (!isDraftDeletableStatus(draftStatus)) {
    throw new Error("draft_not_deletable");
  }

  const { error: deleteErr } = await client
    .from("amazon_listing_drafts")
    .delete()
    .eq("id", draftId);

  if (deleteErr) throw new Error("database_error");

  return {
    draftId,
    draftStatus,
    kkProductId: draft.kk_product_id,
  };
}
