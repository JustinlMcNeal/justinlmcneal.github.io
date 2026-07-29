# Parcel receive → eBay/Amazon channel sync

**Status:** Complete  
**Depends on:** [017_phase_11_receive_inventory.md](./017_phase_11_receive_inventory.md), Inventory Adjust channel orchestrator (059A)

---

## Goal

After a successful **Receive Inventory**, push each affected variant’s **available** quantity to mapped eBay/Amazon listings. KK stock receive remains authoritative and does not roll back on marketplace failure.

---

## Flow

1. Client calls RPC `receive_parcel_import_inventory`.
2. RPC updates `product_variants.stock` + `stock_ledger` (`parcel_receive`) and returns:

```json
{
  "import_id": "uuid",
  "received": true,
  "already_received": false,
  "variants_updated": 8,
  "total_units_received": 12,
  "rows_received": 8,
  "variants": [
    { "variant_id": "uuid", "qty_received": 2, "stock_after": 3 }
  ]
}
```

3. On `already_received: true`, `variants` is `[]` and the client **skips** channel push.
4. Otherwise the client runs `runChannelSyncForParcelVariants` (same Amazon/eBay branches as Inventory Adjust).
5. Status line appends a channel summary, e.g.  
   `Channels: eBay 6 ok, 1 failed; Amazon 2 ok, 5 skipped.`

---

## Contract

| Rule | Behavior |
|------|----------|
| Hook | Client only (`inventoryReceiveActions.js`) — not inside SQL |
| Quantity | Available = `stock_after − reserved` (clamped; skip if negative) |
| Always on | No toggle on Receive (Adjust keeps its sync checkbox) |
| Failures | Warnings only; stock stays received |
| Retry | Inventory → Sync Channels |
| Sale listings | eBay qty-only retry on error 25019 (`inventoryEbaySyncUtils`) |

---

## Key files

| Layer | Path |
|-------|------|
| Migration | `supabase/migrations/20261112_receive_parcel_import_inventory_variants.sql` |
| Sync helper | `js/admin/inventory/services/channelSyncForVariant.js` |
| Adjust reuse | `js/admin/inventory/services/adjustChannelOrchestrator.js` |
| Receive wire | `js/admin/parcelImports/ui/inventoryReceiveActions.js` |

---

## Out of scope

- Push on Approve (still stock-only until Receive)
- Auto-relist of ended listings
- Background queue (parcel size is small enough for sequential client pushes)
