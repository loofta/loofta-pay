# P2P crypto off-ramps, zkP2P, and Loofta durable value

Scope: 2025–2026 factual map of zkp2p / Bisq / Paxful / NoOnes / Airtm / LocalMonero-style P2P; whether “liquidity provider as a job” is real vs a TOS/legal trap; QR-corridor ramps; merchant USDC acceptance vs consumer P2P; and what of Loofta survives if every business accepts crypto. Does **not** recommend building an unlicensed P2P desk. Distinguishes consumer P2P (Venmo-like) from merchant acceptance (Stripe-like).

---

## zkp2p and similar 2024–2026: volume, users, Venmo/Cash App/Revolut/Wise ramps, legal status

### Takeaway
zkp2p (rebranded Peer / peer.xyz) is a live, small, non-custodial fiat↔crypto protocol that **does** wire Venmo, Cash App, Revolut, Wise, Zelle, PayPal and others into on-chain USDC escrow via payment proofs. Public volume is on the order of **~$1.2M / 30 days and ~$21.6M cumulative**, with **~$80k TVL** — not a mass-market ramp. The protocol’s “no KYC / use Venmo” design sits on **FinCEN P2P-exchanger money-transmission rules** and on **Venmo/Cash App TOS that ban commercial use of personal P2P rails**.

### Cited Findings
- ZKP2P V1 launched November 2023: seller locks USDC in escrow; buyer proves a Venmo payment with ZKEmail and unlocks funds with no centralized settlement intermediary. V2 launched 3 Feb 2025 at zkp2p.xyz: Venmo, Cash App, Wise, Revolut; claims ~60-second onramp; 23 currencies (up from 4); chains Solana, Base, Ethereum, Polygon; LP capital can serve multiple payment platforms at once. The team explicitly recruited LPs who already post ads on Binance P2P. — [ZKP2P, Introducing ZKP2P V2](https://paragraph.com/@zkp2p/introducing-zkp2p-v2)
- The protocol rebranded to **Peer** (peer.xyz); operator named as P2P Labs Inc.; originated as Ethereum Foundation PSE research. Fiat methods listed by a secondary Solana directory: Venmo, Cash App, Zelle, PayPal, Wise (USD); Revolut and Wise (EUR); Monzo (GBP); HDFC (INR). — [Solana Compass, ZKP2P on Solana](https://solanacompass.com/projects/zkp2p)
- Contract docs list live payment methods: **Venmo (US/USD), PayPal (global/USD), Wise (multi-currency including INR, PHP, MXN, IDR, KES, MYR, THB, VND), Zelle (Citi/Chase/BofA), Cash App (US and UK/USD), Revolut (multi-currency), MercadoPago (LATAM), Monzo (UK)**; additional scripts mention N26, Alipay, Luxon, Chime. Verification is UnifiedPaymentVerifier + EIP-712 attestations (zkTLS / receipts), not a bank partnership. Deployed on Base (and testnets). — [zkp2p-v2-contracts docs, Supported Payment Methods](https://zkp2p-zkp2p-contracts.mintlify.app/resources/supported-payment-methods)
- DefiLlama (protocol “Peer”): **TVL $80,426** (Base); **DEX volume 30d $1.24m, 7d $302,877, 24h $31,932; cumulative $21.6m**. “Fees” = positive realized **maker spread** vs oracle at settlement; **30d fees $24,803**; protocol **revenue $0** (no platform take). Q3 2026 maker spread $47.7k; Q4 2026* $9.95k. Methodology: fulfilled intents denominated in USDC on Base from Envio GraphQL. — [DefiLlama, Peer](https://defillama.com/protocol/peer)
- Implied 30-day realized positive spread ≈ $24.8k / $1.24m ≈ **2.0%** of fulfilled volume (only positive spreads counted; discounts excluded). Annualized fee run-rate cited by DefiLlama ~$346k. Average supply APY shown as 263.82% on tiny TVL — not a scalable labor-market wage. — [DefiLlama, Peer](https://defillama.com/protocol/peer)
- Loofta already integrates this stack as “Peer Cash” cash-out to Venmo, Cash App, Revolut, Zelle. Product comments: Peer Cash quotes live oracle with **zero Loofta-side spread**; chargeback risk is the taker’s; protocol restricts fills to vetted buyer groups (Plus: $2k+ fulfilled chargebackable volume, Pro: $10k+). — Loofta `apps/frontend/src/lib/peerPlatforms.ts` (internal; not a public source)
- FinCEN FIN-2019-G001: a **natural person operating as a P2P exchanger as a business** (buying/selling CVC for real currency, advertised, for profit) **is a money transmitter**, “regardless of the regularity or formality of such transactions or the location from which the person is operating.” Must register as an MSB and run AML/SAR/CTR programs. **Exemption:** a natural person doing this **infrequently and not for profit or gain**. — [FinCEN FIN-2019-G001 PDF](https://fincen.gov/sites/default/files/2019-05/FinCEN%20CVC%20Guidance%20FINAL.pdf)
- Same guidance: a CVC **trading platform is not** a money transmitter if it only lets parties solicit bids and **parties settle independently**; it **is** a money transmitter if it matches by **purchasing from the seller and selling to the buyer**. Hosted wallets that receive/store/transmit CVC for customers are account-based money transmitters. — [FinCEN FIN-2019-G001 PDF](https://fincen.gov/sites/default/files/2019-05/FinCEN%20CVC%20Guidance%20FINAL.pdf); [Katten summary](https://katten.com/fincen-publishes-guidance-pertaining-to-certain-business-models-involving-convertible-virtual-currencies)
- FinCEN’s first P2P-exchanger enforcement: **Eric Powers**, civil penalty **$35,350**, industry bar; 1,700+ unregistered P2P BTC trades; no AML program; no SARs/CTRs. — [FinCEN Advisory FIN-2019-A003](https://www.fincen.gov/system/files/advisory/2019-05-10/FinCEN%20Advisory%20CVC%20FINAL%20508.pdf); [McDermott note](https://www.mcdermottlaw.com/insights/fincen-assesses-civil-money-penalty-against-p2p-currency/)
- Venmo User Agreement: personal accounts **may not be used for business/commercial/merchant transactions with other personal accounts held by users you do not personally know**. All-caps: “VENMO SHOULD ONLY BE USED TO TRANSACT WITH PEOPLE YOU KNOW AND TRUST… PAYING OR RECEIVING PAYMENT FOR A GOOD OR A SERVICE IS PROHIBITED” unless Venmo expressly authorizes it (authorized merchant, business profile, or tagged goods-and-services). If reversed, the user “could lose both the underlying goods or services and the money sent.” — [Venmo User Agreement](https://venmo.com/legal/us-user-agreement)
- Cash App TOS: P2P Service is for “**peer-to-peer personal, non-commercial purposes**.” Earn-in-P2P **prohibited** activities include **sales of money-orders or foreign currency**, **wire transfer money orders**, **bill payment services**, **manual or automated cash disbursements**, and **prepaid cards / financial merchandise**. Cash App Pools prohibited uses include “**securities, cryptocurrency or digital currency**.” Receivers of Earnings Transactions bear **chargebacks**. — [Cash App US Terms of Service](https://cash.app/us/en/legal/tos)
- Cash App/Block is itself a **licensed** money transmitter and virtual-currency business; NYDFS April 2025 consent order against Block for BSA/AML failures on Bitcoin, mixers, and disclosure presentation — i.e. the rails LPs would piggyback on are already under enforcement pressure. — [NYDFS consent order, Block Inc., 10 Apr 2025](https://www.dfs.ny.gov/system/files/documents/2025/04/ea20250410-block.pdf)
- Bisq (decentralized P2P BTC) **permanently blocked Cash App and Venmo** after chargeback fraud: 5 successful chargebacks totaling **$1,200 Venmo + $650 Cash App**. Co-founders said re-enablement is unlikely without a two-phase settlement that survives reversals. — [Bisq community, Cash App and Venmo blocked](https://bisq.community/t/important-cash-app-and-venmo-payment-methods-have-been-blocked-due-to-chargeback-activity/5459/1)

### Inferences
- zkp2p/Peer is **technically real** as a 2025–2026 product (Loofta already uses it) but **economically tiny** versus Binance P2P or even a single Shopify Payments country. It is not evidence that “LP as a job on Venmo” is a durable, licensed labor market.
- Protocol non-custody does **not** immunize the **human LP**. FinCEN looks at the natural person who buys/sells CVC for fiat as a business. An LP who posts liquidity, takes Venmo, and releases USDC for spread is the Powers fact pattern, not a software-license fact pattern.
- A matching-only, fully non-custodial protocol **might** sit on FinCEN’s “parties settle independently” side; Loofta becoming a **network that recruits, scores, and routes LPs** starts to look like a marketplace that facilitates money transmission. State MTL licensing is a separate, often stricter overlay (not researched in depth here).
- Venmo/Cash App as crypto ramps are **TOS-incompatible with commercial LP behavior** even before MSB law. Account freezes and chargebacks are the expected failure mode, not an edge case (Bisq already abandoned those rails).

### Gaps
- No public **user count** for zkp2p/Peer; Dune is linked from the V2 post but was not fetched. DefiLlama does not report unique makers/takers.
- No primary legal opinion on whether zkTLS-attested Venmo ramps change FinCEN status. FIN-2019-G001 predates zkTLS.
- No official Venmo/PayPal enforcement action **specifically** naming zkp2p; TOS risk is inferred from the agreement text, not from a published takedown of Peer.
- State-by-state money-transmitter licensing for LPs and for a “P2P LP network” operator was not mapped (CA, NY BitLicense, TX, etc.).

---

## Historical P2P desks, EM corridors, and LP unit economics (spread, lockup, fraud, chargebacks)

### Takeaway
Standalone P2P marketplaces have been **dying under compliance cost and founder/legal risk** (LocalBitcoins 2023, LocalMonero 2024, Paxful Nov 2025, NoOnes Aug 2026 reported). The surviving volume is on **licensed exchange P2P desks** (Binance/Bybit) in capital-control and high-inflation corridors (India, Nigeria, Brazil, Russia), where being a merchant/cashier is a **real grey-market job** with 0.5–5% spreads — and with fraud, WhatsApp leakage, and regulator raids as the job description, not a side quest.

### Cited Findings
- **Paxful** wound down **all operations by 1 Nov 2025**. Stated reasons: lasting impact of “historic misconduct” by former co-founders Ray Youssef and Artur Schaback prior to 2023, plus “unsustainable operational costs from extensive compliance remediation.” Claimed **14 million users, 140+ countries**, 400+ payment methods, BTC/USDT. Not insolvency. Remainder is withdrawal-only, with possible monthly maintenance fees. — [Paxful closure announcement](https://paxful.com/blog/paxful-closure-announcement); [Paxful withdraw site](https://withdraw.paxful.com/)
- **LocalBitcoins**: new registrations suspended 9 Feb 2023; trading stopped **16 Feb 2023**; thereafter withdrawals. Cited in 2026 round-ups as the first of the classic P2P deaths. — [Blockwisely, NoOnes shutdown](https://blockwisely.com/news/noones-shutdown-p2p-livelihoods-africa/) (secondary; official LocalBitcoins notice not fetched)
- **LocalMonero**: wind-down began 7 May 2024; new trades disabled **14 May 2024**; site down after **7 Nov 2024**. Switched to fully non-custodial settlement during wind-down. — [LocalMonero, Fully Non-Custodial Trade Settlements](https://localmonero.co/blog/announcements/fully-non-custodial-trade-settlements)
- **NoOnes** (Paxful-founder successor, Africa-heavy): P2P marketplace reported to close **21 Aug 2026, 23:59 UTC**. Secondary coverage frames a sequence: LocalBitcoins 2023 → Paxful 2025 → NoOnes 2026. — [Blockwisely](https://blockwisely.com/news/noones-shutdown-p2p-livelihoods-africa/); [paySwapr alternatives post](https://payswapr.com/blog/best-noones-and-paxful-alternatives) (both secondary; NoOnes official notice not fetched)
- Remaining shapes after those closures: (a) open P2P marketplaces with escrow (CoinCola, LocalCoinSwap, Remitano, paySwapr); (b) **exchange P2P desks**; (c) non-custodial Bisq / RoboSats / Haveno / Hodl Hodl. Exchange P2P has deeper liquidity and KYC; open marketplaces keep gift cards and exotic methods. — [paySwapr](https://payswapr.com/blog/best-noones-and-paxful-alternatives)
- **India USDT/INR P2P**: OpenRate (aggregator of 9 venues) estimates **$30–60M daily** advertised volume; actual fills maybe 60–80% of ads. India routinely **top-3 globally** with Russia and Nigeria. Binance P2P estimated **30–45%** of India P2P; **800+ merchants**; FIU-registered since 2024; **1% TDS** auto-deducted; UPI/IMPS supported; **cash P2P discontinued 2024**; **no platform fee** (spread in the rate). Typical spread cited **0.5–1%**. — [OpenRate, India vs world](https://openrate.live/blog/p2p-volume-india-vs-world); [OpenRate, Binance P2P India 2026](https://openrate.live/blog/binance-p2p-india-guide)
- **Nigeria**: CBN Governor Yemi Cardoso said **$26 billion passed through Binance in 2023**; industry dispute over methodology (inflow vs outflow; “90% of P2P is two Nigerians”). Feb 2024 clampdown emptied Binance P2P ads; NSA investigation / reported $10B fine (government denied the figure). Sources told Techpoint **large P2P volume is on WhatsApp, not Binance**; some merchants claimed **>$1M/day**, biggest **>$5M/day**. — [Techpoint Africa, Binance P2P and the naira](https://techpoint.africa/insight/more-p2p-takes-place-on-whatsapp/)
- A 2025 industry blog (DexManiac, citing TechInAfrica) claims Nigeria P2P **>$500M/month**, Binance ~45% share, 2–5% NGN spreads. Treat as **low-quality** versus Techpoint/CBN. — [DexManiac](https://dexmaniac.com/nigeria-s-p2p-crypto-trading-boom-top-peer-to-peer-platforms-in)
- Corridor spread table (CryptoSavvyGuide, 2026, not an exchange primary): India UPI 0.5–1% instant; Brazil Pix 0.5–1.5%; Philippines GCash 0.5–1.5%; Nigeria bank/Opay 2–5%; Kenya M-Pesa 1.5–3%; Indonesia DANA 0.5–1%; Thailand PromptPay 0.3–0.8%. Spreads track **FX volatility and capital controls**, not platform fees. — [CryptoSavvyGuide, Binance P2P 2026](https://cryptosavvyguide.com/binance-p2p-guide.html)
- **Airtm**: P2P “cashiers” hold USDC; Airtm **custodial escrow** during the fiat leg; cashiers confirm receipt then USDC releases. Users **bear chargebacks/reversals**; Airtm can debit the account. First-transaction protection for cashiers is **narrow**: PayPal/Skrill/Wise only, first-time user, **max 100 USDC**, 2 tx/week or 300 USDC/month, **balance-funded only (no cards)**. Venmo is not in the protection list. — [Airtm escrow help](https://help.airtm.com/en/support/solutions/articles/47000229466-how-does-escrow-work-in-p2p-transactions-); [Airtm first-transaction protection](https://help.airtm.com/en/support/solutions/articles/47001250722-first-transaction-protection-program); [Airtm Terms](https://www.airtm.com/en/terms-and-conditions/)
- **Chainalysis 2025 Global Adoption Index** (year to June 2025): India #1, US #2, Pakistan #3, Vietnam #4, **Brazil #5, Nigeria #6**, Indonesia #7, **Philippines #9**. APAC on-chain value received **+69% YoY to $2.36T**; LATAM +63%; Sub-Saharan Africa +52% (remittances/everyday payments). Stablecoins (USDT/USDC) dominate; USDT ~$703B/month, peaking $1.01T (June 2025). Index is web-traffic-weighted on-chain estimates, not P2P fill data. — [Chainalysis 2025 Global Adoption Index](https://www.chainalysis.com/blog/2025-global-crypto-adoption-index/)
- LATAM: CEX share 64% of activity; stablecoin purchases >50% of exchange buys for COP, ARS, BRL (Jul 2024–Jun 2025, CryptoCompare order books). Local brands (Mercado Bitcoin, Ripio, Bitso) sell **fiat on-ramps + remittances + local payment integrations**, not DIY Venmo LPs. — [Chainalysis, LATAM 2025](https://www.chainalysis.com/blog/latin-america-crypto-adoption-2025/)
- Off-ramp is the remittance bottleneck: P2P spreads cited **Nigeria 2–5%, Pakistan 1–3%, Mexico 1–2.5%, Philippines 0.5–2%, India 0.5–1.5%**. A $200 Nigeria transfer at 4% = $8 conversion vs Wise often cheaper at that size. — [Spark, Wise vs crypto remittance](https://www.spark.money/tools/wise-vs-crypto-remittance)

### Inferences
- **“LP as a job” is already a job in Nigeria/India/LATAM** — as a **Binance/Bybit/Airtm merchant**, not as a zk protocol hobbyist. Capital lockup is inventory of USDT/USDC plus fiat float; revenue is spread minus (TDS in India, fraud, frozen bank accounts, WhatsApp scam leakage, regulatory seizures).
- The **standalone marketplace** that sits between those merchants and users has a terrible 2023–2026 survival rate once it tries to become compliant. Exchange P2P absorbed the volume **because the exchange already paid for KYC/MSB**.
- US/UK Venmo–Cash App–Revolut LPing is a **different product**: high chargeback, TOS-hostile, FinCEN-visible, thin zkp2p volume. Do not analogize Nigerian P2P merchants to US Venmo LPs.
- Unit economics that survive: **tight spreads on instant rails with low reversibility** (UPI, Pix, GCash, PromptPay when the bank/e-wallet will not claw back) plus **platform escrow + KYC**. Unit economics that die: reversible US P2P (Venmo/Cash App) and gift-card P2P (Paxful’s old core).

### Gaps
- No audited P&L for a median Binance P2P merchant (working capital, freeze rate, chargeback %, hours). Merchant “$1M/day” claims are anecdotal via Techpoint.
- Airtm GMV/user counts not found in this pass.
- Bisq/RoboSats/Haveno volumes not pulled.
- Official NoOnes and LocalBitcoins closure notices not fetched (secondary only).
- PAJ Cash (Loofta’s licensed Nigerian partner path) public volume/license status not researched here; internally it is a third-party ramp with KYC (BVN/NIN), not a user-LP network.

---

## QR / instant-pay countries: is crypto-to-QR a job or a crime / TOS risk?

### Takeaway
In instant-pay countries the **demand** to turn USDT/USDC into UPI/Pix/GCash/M-Pesa/DuitNow is large and already filled by exchange P2P. Whether it is a **job or a violation** depends on the rail: **China is a ban**; **India UPI-for-crypto is a grey/shadow-ban**; **Brazil Pix and PH GCash crypto-to-wallet** are widely used on exchange P2P but still sit on wallet TOS and local VASP rules. It is **not** a clean “future of work” for a US product to recruit unlicensed people to pay strangers via QR.

### Cited Findings
- **India / UPI:** NPCI did not authorize Coinbase to buy crypto via UPI (2022). Banks later blocked UPI to crypto platforms after **verbal NPCI instructions**; NPCI told ET it had “no intentions of any circular.” IMPS was left ambiguous. Crypto trading/holding is not a blanket criminal ban; **using UPI as an exchange on-ramp is institutionally discouraged**. — [Economic Times, banks seek NPCI note](https://economictimes.indiatimes.com/markets/cryptocurrency/top-banks-ask-npci-to-clarify-its-stance-on-upi-for-crypto/articleshow/91060683.cms); [Gadgets360 / Coinbase UPI](https://www.gadgets360.com/cryptocurrency/news/india-restore-upi-access-crypto-exchange-4042755)
- Sep 2025: Reuters-reported Indian government document (via crypto.news) says full crypto regulation is unlikely because it would “grant them legitimacy”; a ban would not stop P2P/DEX. **Stablecoins are singled out as a threat that could fragment UPI.** — [crypto.news, India holds back on full crypto regulation](https://crypto.news/india-holds-back-on-full-crypto-regulation-over-financial-stability-concerns/)
- Despite that, Binance P2P India **does** list UPI/IMPS in 2026 practitioner guides, with FIU registration and 1% TDS — i.e. **P2P person-to-person UPI** continues even where **exchange-as-merchant UPI** was blocked. — [OpenRate, Binance P2P India 2026](https://openrate.live/blog/binance-p2p-india-guide)
- **China / WeChat / Alipay:** PBOC (2021) summoned Alipay and major banks: **no crypto-related services**. Alipay: will cut payment service for any virtual-currency transaction and remove merchants. Sep 2021 multi-agency **blanket ban** on crypto transactions and mining; payment companies and internet firms barred from facilitating. WeChat/Alipay as a Loofta corridor is **closed**. zkp2p docs nonetheless list Alipay as an “additional” deployment script — that is a **protocol hook, not evidence of a legal China corridor**. — [CNBC, PBOC Alipay](https://www.cnbc.com/2021/06/21/china-central-bank-urges-alipay-banks-to-crack-down-on-crypto.html); [Reuters, China crypto ban](https://www.reuters.com/world/china/china-central-bank-vows-crackdown-cryptocurrency-trading-2021-09-24/); [zkp2p payment methods](https://zkp2p-zkp2p-contracts.mintlify.app/resources/supported-payment-methods)
- **Brazil Pix / PH GCash / SEA QR / Africa MM:** appear as standard Binance P2P methods with sub-2% spreads in practitioner tables; Chainalysis ranks Brazil #5 and Philippines #9 in 2025 adoption. That shows **product-market fit for last-mile local rails**, not a legal blessing for an unlicensed US LP network. — [CryptoSavvyGuide](https://cryptosavvyguide.com/binance-p2p-guide.html); [Chainalysis 2025 index](https://www.chainalysis.com/blog/2025-global-crypto-adoption-index/)
- **US reversible rails vs QR irrevocable rails:** Bisq’s Venmo/Cash App chargebacks ($1,850 on five trades) are the US failure mode. UPI/Pix/PromptPay are closer to “push payments” with weaker consumer chargeback; fraud then shifts to **wrong-person / social-engineering / mule accounts**, which is why exchange P2P still uses KYC + escrow + completion-rate badges. — [Bisq](https://bisq.community/t/important-cash-app-and-venmo-payment-methods-have-been-blocked-due-to-chargeback-activity/5459/1); [OpenRate India guide](https://openrate.live/blog/binance-p2p-india-guide)

### Inferences
- Crypto-to-QR is a **real EM occupation** (cashier/merchant on a **KYC’d exchange desk**). Recreating it as “users earn by paying others via UPI/Pix/GCash on Loofta” without becoming (or partnering with) a licensed VASP/MSB in each corridor copies the **Paxful risk**, not the **Binance P2P** risk.
- India’s official nervousness about stablecoins vs UPI is a **strategic warning**: a successful USDC-to-UPI consumer product is exactly what the state payment system does not want to legitimize.
- For Loofta, the **licensed-partner pattern already used for PAJ Cash (NGN)** is the corridor analogue that does not require turning users into unlicensed exchangers. QR countries would need **local licensed ramps**, not a global LP job board.

### Gaps
- No primary NPCI circular (because none was issued — the ban is informal).
- GCash, Maya, DuitNow, MoMo, Pix **wallet TOS** excerpts not fetched; Brazil/PH VASP licensing for P2P desks not mapped.
- No 2025–2026 enforcement stats on Indian UPI mule accounts used for USDT P2P.
- DuitNow / MoMo / WeChat Pay volume for crypto specifically: not found.

---

## Merchant stablecoin acceptance 2026 vs “just get more merchants to accept USDC”

### Takeaway
**Availability is racing ahead of usage.** Stripe, Shopify, and PayPal can take USDC at checkout in 2025–2026; merchants typically **settle to fiat** and never touch a wallet. Public on-chain evidence of Shopify/Coinbase Commerce Payments Protocol volume is **about $1.2M over ~6 months** — rounding error versus Shopify GMV. “Every business accepts crypto” is **not** the 2026 curve. Even the product being sold is **merchant acceptance with fiat settlement** (Stripe-like), which is a different job from **consumer P2P off-ramp** (Venmo-like).

### Cited Findings
- **Stripe** (docs): enable “Stablecoins and Crypto” payment method; customer redirects to crypto.stripe.com, pays USDC, **funds settle in Stripe balance in USD**. Available to US businesses except New York (docs page; a Stripe.dev post says US-only). Fee cited on Stripe.dev: **1.5%**. Networks named: Ethereum, Solana, Polygon, Base. — [Stripe, Accept stablecoin payments](https://docs.stripe.com/payments/accept-stablecoin-payments); [Stripe.dev, stablecoin payments](https://stripe.dev/blog/using-stripe-stablecoin-payments-no-crypto-knowledge.md)
- **Stripe × Shopify**, 12 Jun 2025: Shopify merchants in **34 countries** will accept USDC; shoppers pay USDC on **Base**; default is **local-currency bank payout**; optional USDC wallet. Stripe Connect US platforms can turn this on for their sellers. Stripe claims **>$94B stablecoin payments globally in two years**, monthly “payment volume” from **<$2B to >$6.3B** (Stripe’s definition of stablecoin *payments*, not Shopify checkout). — [Stripe newsroom](https://stripe.com/newsroom/news/shopify-stripe-stablecoin-payments); [Shopify, Introducing USDC](https://www.shopify.com/news/stablecoins-on-shopify)
- **Shopify Help Center (2026):** USDC is a Shopify Payments local method; eligible regions NA/EU/APAC with residency constraints; customers cannot open disputes on USDC orders; no subscriptions; no partial capture. Default payout is merchant payout currency; some regions can claim USDC to a wallet. Cashback in USDC on Base for some checkouts. — [Shopify Help, USD Coin](https://help.shopify.com/en/manual/payments/shopify-payments/local-payment-methods/usdc-payments)
- **Usage, not availability:** growthepie data reported Feb 2026: Commerce Payments Protocol (Shopify/Coinbase on Base) processed **~$1.2M USDC since June**, ~**3,200 customers**, ~**5,700 merchants**; ~$750k of that in the last 60 days. Coinbase called it “a piece of the puzzle,” rollout ongoing, classic slow-then-fast. Secondary news writeup. — [US Finance Times citing growthepie / The Defiant](https://www.usfinancetimes.com/payments-protocol-by-coinbase-shopify-processes-just-1-2m-usdc-since-june-growthepie.html)
- **PayPal** “Pay with crypto”: US merchants, global buyers, redirect flow, **local-currency settlement**, min $0.01 USD, refunds in PYUSD. Allow-list includes USDC, USDT, BTC, ETH, SOL, and many alts. This is **merchant crypto acceptance**, not P2P LP. — [PayPal Developer, crypto](https://developer.paypal.com/crypto)
- **Square:** 2026 Shopify payment-gateway comparison treats Square as in-person/card POS; **no native USDC checkout found** in this pass. — [Shopify, Payment Gateway Comparison 2026](https://www.shopify.com/blog/payment-gateway-comparison)
- Eligibility holes: Shopify USDC excludes at least some US states in secondary writeups (AK, NY, TX named by Payyd); Stripe excludes NY. Crypto checkout is **not** “every merchant in every state.” — [Payyd, Shopify crypto gateways](https://payyd.io/blog/shopify-crypto-payment-gateway); [Stripe docs](https://docs.stripe.com/payments/accept-stablecoin-payments)

### Inferences
- Loofta does **not** need to “get more businesses to accept crypto” as its primary growth motion. Stripe/Shopify/PayPal will do that for **checkout**. That motion **does not replace** send-to-handle, claim, payroll, incentives, or person-to-person corridors.
- If Loofta’s strategy were “be the merchant acquirer for USDC,” it would be competing with Stripe at 1.5% and Shopify’s bundled rate — a bad wedge.
- The honest 2026 merchant-acceptance % is: **feature on, volume off**. Treat “100% of businesses accept USDC” as a **stress-test counterfactual**, not a forecast.

### Gaps
- No official Shopify or Stripe **share of checkout volume** that is USDC. growthepie $1.2M is protocol-level on Base and Coinbase said it is incomplete.
- Square, Adyen, Checkout.com stablecoin status 2026: not verified beyond Square’s absence in one comparison post.
- Visa/Mastercard stablecoin settlement pilots 2025–2026: not fetched in this pass (gap).
- Stripe Bridge acquisition’s effect on merchant USDC: not separately sourced here.

---

## If merchants take USDC at checkout, does pay-by-handle still matter?

### Takeaway
Yes. Merchant checkout is **pay a business at a till**. Loofta’s handle is **pay a person who may not be a merchant**. Those are different graphs. Venmo, Cash App, PayPal, and email/phone numbers all survived universal Visa acceptance. Handles still matter for P2P, payroll, creator/campaign incentives, cross-border to households, unbanked/underbanked cash-out, and “I don’t want to collect a wallet address.”

### Cited Findings
- Venmo’s own agreement still centers **personal payments to people you know**, separate from **authorized merchant checkout** and business profiles. Venmo does not claim to be a marketplace; merchant QR/checkout is a distinct rail. — [Venmo User Agreement](https://venmo.com/legal/us-user-agreement)
- Cash App: $Cashtag is the identity primitive; P2P is defined as personal; Business Accounts and Earn-in-P2P are bolted on later. Remittance Service is “personal, non-commercial” cross-border. Block reports **59M monthly transacting actives** (Mar 2026) on Cash App — a consumer P2P brand that exists **on top of** card networks. — [Cash App TOS](https://cash.app/us/en/legal/tos); [CoinLaw, Venmo vs Cash App 2026](https://coinlaw.io/venmo-vs-cash-app-statistics/) (aggregator; use for order-of-magnitude only)
- Chainalysis: in Sub-Saharan Africa and LATAM, crypto use is **remittances, dollar savings, everyday payments**, not Shopify carts. Recipients are households. — [Chainalysis 2025 index](https://www.chainalysis.com/blog/2025-global-crypto-adoption-index/); [Chainalysis LATAM 2025](https://www.chainalysis.com/blog/latin-america-crypto-adoption-2025/)
- Remittance last mile still fails if the recipient must “have a wallet and find an off-ramp.” IdealRemit: Wise/Remitly win on **delivery UX** even when crypto wins on theoretical cost. — [IdealRemit, crypto international money transfer 2026](https://idealremit.com/en/blog/crypto-international-money-transfer)
- Loofta product already separates **claim in crypto** from **claim in cash** (Venmo, Cash App, Revolut, Zelle, PAJ Cash) and **send to @handle/email** — i.e. the company is already in the person-to-person + claim graph, not the merchant acquiring graph. — company context in this research brief; Loofta marketing copy in HomeV3/home-v4

### Inferences
- Pay-by-handle dies only in a world where **every person** (not every business) has a default, memorable, non-crypto-looking account number issued by the OS or the bank. That is Apple Cash / PIX keys / UPI VPA / $cashtag territory. Until then, @handle/email is the account number.
- Merchant USDC at checkout **increases** the value of a consumer brand that can **receive and then cash out**, because more money starts on-chain and still needs to reach people who want Venmo/Naira/GCash.
- Privacy and “don’t share a wallet” are orthogonal to merchant acceptance.

### Gaps
- No survey of what % of Loofta volume is P2P vs merchant-like payment links vs giveaway claims (internal data not in this research pass).
- No 2026 share of US P2P volume that still uses Venmo/Cash App vs A2A/FedNow/RTP.

---

## Analogies: Venmo vs Visa, Cash App, Western Union vs Wise — Loofta’s wedge

### Takeaway
Universal merchant rails never killed consumer P2P brands or last-mile MTOs. They **repriced** them. Visa everywhere → Venmo still exists as **social graph + handle + instant P2P**. Wise cheaper than Western Union → WU still exists as **cash-out density in corridors digital-only cannot touch**. Loofta’s analogue is **not** “crypto Visa.” It is **Cash App for claiming money sent to a handle**, plus **WU-like last mile** where the recipient is a person, plus **Tremendous-like escrowed payouts** for campaigns.

### Cited Findings
- World Bank RPW Q3 2025: global average cost to send **$200 is 6.36%** (down from 6.49% in Q1 2025). International MTO index (Western Union + MoneyGram, present in 95% / 90% of corridors) **5.52%**. Digital remittances **4.59%**. Digital-only MTO index (Wise, Remitly, WorldRemit, InstaReM, Xoom) **3.54%**. Sub-Saharan Africa still **8.46%**, most expensive receiving region. Banks **14.99%**. 367 corridors. SDG target 3% by 2030, unmet. — [World Bank remittanceprices homepage](https://remittanceprices.worldbank.org/); [RPW Issue, Q3 2025 PDF](https://remittanceprices.worldbank.org/sites/default/files/2026-04/RPW_main_report_and_annex_Q325.pdf)
- WU/MoneyGram remain the **coverage** index, not the **price** leaders. Digital-only is cheaper and still a minority of priced services (digital was 35% of observations in one Q3 2025 commentary). — [Max Avery summary of RPW Issue 54](https://www.maxavery.org/blog/what-sending-money-across-a-border-actually-costs/); [RPW PDF](https://remittanceprices.worldbank.org/sites/default/files/2026-04/RPW_main_report_and_annex_Q325.pdf)
- Wise FY2025 (year to Mar 2025) **£145.2B** cross-border volume, **15.6M** active customers — huge, and **Western Union still operates globally**. Crypto remittance guides treat WU/Wise/Remitly as the comparison set, with crypto winning only when **off-ramp is cheap and the recipient can receive**. — [IMT, Money Transfer Statistics 2025](https://www.internationalmoneytransfer.com/guides/statistics) (aggregator for Wise figures); [IdealRemit](https://idealremit.com/en/blog/crypto-international-money-transfer)
- Cash App / Venmo: consumer P2P identity ($cashtag, Venmo username) plus social feed plus instant push, **after** cards already won merchant acquiring. Cash App TOS still calls P2P “personal, non-commercial” while separately offering Business Accounts — brand first, acquiring second. — [Cash App TOS](https://cash.app/us/en/legal/tos); [Venmo User Agreement](https://venmo.com/legal/us-user-agreement)
- Tremendous analogy (from prior Loofta research): consumer gifting toy → **bulk business payouts** (“Rewards and payouts, simplified”), 25k+ companies, 100M+ payouts. The surviving sentence is **escrowed money that pays when work is proven**, not “we accept USDC at the café.” — [reports/Stablecoin marketing rewards layer.md](../../reports/Stablecoin%20marketing%20rewards%20layer.md) (prior internal synthesis; original Tremendous URL cited there)

### Inferences
- **Loofta wedge that maps to the analogies:**
  1. **Handle as cashtag** (Venmo/Cash App): send to @user/email without a wallet.
  2. **Claim brand** (Cash App “the money is here, tap to get it in the form you want”).
  3. **Last-mile corridor** (WU, not Wise): especially NG via PAJ Cash; QR countries only via **licensed partners**.
  4. **Campaign escrow** (Tremendous): verification-gated creator/giveaway payouts — independent of merchant crypto.
- **Loofta wedge that does not map:** becoming the LP job network (Paxful). That company died of compliance. Binance P2P survived because it was already a licensed exchange.
- If merchant USDC hits 100%, the Visa-everywhere world has arrived. The companies that still get paid are **brands with a graph** and **last-mile cash-out**, not new acquirers.

### Gaps
- Western Union 2025–2026 transfer volume vs Wise not pulled from WU 10-K in this pass (IMT $75B / 120M+ is unverified aggregator).
- No quantitative “% of Visa-accepting merchants that still get paid via Venmo P2P” — the analogy is structural, not measured.

---

## Strongest durable value ranking (what dies if crypto UX becomes default)

### Takeaway
Ranked by **survival if (a) merchant USDC checkout is ubiquitous and (b) wallets are as easy as Apple Pay**, with evidence. **Do not build an unlicensed P2P LP desk.** The durable stack is **handle + claim brand + escrowed campaign payouts + licensed corridors**. P2P LP network and “first wallet” are the first to die or to get the company killed.

### Cited Findings
Evidence supporting each candidate (then ranking):

1. **Identity / handle as account number**  
   Venmo usernames, Cash App $cashtags, PIX keys, UPI VPAs, email for PayPal: consumer payment identity outlives merchant acquiring. Venmo still tells users to pay **people they know** on a handle, separate from authorized-merchant checkout. — [Venmo User Agreement](https://venmo.com/legal/us-user-agreement); [Cash App TOS, $Cashtag](https://cash.app/us/en/legal/tos)

2. **Consumer brand for claiming money**  
   Cash App 59M monthly transacting actives (Block, Mar 2026, via secondary); claim/cash-out UX is the product. Recipients in remittance corridors fail on wallet+off-ramp complexity, not on lack of Shopify USDC. — [CoinLaw aggregator of Block](https://coinlaw.io/venmo-vs-cash-app-statistics/); [IdealRemit](https://idealremit.com/en/blog/crypto-international-money-transfer)

3. **Escrow / verification for campaigns**  
   FinCEN escrow ruling (FIN-2014-R004): acceptance/transmission **integral to sale of goods/services other than money transmission**, released on **pre-established conditions**, can fall outside MT — contrasting with real-time deposit services that just hold until instructed, which **are** MT. Prior Loofta research: Tremendous-style “money moves when the work is proven” is the B2B sentence. — [FinCEN FIN-2019-G001](https://fincen.gov/sites/default/files/2019-05/FinCEN%20CVC%20Guidance%20FINAL.pdf); [prior notes, narrative.md](../Stablecoin%20marketing%20rewards%20layer/narrative.md)

4. **Corridor off-ramp (licensed)**  
   World Bank: SSA still 8.46% to send $200; digital-only 3.54% but WU/MG still cover 90–95% of corridors. Chainalysis: NG, BR, PH, IN among top adoption. PAJ Cash is Loofta’s existing **partner** NGN path (KYC, bank account, not user-LP). — [RPW Q3 2025](https://remittanceprices.worldbank.org/); [Chainalysis 2025](https://www.chainalysis.com/blog/2025-global-crypto-adoption-index/)

5. **P2P LP network**  
   zkp2p/Peer: $1.24M/30d, $80k TVL. Paxful dead. FinCEN: P2P exchanger-as-business = MSB. Venmo/Cash App TOS: commercial P2P and crypto/foreign-currency activity prohibited. Bisq abandoned Venmo/Cash App after chargebacks. — [DefiLlama Peer](https://defillama.com/protocol/peer); [Paxful](https://paxful.com/blog/paxful-closure-announcement); [FinCEN 2019](https://fincen.gov/sites/default/files/2019-05/FinCEN%20CVC%20Guidance%20FINAL.pdf); [Venmo UA](https://venmo.com/legal/us-user-agreement); [Cash App TOS](https://cash.app/us/en/legal/tos); [Bisq](https://bisq.community/t/important-cash-app-and-venmo-payment-methods-have-been-blocked-due-to-chargeback-activity/5459/1)

6. **Onboarding / first wallet**  
   Stripe/Shopify/PayPal + Coinbase/Phantom make “get a wallet and pay a store” a platform feature. Shopify USDC is guest checkout + Shop Pay + 480 wallets. First-wallet as a startup moat is what dies first if crypto UX is default. — [Stripe newsroom](https://stripe.com/newsroom/news/shopify-stripe-stablecoin-payments); [Shopify USDC](https://www.shopify.com/news/stablecoins-on-shopify)

7. **Privacy / shielded MagicBlock-style transfers**  
   zkp2p itself markets “no intrusive KYC” and hashed payee IDs on-chain. Chainalysis still shows CEX dominance in LATAM (64%). Privacy is a **niche durable** for a subset (payroll, public figures, campaign payees who do not want a doxxing wallet). It is not the volume wedge. NYDFS/Block mixer findings show **regulators treat anonymity rails as high risk**. — [zkp2p docs](https://zkp2p-zkp2p-contracts.mintlify.app/resources/supported-payment-methods); [Chainalysis LATAM](https://www.chainalysis.com/blog/latin-america-crypto-adoption-2025/); [NYDFS Block order](https://www.dfs.ny.gov/system/files/documents/2025/04/ea20250410-block.pdf)

### Inferences
**Ranking (durable → fragile) if crypto UX is default:**

| Rank | Asset | Dies if merchants take USDC? | Dies if wallets are default UX? | Evidence strength |
| --- | --- | --- | --- | --- |
| 1 | Handle as account number | No (person≠merchant) | Weakens only if OS/bank issues the default alias | Strong (Venmo/cashtag/PIX/UPI) |
| 2 | Consumer claim brand | No; **gains** inbound on-chain money | Weakens vs Cash App/Venmo/PayPal brands | Medium (analogy + remittance UX) |
| 3 | Escrow/verification for campaigns | No | No | Strong (Tremendous + FinCEN escrow contrast) |
| 4 | Licensed corridor off-ramp | No (households, not tills) | No | Strong (WB costs + Chainalysis corridors) |
| 7 | Privacy/shielded transfers | No | Partially (becomes a feature flag) | Medium (demand real, regulator-hostile) |
| 6 | First wallet / onboarding | Yes-adjacent | **Yes** | Strong (Stripe/Shopify guest checkout) |
| 5 | Unlicensed P2P LP network | Irrelevant | Irrelevant — **dies of law/TOS first** | Strong (FinCEN + Paxful + Venmo TOS) |

- **If every business accepts crypto, Loofta is not dead** — unless Loofta’s only pitch was “pay this store in USDC.” The company as described (send to handle, claim to tokens or cash) is the **Venmo/Cash App/WU** layer, which historically **survives** universal merchant rails.
- **Need more businesses to accept crypto?** Not as Loofta’s job. That is Stripe/Shopify. Loofta needs more **people with handles** and more **licensed last miles**.
- **LP-as-a-job:** real in EM on **KYC’d exchange desks**; **not** a recommended Loofta product in the US Venmo/Cash App sense. Recruiting users to fulfill local QR payments without local licenses copies a failed company category.

### Gaps
- Internal Loofta mix of send/claim/giveaway/off-ramp GMV would tighten the ranking; not in this pass.
- MagicBlock (ephemeral rollup) privacy properties vs “shielded” user perception: not evaluated technically here.
- No 2026 court case applying FIN-2019-G001 to zkTLS P2P ramps.

---

## Cross-cutting constraints (for the report writer)

- **Do not recommend** Loofta standing up an unlicensed P2P liquidity network or encouraging users to earn spreads by paying strangers on Venmo, Cash App, Revolut, UPI, Pix, GCash, or MoMo.
- **Consumer P2P ≠ merchant acceptance.** Stripe/Shopify USDC is the latter (business checkout, fiat settlement). zkp2p/Binance P2P/Airtm cashiers are the former (person sells fiat for USDC).
- **Venmo/Cash App as crypto ramps:** TOS-prohibited for commercial LP use; chargeback-toxic (Bisq); FinCEN treats the LP as a money transmitter if done as a business.
- **zkp2p/Peer** can remain a **taker-side cash-out integration** (what Loofta already does) without Loofta becoming the LP marketplace. That is a product distinction worth keeping.
- **100% merchant crypto** is a thought experiment. 2026 data: rails exist, volume does not. Even in the thought experiment, handle + claim + escrow + licensed corridors remain.
