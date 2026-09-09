-- ═══════════════════════════════════════════════════════════════
-- 033_reverses_txn_index.sql
--
-- PERFORMANCE FIX (review finding H1).
--
-- Migration 026 added the LATERAL "how much of this transaction has
-- been reversed" lookup that v_maintenance_parts_used depends on:
--
--   SELECT SUM(rt.quantity) FROM stock_transactions rt
--   WHERE rt.reverses_txn_id = mpu.stock_transaction_id
--     AND rt.is_void = false
--
-- but never added an index on reverses_txn_id. EXPLAIN (ANALYZE,
-- BUFFERS) on v_asset_reliability_flags before this fix:
--
--   Execution Time: 532 ms  for 3 rows,  64,379 shared buffers
--   -> Seq Scan on stock_transactions rt  (loops=460)
--        Rows Removed by Filter: 5,880
--        Buffers: shared hit=55,660      -- 86% of all traffic
--
-- A full scan of the ledger, once per maintenance part line. It grows
-- as O(lines x transactions), so it degrades on both axes.
--
-- The same lookup backs v_maintenance_parts_used itself — loaded on
-- every Asset Detail page — and fetchReversalsFor() on the Stock
-- Movements page, which queries .in('reverses_txn_id', [...]).
--
-- Partial index: only reversal rows carry the column, and they are a
-- small minority of the ledger, so the index stays far smaller than a
-- full one while covering every query that uses it.
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS stock_transactions_reverses_idx
  ON public.stock_transactions (reverses_txn_id)
  WHERE reverses_txn_id IS NOT NULL;

-- Migration 030 added asset_hours_log_asset_read_idx (asset_id, read_at),
-- which duplicates asset_hours_log_asset_idx (asset_id, read_at DESC)
-- from migration 020 — a btree serves both scan directions, so the
-- second index only costs write throughput and space (review L1).
DROP INDEX IF EXISTS public.asset_hours_log_asset_read_idx;

ANALYZE public.stock_transactions;

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK (commented out)
-- ═══════════════════════════════════════════════════════════════
-- DROP INDEX IF EXISTS public.stock_transactions_reverses_idx;
-- CREATE INDEX IF NOT EXISTS asset_hours_log_asset_read_idx
--   ON public.asset_hours_log (asset_id, read_at);
