import { DocsCodeBlock } from "../DocsCodeBlock";

export function SendPayments({ onNavigate }: { onNavigate: (slug: string) => void }) {
  return (
    <article>
      <h1 className="text-3xl font-medium text-slate-100 mb-3">Send payments</h1>
      <p className="text-base text-slate-400 leading-relaxed mb-6">
        <code className="text-orange-300">POST /payouts</code> pays a recipient — by email,
        username, or social handle — from the API key owner's own account. The counterpart to{" "}
        <button type="button" onClick={() => onNavigate("receive-payments")} className="text-orange-400 hover:underline">
          payment links
        </button>
        : that one gets you paid, this one pays someone else. Self-custody — it returns an
        unsigned transaction, you sign it with your own wallet. Loofta never holds or moves your
        funds on your behalf.
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Request</h2>
      <DocsCodeBlock
        label="POST /payouts"
        code={`curl -X POST https://api.loofta.xyz/payouts \\
  -H "Authorization: Bearer lft_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 25,
    "recipient_type": "email",
    "recipient_identifier": "alice@example.com",
    "sender_wallet": "5dCT...BKuq",
    "message": "August payout"
  }'`}
      />

      <table className="w-full text-base text-left mb-6">
        <thead>
          <tr className="text-base text-slate-400 border-b border-white/10">
            <th className="py-2 pr-4 font-medium">Field</th>
            <th className="py-2 pr-4 font-medium">Type</th>
            <th className="py-2 font-medium">Notes</th>
          </tr>
        </thead>
        <tbody className="text-slate-300">
          <tr className="border-b border-white/5">
            <td className="py-2 pr-4"><code>amount</code></td>
            <td className="py-2 pr-4 text-slate-400">number</td>
            <td className="py-2 text-slate-400">USD, $10,000 maximum. $1 minimum, $5 minimum if <code>is_private</code> is <code>true</code>.</td>
          </tr>
          <tr className="border-b border-white/5">
            <td className="py-2 pr-4"><code>recipient_type</code></td>
            <td className="py-2 pr-4 text-slate-400">string</td>
            <td className="py-2 text-slate-400"><code>email</code>, <code>username</code>, <code>twitter</code>, <code>discord</code>, <code>github</code>, or <code>telegram</code>.</td>
          </tr>
          <tr className="border-b border-white/5">
            <td className="py-2 pr-4"><code>recipient_identifier</code></td>
            <td className="py-2 pr-4 text-slate-400">string</td>
            <td className="py-2 text-slate-400">The email address, Loofta username, or handle, matching <code>recipient_type</code>.</td>
          </tr>
          <tr className="border-b border-white/5">
            <td className="py-2 pr-4"><code>sender_wallet</code></td>
            <td className="py-2 pr-4 text-slate-400">string</td>
            <td className="py-2 text-slate-400">Your own Solana wallet's public key — pays gas and signs the returned transaction. Loofta never touches it.</td>
          </tr>
          <tr className="border-b border-white/5">
            <td className="py-2 pr-4"><code>message</code></td>
            <td className="py-2 pr-4 text-slate-400">string, optional</td>
            <td className="py-2 text-slate-400">Shown to the recipient on their claim page. 500 characters max.</td>
          </tr>
          <tr>
            <td className="py-2 pr-4"><code>is_private</code></td>
            <td className="py-2 pr-4 text-slate-400">boolean, optional</td>
            <td className="py-2 text-slate-400">Defaults to <code>false</code>. Pass <code>true</code> to shield the amount and your wallet on-chain — a MagicBlock private transfer, ~10 bps + $0.20 flat gas on top of <code>amount</code>.</td>
          </tr>
        </tbody>
      </table>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Response</h2>
      <DocsCodeBlock
        code={`{
  "payment_id": "b3f1...e02a",
  "short_id": "aB3xK9pQ",
  "claim_link": "https://pay.loofta.xyz/c/aB3xK9pQ",
  "unsigned_transaction": "AQAAAAAAAAAAAAAAAAAAAAAA...",
  "transaction_version": "legacy",
  "is_private": false
}`}
      />
      <p className="text-base text-slate-400 mb-6">
        <code className="text-orange-300">unsigned_transaction</code> is a base64-encoded, unsigned
        Solana transaction — <code>transaction_version</code> tells you whether to deserialize it
        as a legacy <code>Transaction</code> or a <code>VersionedTransaction</code> (private
        transfers can come back as either; public ones are always <code>legacy</code>).
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Sign and broadcast</h2>
      <p className="text-base text-slate-400 mb-3">
        This is the one step Loofta can't do for you — <code>sender_wallet</code> is your own
        wallet, so only you can authorize spending from it. Deserialize, sign with that wallet's
        keypair, and send it yourself:
      </p>
      <DocsCodeBlock
        code={`import { Connection, Transaction, VersionedTransaction, Keypair } from "@solana/web3.js";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const senderKeypair = Keypair.fromSecretKey(/* your own key, never sent to Loofta */);

const raw = Buffer.from(unsigned_transaction, "base64");
const tx = transaction_version === "v0"
  ? VersionedTransaction.deserialize(raw)
  : Transaction.from(raw);

tx.sign(senderKeypair); // VersionedTransaction: tx.sign([senderKeypair])
const signature = await connection.sendRawTransaction(tx.serialize());`}
      />
      <p className="text-base text-slate-400 mb-6">
        The recipient sees the payout waiting for them at <code>claim_link</code> the moment
        your transaction lands — same claim/burner mechanics as every other Loofta payment, so an
        unregistered recipient claims by signing in with the email or handle you sent it to.
      </p>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <p className="text-slate-300 text-base">
          Building with an AI coding agent? Grab the copyable{" "}
          <button type="button" onClick={() => onNavigate("agent-skill")} className="text-orange-400 hover:underline">
            agent skill
          </button>{" "}
          — it covers this endpoint too.
        </p>
      </div>
    </article>
  );
}
