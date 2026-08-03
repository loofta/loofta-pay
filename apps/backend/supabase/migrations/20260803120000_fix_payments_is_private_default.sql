-- payments.is_private defaulted to true (20260606000000_payments_is_private.sql), so any insert
-- path that forgot to set it explicitly silently created a "private" row for a plain public
-- payment. ClaimsService.create() (POST /claims/create) was exactly that gap — fixed in code
-- alongside this migration. Match claims.is_private's safer default (false) so a future insert
-- path with the same gap fails closed instead of open.
ALTER TABLE payments ALTER COLUMN is_private SET DEFAULT false;
