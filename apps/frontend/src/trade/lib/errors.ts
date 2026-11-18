/**
 * Turns whatever a failed action threw into a sentence a person can act on. Chain errors arrive as walls of program
 * logs, so they are never shown as they are. Our own backend messages are already plain and pass through.
 */
export function humanError(e: unknown, fallback = "Something went wrong. Try again."): string {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (!msg) return fallback;
  if (/insufficient lamports|insufficient funds for (fee|rent)|insufficient sol|attempt to debit an account/i.test(msg)) {
    return "Your wallet needs a little SOL for the network fee. Add a dollar or two and try again.";
  }
  if (/0x1771|slippage/i.test(msg)) return "The price moved too fast. Try again.";
  if (/blockhash not found|block height exceeded|transaction expired|expired/i.test(msg)) return "That took too long and was not sent. Try again.";
  if (/failed to fetch|networkerror|load failed|timed? ?out/i.test(msg)) return "No connection. Check it and try again.";
  if (/simulation failed|sendtransactionerror|program log|custom program error|logs:|0x[0-9a-f]+\b/i.test(msg) || msg.length > 160) {
    return "Could not complete that. Nothing was taken. Try again in a moment.";
  }
  return msg;
}
