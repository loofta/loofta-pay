-- Forces PostgREST to reload its schema cache — the previous two migrations (bridge_claimed_at,
-- stall_refunded_at/stall_refund_tx_hash) applied successfully at the Postgres level but
-- PostgREST kept serving "column does not exist" for lottery_tickets.bridge_claimed_at well
-- past normal cache-reload propagation time.
NOTIFY pgrst, 'reload schema';
