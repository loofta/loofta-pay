# Partner payouts on compressed tokens (plan)

Status: in progress, 2026-11-23. Phases 1 to 3 are built and unit tested; nothing has run on devnet or mainnet yet. Everything is behind the flag `PARTNER_COMPRESSED_PAYOUTS` (default off). With the flag off nothing changes.

## Why

Today every partner payout gets its own burner wallet, and every burner needs a USDC token account. Each token account costs about 0.002 SOL of rent that our fee payer advances. For 1000 open payouts that is about 2 SOL of float, and we do not have it.

Light Protocol compressed token accounts need no rent and no token account. A compressed balance is owned by a key, so a burner can stay a plain key. Devnet spike (2026-11-23):

| Test | Result |
| --- | --- |
| Compress to a burner | 1.4 s, 0.000015 SOL |
| 15 burners in one transaction | 1.4 s, 0.000025 SOL, 1209 bytes (25 does not fit) |
| Claim with the fee split (decompress, then plain transfers) in one transaction | 1.3 s, 0.000015 SOL, amounts exact |
| Zero-SOL company wallet as the compress payer | fails: Light charges the payer about 5003 lamports |

The last row decides the design: the company wallet cannot run the compress itself.

## Rules we keep

* Every partner payout still goes to its own burner. Money never lands in a user's Loofta wallet. The person only gets it through the partner withdraw page, with both fees applied.
* One payout is one compressed account owned by one burner key, so payouts stay separate on chain and in our `payments` table.
* The partner's USDC is never at risk from the partner's side: the proposal's instructions are fixed by us, as today.

## Flow

1. Prepare batch (unchanged): one `payments` row and one burner key per payout. New rows get `burner_compressed = true`.
2. Fund proposal (changed): ONE USDC transfer from the company wallet to the Loofta staging account (the fee payer's USDC account) for the whole remaining batch, plus the network fee. No chunking, no token accounts, one approval for any batch size.
3. After the proposal executes on chain, a funding job compresses the money from staging into the burners, 15 per transaction, paid by the fee payer. Each chunk is recorded before it is sent (signature first), so a crash can never fund a burner twice. When a chunk confirms, its payouts become funded (same status changes as today).
4. Claim (changed): the burner key signs a decompress of its whole compressed balance into the fee payer's USDC account, then plain transfers split it: Loofta fee to us, partner fee to the partner, the rest to the person's destination. One transaction, atomic.
5. Balance reads: everything that asks "how much does this burner hold" goes through one helper that reads the compressed balance for compressed payouts and the token account for old ones.

Old payouts keep working exactly as they do now.

## Safety

* Staging is the fee payer's own USDC account, so custody does not change (we already hold every burner key). A ledger on the proposal row records what was staged and what is compressed. The job refuses to compress more than the ledger says is staged.
* Funding never repeats: signature is stored before send, status is checked before any rebuild.
* The job and the claim only ever send to burners and destinations we generated or verified. Sponsor rules apply: every sponsored transaction is tied to a row we created first.
* Indexer: validity proofs come from Helius. If it is down, claims wait and retry, nothing is lost. A timeout and a clear message ("try again shortly") are built in.
* Mainnet USDC already has the Light interface account (checked on chain).

## Phases

1. Foundation (done): flag, migration, Light helper module with tests (chunking, instruction builders, signature-first sending), dependency install.
2. Funding side (done): single staging transfer in `buildPayoutProposal`, funding job, ledger, tests.
3. Claim side (done): compressed sweep with the fee split, balance helper, update every balance read (withdraw page, funding check, cleanup job, cancel path), tests.
4. Squads devnet test of the staging transfer, then a mainnet run with $1 before any partner uses it.
5. Remove the rent-deposit code (never deployed) and its migration.

## Found along the way

* The 10-minute burner cleanup job selected every payment with status SUCCESS. A funded partner payout is SUCCESS before the person withdraws it, so the job could have swept a funded burner to the fee payer. It now skips partner payouts that are not withdrawn yet. Check whether that job runs in production.

## Not decided yet

* A dedicated staging key instead of the fee payer's account (cleaner accounting, needs a new KMS secret).
* What to do with compressed money nobody claims (same policy as today's unclaimed burners).
