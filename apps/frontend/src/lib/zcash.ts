/**
 * Validates a Zcash shielded address.
 * Accepts:
 * - Unified Address (UA): starts with 'u', 60-220 lowercase alphanumeric chars
 * - Sapling Address: starts with 'zs', 60-200 alphanumeric chars (case-insensitive)
 */
export function isValidZcashShielded(addr: string): boolean {
  const v = (addr || "").trim();
  // Unified Address: starts with 'u', lowercase alphanumeric
  if (/^u[0-9a-z]{60,220}$/.test(v)) return true;
  // Sapling Address: starts with 'zs' (case-insensitive)
  if (/^zs[0-9a-z]{60,200}$/i.test(v)) return true;
  return false;
}

