# Fiat mass-payout and contractor/creator payout incumbents (2025–2026)

Fetched 13 October 2026. All prices below are **published list prices** unless labeled negotiated / sales-quoted / aggregator. Do not treat list prices as what a high-volume buyer actually pays. When a vendor publishes no number, the finding is **unknown**, not a guess.

Loofta context for the writer: Solana product that lets a business pay any email/@username before the recipient has an account; recipient claims to USDC, Venmo, Cash App, Revolut, Zelle, or a local bank.

## 1. Exact fees: platform, per-payout, FX, instant, cross-border, minimums

### Takeaway
Published list prices cluster into four models: (a) **flat cents** on a closed network (PayPal/Venmo Payouts API $0.25 USD; Increase ACH $0.50 next-day); (b) **percent-of-cash** on claim-later rewards (Tremendous 4–6% for Venmo/PayPal/Cash App/bank); (c) **per-seat SaaS + FX** for contractors (Deel $49, Remote $29, Toku $19, Rise $49, Gusto $49+$6 or $5/global payment); (d) **quote-only enterprise** (Tipalti, PayPal Enterprise/Hyperwallet, Nium, Thunes, Ebanx, Modern Treasury). Instant payouts are consistently ~1–1.5%. FX markups that are published sit at 0.23% (Wise floor) to 2% (Trolley) to 0.5–1% (Airwallex).

### Cited Findings

**PayPal Payouts / Venmo Payouts (US merchant schedule, list)**
- US web/Mass Pay-style Payouts: **2% of the transaction, not to exceed the cap**. USD cap **$1.00**. — [PayPal US merchant fees, 1 Sep 2026](https://www.paypalobjects.com/marketing/ua/pdf/US/us-merchant-fees-01-september-2026.pdf); same structure in [19 May 2025](https://www.paypalobjects.com/marketing/ua/pdf/US/us-merchant-fees-19-may-2025.pdf) and [13 Jan 2025](https://www.paypalobjects.com/marketing/ua/pdf/US/us-merchant-fees-13-jan-2025-v2.pdf)
- US **Payouts API**: **flat $0.25 USD** per payout (not 2%). Other API flats: €0.22, £0.17, C$0.32, A$0.32, ¥30, ₱12.50, R$0.50, etc. MYR API fee “Not Applicable”. — [PayPal US merchant fees, 1 Sep 2026](https://www.paypalobjects.com/marketing/ua/pdf/US/us-merchant-fees-01-september-2026.pdf)
- International Payouts: **2% not to exceed the international cap**. USD international cap **$20.00**. Other international caps: €16, £14, A$24, R$40, ₱1,000, ¥2,000. — same PDF
- Developer docs (updated 14 Sep 2026): fee is charged to the **sender**, not the recipient; “typically” 2% with a cap; **Venmo payouts incur the same fees as PayPal Payouts in the US**; extra fees if currency conversion is required. — [PayPal Payouts fees](https://developer.paypal.com/payouts/fees)
- No published platform/subscription fee for Payouts API. No published instant-payout surcharge separate from the above (PayPal/Venmo wallet credit is the product).

**PayPal Enterprise Payouts (formerly Hyperwallet)**
- Official page: **no published rate card**. “Pricing for Enterprise Payouts is customized based on your payout volume, transaction size, and markets served.” — [PayPal Enterprise Payouts](https://www.paypal.com/us/business/make-payments/enterprise-payouts)
- A 2026 Wingspan competitor review claims PayPal’s US business fee page lists Hyperwallet transfer fees of **$0.95 domestic bank, $1.50 domestic instant bank, $4.95 international bank, $0.25 PayPal/Venmo/PYUSD**, plus **2% FX spread in “basic” regions and 4% in others**. I did **not** independently extract that table from the official 1 Sep 2026 merchant-fee PDF in this pass. Treat as unverified secondary until pulled from the PDF. — [Wingspan Hyperwallet review](https://www.wingspan.app/alternatives/hyperwallet)

**Stripe Connect (payouts to connected accounts)**
- Two models. **Stripe handles pricing**: platform pays **no** extra account, payout-volume, tax-reporting, or per-payout fee. **You handle pricing**: **$2 per monthly active account** (active = a month in which a payout is sent to bank or debit) + **0.25% + 25¢ per payout**. — [Stripe Connect pricing](https://stripe.com/connect/pricing)
- Instant Payouts (Connect): **1% of payout volume**, both models. Platform can mark up further. US min **$0.50**, max **$9,999**. — [Stripe Instant Payouts for Connect](https://docs.stripe.com/connect/instant-payouts); [Stripe Connect pricing](https://stripe.com/connect/pricing)
- Cross-border Connect payouts: **starting at 0.25% of payout volume**. — [Stripe Connect pricing](https://stripe.com/connect/pricing)
- 1099 (you-handle-pricing): **$2.99 IRS e-file, $1.49 state, $2.99 mailed**. Stripe-handles-pricing: digital 1099 free. — [Stripe Connect pricing](https://stripe.com/connect/pricing)
- Account debits (you-handle only): **1.5% of debit volume**. Pay-with-Stripe-balance (preview): **1%**. — [Stripe Connect pricing](https://stripe.com/connect/pricing)

**Stripe Instant Payouts (merchant, not Connect) and Global Payouts (third-party send)**
- Standard Instant Payouts (merchant withdrawing own funds): **1.5%** of volume; “pricing differs for Connect users”. Standard scheduled payouts: free. — [Stripe pricing](https://stripe.com/pricing)
- Global Payouts **domestic**: local bank **$1.50**/payout; debit card **$1.50 + 0.75%**, **minimum 50¢**. — [Stripe pricing](https://stripe.com/pricing)
- Global Payouts **international** (50+ countries): **$1.50**/payout + cross-border **starting at +0.25%** + FX **starting at +0.5%**. Cross-border depends on recipient country; FX depends on merchant country. — [Stripe pricing](https://stripe.com/pricing)

**Wise Business / Wise Platform**
- US Wise Business: one-time setup **$31** for receiving-account details in multiple currencies. Volume discount above **$25,000** (or equivalent). Sending/converting: **from 0.23%**, varies by currency. Holding balances free. Domestic receive (non-SWIFT) in AUD/CAD/EUR/GBP/HUF/NZD/PHP/SGD/USD: free. USD wire/SWIFT receive: **$6.11**. GBP SWIFT receive **£2.16**. EUR SWIFT receive **€2.39**. — [Wise Business US pricing](https://wise.com/us/pricing/business)
- A Puerto Rico Wise Business page showed the same structure with a **$27** setup fee — treat as a regional list, not the US list. — [Wise Business PR pricing](https://wise.com/pr/pricing/business)
- Wise Platform: **no public rate card**. Investor materials: cost-plus-margin; revenue from transaction fees plus possible integration/licensing fees. Partners can override displayed fees via `pricingConfiguration` (beta, select partners). — [Wise investor topics](https://owners.wise.com/investor-topics); [Wise Platform pricing docs](https://docs.wise.com/guides/product/send-money/quotes/pricing)
- FY26 (year to 31 Mar 2026) average **cross-border take rate 0.52%**, down from 0.58%. — [Wise 20-F FY2026](https://www.publicnow.com/view/72DEEDED9C818A4CD025797601E935072B199F74?1782424094=)

**Payoneer (public “typical” table, last updated 1 Jan 2026)**
- Page is an **estimate** for “majority of account types in majority of regions.” Exact fee is shown in-account before confirm. Custom package for **>$50k USD monthly**. — [Payoneer pricing](https://www.payoneer.com/about/pricing/)
- Receive: Payoneer-to-Payoneer free; marketplace “varies”; local-currency receiving account free; non-local receiving account **1% (min $1)**; card receive **up to 3.99% + $0.49**; US ACH debit receive **1%**; EU/UK bank receive **1%**; PayPal receive (US) **up to 3.99% + $0.49**.
- Send to a Payoneer account: same-country **up to $4 / €4 / £4**; cross-country **up to 1% + up to $4**; card **up to 3.99%**; UK/EU bank **1%**; US ACH **1%**.
- Withdraw to bank: same-country local currency (listed countries including USA, UK, PH, VN, MX, KE, etc.) **$1.50**; to recipient local currency with no conversion **1.2%–4%** (some corridors min up to **$20**); with conversion **1.2%–4%**.
- US customers (by registration date): **$1.50** per withdrawal/payment up to **$50,000**/month, then **up to 0.5%**.
- Balance-to-balance currency move: **0.50%**.
- Annual account fee **$29.95** if the account receives **<$6,000** in any 12 consecutive months (not charged year 1 on paid annual plans). Annual card fee **$29.95**. Escheatment fee: “variable per state.”
- Mass-payout API: payees must be **registered first**; batch up to **500** via API. Batch-file FAQ (different product surface) allows up to **1,000** file payments; sender can choose who pays the fee. — [Payoneer mass submit](https://www.payoneer.com/developers-docs/mass-payout/mass-submit-payout/); [Payoneer batch FAQ](https://payoneer-enterprise.custhelp.com/app/answers/detail/a_id/32840)

**Tipalti**
- Accounts Payable plans **starting at $99/month**. Mass Payments plans **starting at $249/month**. Unlimited users. **Plus** transaction pricing per invoice/payment, entity count, and modules. No per-user fee. No free tier. Per-method fees and FX **not published** — “request a custom quote.” — [Tipalti pricing](https://tipalti.com/pricing/)

**Trolley (published calculator, USD list)**
- Modules: Pay **$2,399/year**; Tax **$2,399/year** (one jurisdiction on Standard); Trust **$1,199/year** (10 free IDV scans/month). 30-day free trial. — [Trolley pricing](https://trolley.com/trolley-pricing/)
- USD transaction fees: ACH **$1**; CAD EFT **$1**; SEPA/FPS/NPP/BECS **$4**; IACH **$4**; debit-card payout **1% ($1.50 min)**; FX wire **$10**; USD wire no-FX **$25**; PayPal **$0** (PayPal’s own fees may still apply); Venmo **$1.50** (PayPal fees may still apply); FX conversion **2.00%** (negotiable at volume). IRS statement **$2**; digital-platform reporting **$3**; IDV scan **$2.50**. Fees can be carried, split, or passed to recipients.

**Tremendous**
- Platform, API, bulk, fraud, tax tools: **$0**. Gift cards / prepaid Visa / donations: **face value**. Venmo, PayPal, Cash App, digital wallets, bank: **4–6%**. FAQ: Venmo and PayPal specifically **4% sender-paid, $0.25 minimum**, or **6% deducted from recipient**. Bank funding (US/EU/UK): **$0**. Card funding: **3%**. Volume conversation at **$200k+**/year. — [Tremendous pricing](https://www.tremendous.com/pricing/)

**Tango Card / Rybbon (BHN Rewards)**
- No official Tango or Rybbon rate card fetched. ITQlick (aggregator) reports Tango as pay-as-you-go, **3.5% card funding**, **$450 customization**, **$25–$250 cancellation**. Do not treat as official. — [ITQlick Tango pricing](https://www.itqlick.com/tango-card/pricing)
- Tremendous’s own comparison claims Tango charges for catalog customization and unused-fund withdrawal; Tremendous does not. — [Tremendous vs Tango](https://www.tremendous.com/compare/tango-card/)

**Giftbit**
- No subscription, platform, or minimum. Digital gift cards: face value. Card funding: **2.9%**. Physical prepaid exceptions: US Visa 6-mo **$2.95**/card, 12-mo **$4.95**; GBP Mastercard **£1**; AUD Visa **$2**. FX conversion: **free**. Promotional (expiring) rewards: default **25% of unclaimed value returns to sender**. Unused credits refundable in full. — [Giftbit pricing](https://www.giftbit.com/pricing)

**Deel**
- Contractor management **$49**/contractor/month. Contractor of Record **$325**/month. EOR **$599**/employee/month. US PEO **$125**/employee/month. Month-to-month. Page says “no hidden fees” and “competitive exchange rates” but **does not publish FX markup or per-withdrawal fees**. — [Deel pricing](https://deel.com/pricing)
- A Deel blog (contractor-facing) lists **withdrawal** fees: non-US instant card **2% (min $5, cap $15)**; US **0.75% (min $5, cap $25)**; Wise and Revolut **no Deel withdrawal fee**; PayPal **2.5% (min $0.25)**; Coinbase **1.5%**. These are **recipient-side** withdrawal fees, not the employer platform fee. — [Deel withdrawal options](https://www.deel.com/blog/contractor-payment-withdrawal-options-on-deel/)

**Remote**
- Contractor Management **$29**/contractor/month. Plus **$99** (adds indemnity up to $100k/contractor). Contractor of Record **from $325**. EOR **$699**/employee/month. Global Payroll **$29**/employee/month (implementation fee + recurring “payroll delivery fee” exist, amounts unpublished). US PEO **from $99**. Equity **from $39**. No platform/setup fee on HR/EOR/contractor. FX: “Remote FX rate” shown on invoice; markup **not published as a percent**. No minimum headcount. — [Remote pricing](https://remote.com/pricing)
- Omnivoo (May 2026) reported Remote EOR at $599 annual / $699 monthly. The live page fetched 13 Oct 2026 shows **$699**. Prefer the live page. — [Omnivoo contractor fees 2026](https://omnivoo.com/blog/contractor-payment-platform-fees-compared-2026)

**Rippling**
- No public contractor or EOR list price as of May 2026 (and no contradictory official number found 13 Oct 2026). Quote-based. — [Omnivoo Deel vs Rippling](https://omnivoo.com/blog/deel-vs-rippling-contractor-payments)

**Gusto**
- Live payroll plans (13 Oct 2026): Simple **$49/mo + $6/person**; Plus **$80/mo + $12/person**; Premium **$180/mo + $22/person**. US contractors billed at the per-person rate **only in months they are paid**. Global contractor payments: **no monthly per-contractor fee**; **$5 per payment to US-based bank accounts**; “foreign exchange rates may vary” (markup unpublished). Instant pay add-on **$100 per payroll** (included in Premium). Same-day **$90 per payroll**. — [Gusto pricing](https://gusto.com/product/pricing)
- Omnivoo (May 2026) reported a contractor-only plan at **$35/mo + $6/contractor** with 6 months of $0 base. That SKU is **not on the live page** fetched 13 Oct 2026. Prefer the live page; treat $35+$6 as possibly withdrawn. — [Omnivoo Deel vs Gusto](https://omnivoo.com/blog/deel-vs-gusto-contractor-payments)

**Gigapay**
- Pro: **€279/month + 4.9% per payout**. Unlimited global payouts/vendors, tax/compliance, API, self-serve creator onboarding. Enterprise: custom, for **€1.8M+**/year transferred. Gigapay is Merchant of Record (buyer sees one vendor invoice). — [Gigapay pricing](https://www.gigapay.com/pricing)

**Toku**
- Contractor Management list **$19**/contractor/month. AOR **$149**/contractor/month. EOR **$599**/employee/month. US PEO **$89**/employee/month (min 5 employees). Token-grant admin **$1,200/month** up to 49 stakeholders. Stablecoin payroll **included** in every tier (no crypto add-on). On-chain fees itemized separately; final commercial terms agreed before onboarding. Stablecoin API: contact sales. — [Toku pricing](https://www.toku.com/pricing)

**Rise**
- Rise’s own 2 Oct 2026 blog, citing riseworks.io/pricing: Global Contractor/Direct **from $49**; AOR **$299**/contractor/month; EOR **$399**/employee/month. Separate cost post: stablecoin/crypto payout **$2.50** flat; fiat payout **$10 + 1–2% FX**; US Direct Payroll greater of **$49/month or $19/employee**. — [Rise Pay 2026](https://www.riseworks.io/blog/introducing-rise-pay); [Rise stablecoin vs SWIFT](https://www.riseworks.io/blog/stablecoin-payroll-cost-vs-swift-wire)

**Veem**
- Free plan vs Premium **$24.99 USD / $34.99 CAD**. Domestic ACH/EFT: **free on Premium, else $1** ($1.49 CAD). Check **$1.99**. Same-day bank **0.5%**. Instant bank (minutes) **1%, max $20** (sender or receiver can pay). International in USD: send free, receive **$29** (**$40** if over $10k). International in local currency: send and receive **free** (FX is the revenue). US debit send **1.5% min $3.50** (business **2.5% or $3.50 min**). US credit send **3.5% min $3.50**. — [Veem pricing](https://www.veem.com/pricing/)

**Airwallex (US fee schedule effective 1 Jul 2025)**
- Explore **$0/month**; Grow **$99/month**; Accelerate/Custom: custom. SWIFT SHA **$15**; SWIFT OUR **$25**. Local-transfer price in the snippet is incomplete; a 2026 Slash recap says local transfers have historically been **$0**, with **$1–$7** local-network international fees for Explore starting **12 Oct 2026** (Grow/Accelerate exempt). FX in Airwallex’s own comparison copy: **0.5–1% above interbank**. Do not invent a local-payout cent amount from the incomplete PDF extract. — [Airwallex US Fee Schedule 1 Jun 2025](https://assets.ctfassets.net/e6wv1zvbwa49/1M2ezzUqKA860zTQhrwqEK/3598f108396e3c7a4cb9ca5d8c5be4e5/Clean_US_Fee_Schedule_1_June_2025.pdf); [Slash Airwallex fees](https://www.slash.com/lp/airwallex-fees); [Airwallex vs Nium](https://www.airwallex.com/en-us/blog/comparison-nium-vs-airwallex)

**dLocal Go (self-serve, fees valid as of Sep 2026)**
- LATAM payouts (AR, BO, BR, CL, CO, CR, GT, MX, PY, PE, UY): **local 1.00% + $0.20**; **cross-border 1.50% + $0.20**. Rates exclude local processing taxes. Refund **$1**; chargeback **$5**. Settlement transfers over **$10**: no fee; under $10: **$1**. — [dLocal Go 2026 fee PDF](https://40013370.fs1.hubspotusercontent-na1.net/hubfs/40013370/Pricing/dLocal%20Go_Payins_Multiple_Countries_2024.pdf)
- Enterprise dLocal (the listed company) is **negotiated**, not this Go card.

**Thunes / Nium / Ebanx**
- **No public rate card.** Nium docs describe configurable flat/percent/tiered/FX-margin engines (REMIT_BANK_FEE, SWIFT SHA/BEN/OUR, CARD, CASH, WALLET, etc.) with rates set per client. — [Nium fees](https://docs.nium.com/docs/fees-and-limits/fees)
- Thunes exposes a calculate-fees API; example payload in docs is **not** a public list price. — [Thunes calculate-fees](https://thunes-tilia-docs.redocly.app/openapi/prod/invoicing/openapi/payout/paths/~1v2~1%7Baccount_id%7D~1payout~1calculate-fees/get.md)
- A low-quality aggregator (newskalinova) claims Nium “typically 0.3% to 0.8%” plus FX and subscription. Do not use as a list price.

**Dots (usedots.com / dots.dev)**
- Core **$19/month**: domestic **$2**; international **3.9% + $2**; crypto **3% + $2**; instant **$0**; 1099 **$5** (+$1 mail); IDV **$5**; intl wire **$40**. Push-to-card disabled on Core.
- Scale **$999/month**: domestic **$1**; international **2.9% + $1**; domestic push-to-card **$1 + 0.75% ($1.50 min)**; intl push-to-card **$1 + 2.9%**; crypto **2%**; instant **$0**; 1099 **$3.50**; IDV **$3**; background check **$10**; intl wire **$30**.
- Enterprise: custom. Claims 190+ countries. — [Dots pricing](https://usedots.com/pricing/)

**Routable**
- Official page not fully retrieved. SaaS True Cost (aggregator, “last verified 2026-05-17”) reports Growth **$1,250/month** ($1,000 annualized) and Scale **$2,000/month** ($1,600 annualized), unlimited seats, plus unpublished international-wire add-ons. Treat as aggregator until confirmed on routable.com/pricing. — [SaaS True Cost Routable](https://saastruecost.com/software/routable/pricing/)

**Melio**
- Go: **$0**; **5 free ACH/month**, then **$0.50**. Core: **$25/mo + $10/extra user** (annual $20 + $8); **20 free ACH**. Boost: **$55/mo + $10/extra user**; **50 free ACH**. Unlimited: **$80/mo**, unlimited ACH and users. Platinum: invite-only, **>$300k/month card volume**, custom.
- Payment-method table: ACH **$0.50**; check **$1.50**; fast check **$20**; overnight check **$50**; instant bank **1% ($75 max)**; same-day ACH **1% ($75 max)**; wire **$10**; same-day wire **1% ($10 min, $75 max)**. Card-funded versions add **2.9%**. Global by ACH: USD **$20**; fast USD **1% ($30 min, $95 max)**; local currency “conversion rates apply.” — [Melio pricing](https://melio.com/pricing/)

**Modern Treasury**
- Usage-based; **no public per-payout dollar figures**. Covers ACH, wires, RTP/FedNow, push-to-card, checks, **stablecoins**. On/off-ramp = fiat-rail fee + conversion fee; amounts sales-quoted. Their educational RTP page cites **industry** ranges (ACH $0.20–$1.50, RTP $0.25–$1, wires $25–$50) — those are **not** Modern Treasury’s price. — [Modern Treasury pricing](https://www.moderntreasury.com/pricing); [Modern Treasury multi-rail](https://www.moderntreasury.com/compare/multi-rail-payments)

**Increase**
- Published technology fees (platforms can get custom). Next-day ACH origination **$0.50**; same-day ACH **$2.00**; ACH return **$5**; unauthorized return **$15**; late return **$25**. Wire origination **$15**. Check print/mail **$3** + $1/extra page; check return **$10**. Virtual card **$0.25**. Card dispute **$15**. RTP origination **$2.50**. FedNow origination **$2.50**. Monthly platform fee: “varies by use case,” unpublished. — [Increase fees](https://increase.com/fees)

**Payable**
- No official pricing page found in this pass. **Unknown.**

### Inferences
- For a $50 US payout to an existing PayPal/Venmo user, the cheapest published API is PayPal/Venmo Payouts at **$0.25** (0.5%). Tremendous cash to the same rails is **4% ($2)** — 8× more — because Tremendous is selling “email a claim link, recipient picks the rail” plus catalog economics.
- For a $50 US payout to a bank, Increase next-day ACH at **$0.50** and Melio ACH at **$0.50** (after free-tier) undercut Stripe Global Payouts (**$1.50**) and Trolley ACH (**$1** plus $2,399/year).
- Contractor SaaS (Deel/Remote/Rise at $29–$49/seat) is uneconomic for nano/creator $20–$100 one-offs. Gigapay’s **4.9% + €279** and Tremendous’s **4–6% + $0** are the list prices that actually map to that job.
- Anything labeled “starting at” (Tipalti $99/$249, Stripe XB 0.25%, Wise from 0.23%, dLocal Go 1%) is a floor. Enterprise corridors are negotiated.

### Gaps
- Official Hyperwallet/Enterprise Payouts per-method table (Wingspan numbers unverified against the PDF).
- Official Tango Card, Rybbon/BHN Rewards, Payable, Routable per-payout, Nium, Thunes, Ebanx, Rippling, Tipalti per-method, Wise Platform partner, Airwallex local-payout cents, Modern Treasury contracted rates.
- PayPal currency-conversion **spread percent** on the current merchant-fee PDF (developer docs confirm a spread exists; the exact bps was not extracted).
- Whether Gusto still sells a contractor-only $35+$6 SKU.

## 2. Recipient requirements: onboard, KYC, bank, tax, email-only, unclaimed funds

### Takeaway
Almost every incumbent that can pay an email still forces the recipient onto **that vendor’s account** (or a connected Stripe/Payoneer/Deel account) before money is spendable. The only widely documented “pay just an email, claim later, auto-refund” mass-payout is **PayPal/Venmo Payouts** (30 days) and the rewards platforms (Tremendous/Giftbit claim links). Contractor, AP, and bank-rail products require bank details and usually W-9/W-8 **before** the first payment. Unclaimed-fund treatment is published for PayPal (30-day return), Giftbit (unlimited or 25% breakage share), and Payoneer (state escheatment + fee). Most others: unknown.

### Cited Findings
- **PayPal/Venmo Payouts**: `recipient_type` EMAIL / PHONE / USER_HANDLE / PAYPAL_ID. Unregistered recipients can be paid; they must **create a PayPal or Venmo account to claim**. Unclaimed items auto-return after **30 days**. Venmo payouts US-only. Per-item limits: registered USD **$60,000**, unregistered USD **$20,000**. — [PayPal Payouts fees/limits](https://developer.paypal.com/payouts/fees); [PayPal supported features](https://developer.paypal.com/payouts/supported-features). Sister-note detail (API cancel/unclaimed): [PayPal Payouts API](https://developer.paypal.com/api/payouts); [RECEIVER_UNREGISTERED](https://developer.paypal.com/api/payments.payouts-batch/v1/errors/receiver_unregistered)
- **PayPal Enterprise Payouts**: hosted or embedded **payee portal**; payee chooses bank / PayPal / Venmo / card / wallet / eGift / cash pickup / **PYUSD**. Vendor sells **KYC/KYB, account validation, 1099, AML/sanctions**. Not an email-only fire-and-forget rail. — [PayPal Enterprise Payouts](https://www.paypal.com/us/business/make-payments/enterprise-payouts)
- **Stripe Connect**: recipient is a **connected account**. Full ToS + identity verification. Instant Payouts require full ToS and a local-currency external account. Stablecoin preview: individual/sole prop only; must use Express Dashboard and link a crypto wallet. Cannot pay “just an email” without onboarding a connected account. — [Stripe Instant Payouts](https://docs.stripe.com/connect/instant-payouts); [Stripe stablecoin payouts](https://docs.stripe.com/connect/stablecoin-payouts)
- **Stripe Global Payouts**: pays a **third-party bank/card/wallet**, not a connected account. Docs (not re-fetched this pass) distinguish it from Connect and mention email-address payout as a Global Payouts use case. Confirm recipient KYC on [Stripe Global Payouts recipient requirements](https://docs.stripe.com/global-payouts/recipient-requirements) — page not fetched here.
- **Wise**: consumer “pay by email” requires the recipient to **create a Wise account** with that email, then claim to Wise or a bank; expiry 7 or 10 days (help articles conflict), then refund. Not a business mass-payout API. — [Wise pay-by-email](https://wise.com/help/articles/2932105/how-can-i-send-money-to-an-email-address)
- **Payoneer Mass Payout**: “Register your payees first — **only registered payees** can receive payouts.” Deposit-in-advance. — [Payoneer mass submit](https://www.payoneer.com/developers-docs/mass-payout/mass-submit-payout/)
- **Payoneer consumer account**: unused funds can be **escheated to a US state**, with a processing fee “in the amount permitted by that state.” — [Payoneer pricing](https://www.payoneer.com/about/pricing/)
- **Trolley**: white-label **recipient self-onboarding** widget (bank, PayPal, Venmo, check, debit, wallet) plus tax forms. IDV is a paid Trust module. Payment does not go out until the recipient has completed the chosen method. — [Trolley pricing](https://trolley.com/trolley-pricing/)
- **Tremendous**: rewards **delivered via email or SMS**. Recipient picks from options the sender enabled. Automated **W-9 collection and 1099 prep** included at $0. Gift-card path does not require a Tremendous account in the same way a bank path does (recipient still visits a claim page). — [Tremendous pricing](https://www.tremendous.com/pricing/)
- **Giftbit**: email reward link. Standard rewards **never expire**. Promotional rewards expire on a sender-set date; **25% of unclaimed value** returns to the sender (Giftbit keeps the rest as breakage). — [Giftbit pricing](https://www.giftbit.com/pricing)
- **Deel / Remote / Rippling / Gusto / Toku / Rise**: contractor must be **onboarded** (contract, tax form, payout method) before payroll runs. Deel blog: 10+ withdrawal methods after funds sit in a Deel balance. Rise: “self-serve KYC.” Toku: “AML/KYC-aligned payout flows.” These are workforce products, not claim-links. — [Deel pricing](https://deel.com/pricing); [Deel withdrawals](https://www.deel.com/blog/contractor-payment-withdrawal-options-on-deel/); [Remote pricing](https://remote.com/pricing); [Toku pricing](https://www.toku.com/pricing); [Rise Pay](https://www.riseworks.io/blog/introducing-rise-pay)
- **Gigapay**: “self-service creator onboarding”; Gigapay is MoR so the **brand** does not collect each creator’s tax identity — Gigapay does. Creator still onboards to Gigapay. — [Gigapay pricing](https://www.gigapay.com/pricing)
- **Dots**: customer testimonial: “onboard users **after** their first payment” (Collabstr). Product includes IDV and 1099. Methods: ACH, wire, PayPal, Venmo, local currency, gift cards, RTP. — [Dots pricing](https://usedots.com/pricing/)
- **Melio**: vendor/contractor is a payee with bank/check/card details. Core+ includes **W-9 collection, TIN validation, 1099**. Not email-only. — [Melio pricing](https://melio.com/pricing/)
- **Increase / Modern Treasury**: bank-rail infrastructure. Recipient is an **account number / RTP address / wallet**, not an email. Named pay-ins/payouts require a verified name. — [Increase fees](https://increase.com/fees); [Modern Treasury pricing](https://www.moderntreasury.com/pricing)

### Inferences
- “Pay an email before the recipient exists” as a **business API** is productized by PayPal Payouts, Tremendous, Giftbit/Tango-class rewards, and (partially) Dots. Everyone else wants a payee record first.
- Tax is the forcing function. W-9/W-8/1099 is built into Trolley, Tremendous, Tipalti, Dots, Melio, Stripe Connect, Deel, Gusto. A Loofta “claim to Venmo” flow that skips US tax collection will look incomplete to any US platform buyer above hobby volume.
- Unclaimed-funds policy is a product decision incumbents have already made: refund (PayPal 30d), keep-and-share-breakage (Giftbit 25%), or escheat (Payoneer). Loofta needs an explicit rule; silence is a legal gap, not a feature.

### Gaps
- Stripe Global Payouts email-recipient KYC (docs URL known, page not fetched).
- Tremendous unclaimed / expiry / refund (not on the pricing page).
- Tango/Rybbon official unclaimed policy.
- Tipalti payee-portal: whether a payment can be issued to an email before the payee finishes onboarding.
- Hyperwallet payee expiry / unclaimed / escheat.
- Whether Dots can complete a payout to PayPal/Venmo without the recipient creating a Dots account.
- Nigeria/Pakistan/Ghana KYC specifics (BVN/NIN etc.) for any of these vendors.

## 3. Country coverage and notable gaps

### Takeaway
Headline “190–200+ countries” is common (Payoneer, Tipalti, Trolley, Dots, Enterprise Payouts, Airwallex, Nium) and mostly means **some rail exists**, not local NGN/PKR/GHS. **PayPal Payouts’ own country table omits Nigeria, Ghana, and Pakistan entirely.** India is receive-and-withdraw only (Indian merchants cannot send Payouts). Argentina/Brazil have conversion locks. The corridors Loofta cares about (NG, PK, GH, plus PH/VN/BR/AR) are either missing, FX-restricted, or only reachable via Thunes/dLocal/Payoneer-class local rails — not via PayPal/Venmo/Zelle.

### Cited Findings
- **PayPal Payouts eligible-country table** (updated 10 Sep 2026): includes AR, BR, IN (receive/withdraw only), MX (receive/withdraw only), PH (local currency), VN, KE, ZA, SN, and most of Europe/APAC. **Nigeria, Ghana, and Pakistan are not listed.** India: merchants **cannot send** payouts from India. Currency conversion **excluded** for China, India, Korea, Taiwan, Thailand, Turkey, the Caribbean, and almost all of Latin America including **Argentina, Brazil (special), Chile, Colombia, Peru**. Enterprise Payouts separately: cannot convert **ARS, BRL, MYR**. Venmo: **US recipients only**. — [PayPal supported features](https://developer.paypal.com/payouts/supported-features); [PayPal Enterprise Payouts](https://www.paypal.com/us/business/make-payments/enterprise-payouts)
- **Stripe Connect cross-border (self-serve)**: platform and connected account in **US, UK, EEA, CA, CH** only. Outside that set: contact sales or use **Global Payouts**. Global Payouts: “50+ countries.” Instant Payouts country list: AU, CA, DK, EU, HK, MY, NZ, NO, SG, SE, AE, UK, US — **no NG/PK/GH/IN/BR/AR/PH/VN**. — [Stripe cross-border payouts](https://docs.stripe.com/connect/cross-border-payouts); [Stripe Instant Payouts](https://docs.stripe.com/connect/instant-payouts); [Stripe pricing](https://stripe.com/pricing)
- **Payoneer**: 190+ countries/territories, 70+ payout currencies, 30+ collect currencies. Same-country $1.50 withdraw list includes PH, VN, MX, KE, but **not Nigeria/Ghana/Pakistan** in that particular list (those corridors may still exist at the 1.2–4% cross-border rate — not confirmed). — [Payoneer pricing](https://www.payoneer.com/about/pricing/); [Payoneer mass payouts](https://www.payoneer.com/mass-payouts/)
- **Tipalti**: “200+ countries and territories,” local rails, tax-ID validation in **62 countries**. Per-country matrix not on the pricing page. — [Tipalti pricing](https://tipalti.com/pricing/)
- **Deel**: 150+ countries, payments in 120+ currencies, EOR in 130+ countries. **40,000+** customers. — [Deel pricing](https://deel.com/pricing)
- **Remote**: EOR in **90+** countries (narrower than Deel’s 130+). — [Remote pricing](https://remote.com/pricing)
- **Gusto global contractors**: “more than **120 countries**.” Domestic product is US payroll. — [Gusto pricing](https://gusto.com/product/pricing)
- **Toku**: contractor/EOR/AOR “**100+ countries**.” — [Toku pricing](https://www.toku.com/pricing)
- **Dots**: “**190+ countries**, 300+ payout rails.” — [Dots pricing](https://usedots.com/pricing/)
- **dLocal Go**: published payout card is **LATAM-only** (AR, BO, BR, CL, CO, CR, GT, MX, PY, PE, UY). Enterprise dLocal is broader (Africa/Asia exist in the listed company) but Go’s public card does not include NG/PK/GH/IN/PH/VN. — [dLocal Go fees](https://40013370.fs1.hubspotusercontent-na1.net/hubfs/40013370/Pricing/dLocal%20Go_Payins_Multiple_Countries_2024.pdf)
- **Airwallex**: payouts to **200+ countries**, local rails in **120+**; 2025–26 launches include CA, MX, BR, FR, VN, ID, KR. Africa/mobile-money depth is the weak side vs Thunes in Airwallex’s own competitive copy. — [Airwallex vs Nium](https://www.airwallex.com/en-us/blog/comparison-nium-vs-airwallex); [Airwallex careers/funding](https://careers.airwallex.com/blog/airwallex-funding-2025/)
- **Nium**: 190+ countries, real-time in 100+ (Airwallex comparison). A March 2026 aggregator says Nium is **pursuing** licenses in Saudi Arabia, Brazil, and **Nigeria** — i.e. Nigeria is not yet a completed license story in that article. — [Airwallex vs Nium](https://www.airwallex.com/en-us/blog/comparison-nium-vs-airwallex); [newskalinova Nium raise](https://newskalinova.com/singapore-fintech-nium-raises-350-million/) (aggregator; treat license-roadmap as unverified)
- **Thunes**: competitor reviews (including Airwallex’s own) position Thunes as strongest for **Sub-Saharan Africa mobile money (M-Pesa, MTN)** including NG/KE/GH. No official public country PDF fetched. — [Airwallex Thunes review](https://www.airwallex.com/en-us/blog/thunes-review); [FintechSpecs Nium vs Thunes](https://fintechspecs.com/blog/nium-vs-thunes-global-payout-infrastructure/)
- **Melio / Increase / Modern Treasury / Veem**: US-centric AP/banking. Melio has a global-payments SKU (USD $20 / local FX). Increase is **US rails** (ACH, RTP, FedNow, US wire). — [Melio pricing](https://melio.com/pricing/); [Increase fees](https://increase.com/fees)
- **Gigapay**: creator testimonials are EU-heavy (NO, FI, DE, PL, SE, BG). Country list not on the pricing page. — [Gigapay pricing](https://www.gigapay.com/pricing)

### Inferences
- PayPal is a **wallet network**, not a last-mile bank network in West Africa. If Loofta’s recipient is in Nigeria, PayPal/Venmo/Zelle/Cash App do not solve the last mile; Payoneer, Thunes, dLocal-class, or a local bank/stablecoin off-ramp does.
- “200 countries” on Tipalti/Trolley/Dots/Enterprise Payouts is a sales claim that usually routes through SWIFT or a local partner. The **published** local-rail cards that actually name NG/PK/GH are thin. That is the wedge for a claim-to-local-bank or claim-to-USDC product.

### Gaps
- Official PayPal/Hyperwallet, Tipalti, Trolley, Tremendous, Payoneer, Nium, Thunes, Ebanx country×method matrices for **NG, PK, GH, IN, BR, AR, PH, VN**.
- Whether Tremendous international bank includes NGN (sister research found no NGN in the Tremendous fee table).
- Ebanx payout vs pay-in coverage (Ebanx is historically a LATAM **pay-in** specialist; payout list not fetched).
- Wise Platform corridor list vs Wise Business consumer corridors (GHS excluded on consumer email-pay).

## 4. Speed of settlement

### Takeaway
Wallet credits (PayPal, Venmo, Tremendous PayPal/Venmo, PYUSD, Connect Instant, Rise/Toku stablecoin) are **minutes**. Domestic ACH is **T+1–T+2** (Increase next-day $0.50; Melio same-day 1%). RTP/FedNow/Instant SEPA are the published “real-time bank” options and cost more (Increase RTP $2.50; Stripe Instant 1%; Melio instant bank 1% cap $75). Cross-border local rails claim hours-to-same-day (Airwallex: 93–95% within hours). SWIFT remains days plus correspondent fees.

### Cited Findings
- PayPal Payouts: “Recipients get payments **instantly**” to PayPal/Venmo; unclaimed returns in **30 days**. — [PayPal Payouts fees](https://developer.paypal.com/payouts/fees)
- Enterprise Payouts: near-instant to eligible PayPal/Venmo/PYUSD; US **RTP**, Instant SEPA, OCT debit, same-day in select markets. Availability varies. — [PayPal Enterprise Payouts](https://www.paypal.com/us/business/make-payments/enterprise-payouts)
- Stripe Instant Payouts: “typically within **30 minutes**.” — [Stripe Instant Payouts](https://docs.stripe.com/connect/instant-payouts)
- Stripe standard merchant payouts: rolling / weekly / monthly, **free**. — [Stripe pricing](https://stripe.com/pricing)
- Veem: instant bank **minutes** at 1%; same-day 0.5%; standard ACH days (implied). — [Veem pricing](https://www.veem.com/pricing/)
- Melio: instant bank and same-day ACH at 1% ($75 cap); same-day ACH if scheduled before **2 p.m. ET**; same-day wire before **6 p.m. ET**. Standard ACH is the $0.50 rail. — [Melio pricing](https://melio.com/pricing/)
- Increase: next-day ACH, same-day ACH, RTP, FedNow, wires as separate priced rails. — [Increase fees](https://increase.com/fees)
- Airwallex: own blog claims **94% of transactions outside SWIFT**, **93% arrive within hours or the same day**. — [Airwallex Thunes review](https://www.airwallex.com/en-us/blog/thunes-review)
- Wise FY25 (prior-year, still the last speed stat in sister notes): 65% of transfers instant. FY26 20-F extract fetched here does **not** restated that percentage. — [Wise 20-F FY2026](https://www.publicnow.com/view/72DEEDED9C818A4CD025797601E935072B199F74?1782424094=)
- Deel: method-dependent (Wise local, SWIFT “unpredictable intermediary fees,” instant card, Coinbase, BVNK USDC/USDT). No single SLA on the pricing page. — [Deel withdrawals](https://www.deel.com/blog/contractor-payment-withdrawal-options-on-deel/)
- dLocal Go: settlement-period footnote in the PDF was not fully extracted; payouts are “paid transaction” fees, not a published T+n.

### Inferences
- “Instant” in this market means **wallet or RTP**, and it is sold as a **premium SKU** (1% Stripe/Veem/Melio, $1.50 Trolley Venmo, $2.50 Increase RTP). Loofta USDC-on-Solana is structurally in the instant bucket without that 1% rail fee — the cost is the off-ramp the recipient chooses later.
- Cross-border “local rail, same day” is Airwallex/Nium/Thunes/dLocal’s pitch against SWIFT. It still requires a **known bank account or wallet** at send time.

### Gaps
- Official T+n tables for Payoneer, Tipalti, Trolley, Tremendous bank, Nium, Thunes, Ebanx, Gigapay, Toku fiat.
- Wise FY26 instant-transfer percentage (not in the 20-F excerpt pulled).
- dLocal Go payout settlement time.

## 5. Who they sell to, and minimum volume

### Takeaway
Three go-to-markets: **self-serve SMB** (Tremendous $0, Giftbit $0, Melio $0, Veem $0/$25, Gusto $49, Dots $19, Wise $31 setup); **sales-led mid-market** (Tipalti $99–$249+, Trolley $2.4k/year, Gigapay €279, Routable ~$1–2k/mo, Deel/Remote/Rise per-seat); **enterprise/API infrastructure** (PayPal Enterprise, Stripe Connect platforms, Payoneer >$50k/mo custom, Nium/Thunes/Modern Treasury/Increase custom, dLocal enterprise). Several vendors publish an explicit volume conversation: Tremendous $200k/year, Payoneer $50k/month, Gigapay €1.8M/year, Melio Platinum $300k/month cards.

### Cited Findings
- PayPal Payouts: merchants/platforms with a PayPal business account; API vs web. Enterprise Payouts: “large enterprises and marketplaces,” CSV or REST, dedicated onboarding. — [PayPal Enterprise Payouts](https://www.paypal.com/us/business/make-payments/enterprise-payouts)
- Stripe Connect: platforms and marketplaces. Global Payouts: businesses sending to third parties. — [Stripe Connect pricing](https://stripe.com/connect/pricing)
- Wise Business: SMB self-serve. Wise Platform: banks and embedded partners (Nubank, Monzo, etc. in sister notes). — [Wise Business pricing](https://wise.com/us/pricing/business); [Wise investor topics](https://owners.wise.com/investor-topics)
- Payoneer: SMB + marketplace payouts; “processing over **50k USD monthly**? Get in touch.” Mass payouts positioned at enterprises/marketplaces. — [Payoneer pricing](https://www.payoneer.com/about/pricing/)
- Tipalti: finance teams, AP automation, “creators, artists, sellers, clinical-trial participants.” — [Tipalti pricing](https://tipalti.com/pricing/)
- Trolley: creator/marketplace payouts; self-serve trial then subscription. — [Trolley pricing](https://trolley.com/trolley-pricing/)
- Tremendous / Giftbit: marketing, research incentives, rewards; self-serve in minutes. Tremendous enterprise AM at $0 extra. — [Tremendous pricing](https://www.tremendous.com/pricing/); [Giftbit pricing](https://www.giftbit.com/pricing)
- Deel: startups to enterprise, **40,000+** customers. Remote: same category, no minimum headcount. Gusto: US SMB, **500,000+** businesses. — [Deel pricing](https://deel.com/pricing); [Remote pricing](https://remote.com/pricing); [Gusto pricing](https://gusto.com/product/pricing)
- Gigapay: influencer/creator finance teams; Enterprise at **€1.8M+**/year. — [Gigapay pricing](https://www.gigapay.com/pricing)
- Toku / Rise: crypto-native and global payroll; Toku AOR for “ambassador, creator, contributor, or validator programs.” — [Toku pricing](https://www.toku.com/pricing); [Rise Pay](https://www.riseworks.io/blog/introducing-rise-pay)
- Dots: platforms (creators, gig, marketplaces); Core $19 is SMB-API. — [Dots pricing](https://usedots.com/pricing/)
- Melio: US SMB AP/AR; Platinum **>$300k/month card**. — [Melio pricing](https://melio.com/pricing/)
- Increase: “financial technology platform moving funds for your customers, or large corporate balances.” — [Increase fees](https://increase.com/fees)
- Modern Treasury: platforms; annual terms, usage toward a minimum commitment. — [Modern Treasury pricing](https://www.moderntreasury.com/pricing)
- Airwallex: 200,000+ businesses (self-reported). — [Airwallex funding post](https://careers.airwallex.com/blog/airwallex-funding-2025/)

### Inferences
- Loofta’s “pay 1,000 emails before they have accounts” is a **Tremendous / PayPal Payouts / Dots** buyer, not a Deel/Remote/Gusto buyer. Those HRIS products will not discount a $20 claim-link.
- Sales-led enterprise (Tipalti, Hyperwallet, Nium, Thunes) will not quote a startup at list. The public “starting at” is a lead magnet.

### Gaps
- Official minimums for PayPal Enterprise, Tipalti, Nium, Thunes, Ebanx, Modern Treasury, Increase custom.
- Rippling contractor packaging (HRIS bundle vs standalone).
- Payable ICP.

## 6. Revenue, GMV, valuations, customer counts

### Takeaway
The public companies that actually disclose payout-adjacent volume are huge: PayPal **$1.79T TPV / $33.2B revenue / 439M active accounts** (FY2025); Wise **$243.5B cross-border / $2.50B net revenue / 18.9M actives** (FY26); Payoneer **$87.5B volume / $1.05B revenue** (FY2025); dLocal **$40.8B TPV** (FY2025), of which the earnings release attributes a large payout share. Private: Airwallex **$11B valuation, $1B+ ARR, $287B payments** (self-reported 2026). Contractor SaaS: Deel **40k customers, $20B+ payroll, 1.5M workers** (Stripe/Deel June 2026). Most others: unknown or aggregator-only.

### Cited Findings
- **PayPal FY2025 10-K**: revenue **$33.2B**; net income **$5.2B**; TPV **$1.79T** (+7% YoY); **25.4B** transactions (−4%); **439M** active accounts (+1%). Revenue includes currency conversion, instant transfers, crypto buy/sell. Payouts are listed as a value-added service; **Payouts GMV is not broken out**. Hyperwallet payees sit inside “platform access partner” active accounts. — [PayPal 10-K FY2025](https://www.sec.gov/Archives/edgar/data/1633917/000163391726000024/pypl-20251231.htm)
- **Payoneer FY2025 10-K**: volume **$87.5B** (from $80.1B); revenue **$1,052.8M** (from $977.7M); +9% volume, +8% revenue. Competes with PayPal, Airwallex, Wise, Adyen/Braintree/Stripe, Bill.com, “mass payout service providers,” and global payroll/EOR. — [Payoneer 10-K FY2025](https://www.sec.gov/Archives/edgar/data/1845815/000110465926020487/payo-20251231x10k.htm)
- **Wise 20-F FY2026** (year to 31 Mar 2026): net revenue **$2,502.8M** (+19%); net income **$498.7M**; cross-border volume **$243.5B** (from $185.2B, +31%); active customers **18.9M** (from 15.6M); cross-border take rate **0.52%** (from 0.58%); IBT margin FY26 **26.4%**. — [Wise 20-F FY2026](https://www.publicnow.com/view/72DEEDED9C818A4CD025797601E935072B199F74?1782424094=)
- **dLocal FY2025 earnings**: TPV **$40.8B**; 2026 TPV guidance **+50–60%**. Search synthesis of the same exhibit: pay-ins **$28.2B**, payouts **$12.6B**. Confirm the pay-in/payout split from the exhibit before treating $12.6B as gospel — the file pulled was dense. Gross profit **$403M**; operating profit **$220M**. — [dLocal 4Q25 earnings](https://www.sec.gov/Archives/edgar/data/1846832/000207097926000110/a992dlocal_4q25xearnings.htm)
- **Deel**: pricing page **40,000+ customers**, **$20B+** “compliantly processed global payroll,” 150+ countries. Stripe newsroom 3 Jun 2026: **>40,000 businesses and 1.5 million workers**. — [Deel pricing](https://deel.com/pricing); [Stripe–Deel newsroom](https://stripe.com/en-gi/newsroom/news/deel-and-stripe)
- **Gusto**: “Trusted by more than **500,000** businesses.” — [Gusto pricing](https://gusto.com/product/pricing)
- **Airwallex** (company careers blog, 2026 update): valuation **$11B**; **$1.8B** total raised; **$1B+** annualized revenue (+80% YoY); **$1B** AUM; **200,000+** businesses; **$287B** global payments; 2,300+ staff; 85+ licenses. Self-reported. — [Airwallex funding 2026](https://careers.airwallex.com/blog/airwallex-funding-2025/)
- **Thunes**: Airwallex review says Apr 2025 Series D **$150M**, total funding **$362M**, “industry trackers” put it past **$1B** valuation. — [Airwallex Thunes review](https://www.airwallex.com/en-us/blog/thunes-review)
- **Nium**: March 2026 aggregator article (newskalinova) claims **$350M** pre-IPO at **$3B**, ~**$25B** annual volume, ~**$280M** 2025 revenue, 300+ enterprise clients. **Not a primary filing.** Use only with that caveat.
- **Rise**: Circle case study (sister research) $800M+ payroll, 60% USDC — not re-verified in this pass. Rise’s own 2026 blogs do not restate a GMV on the pages fetched here.
- Tremendous, Trolley, Tipalti, Giftbit, Tango, Dots, Gigapay, Toku, Veem, Melio, Routable, Modern Treasury, Increase, Ebanx, Payable: **no primary 2025–26 revenue/GMV found** in this pass.

### Inferences
- PayPal’s 439M accounts are the distribution moat that makes $0.25 API payouts viable. Loofta does not have that graph; Tremendous’s 4% is the price of **not** owning the wallet graph.
- Payoneer’s $87.5B and dLocal’s ~$12B payout TPV show that **marketplace/emerging-market disbursement** is a real, disclosed P&L line, not a feature checkbox.
- Private infrastructure (Nium/Thunes/Airwallex) is funded at multi-billion valuations **without** publishing a rate card. Price discovery for Loofta vs these names will be corridor-by-corridor, not list-vs-list.

### Gaps
- PayPal Payouts / Hyperwallet volume (not broken out in the 10-K).
- Tipalti, Tremendous, Trolley, Melio, Modern Treasury, Increase, Ebanx, Rippling, Remote revenue.
- Primary-source Nium/Thunes/Ebanx financials.
- Stripe Connect payout volume (Stripe is private; no 10-K).

## 7. Which have added stablecoin rails, and how

### Takeaway
Stablecoins are being bolted onto **existing fiat payout stacks**, almost always with the platform remaining in fiat. Stripe (Bridge) is the default plumbing: Connect stablecoin payouts are **US-platform private preview**; Deel launched a **Bridge/Privy DLUSD** wallet (Argentina first, June 2026); Payoneer announced **Bridge-powered** receive/hold/send for **Q2 2026** select markets; Airwallex has **early-access API** stablecoin wallet payouts; PayPal Enterprise already pays **PYUSD**; Toku and Rise sell **stablecoin payroll as a default SKU**; Modern Treasury lists stablecoins as a rail. Tipalti: **no official stablecoin payout page found**. Tremendous/Tango/Giftbit/Melio/Gusto/Veem/Increase: **no stablecoin rail found**.

### Cited Findings
- **Stripe Connect stablecoin payouts**: private preview, **US platforms only**. Platform balance stays **fiat**; Stripe converts and pays **USDC** to a wallet the connected account links in Express Dashboard. Individuals/sole props only; companies/nonprofits not yet. Transfers API required. Access via sales + questionnaire. — [Stripe Connect stablecoin payouts](https://docs.stripe.com/connect/stablecoin-payouts)
- **Stripe Treasury stablecoins**: businesses in **101 countries** can hold a dollar stablecoin balance, send/receive USD ACH/wire and EUR SEPA, and move stablecoins on **eight** chains. Powered by **Bridge** (acquired earlier in 2025). Starting with USDC; USDB/Bridge issuance next. — [Stripe Treasury stablecoins](https://stripe.com/blog/introducing-stablecoins-for-treasury)
- **Deel × Stripe (3 Jun 2026)**: Deel wallet holds **DLUSD** (custom stablecoin via Bridge Open Issuance) in an embedded **Privy** wallet. Stripe takes employer pay-in; Bridge converts USD→DLUSD. Live in **Argentina**, then rest of LATAM, then APAC/MENA/Africa. Deel Card spends the balance. 1.5M workers / 40k businesses. — [Stripe–Deel newsroom](https://stripe.com/en-gi/newsroom/news/deel-and-stripe)
- **Payoneer × Bridge (17 Feb 2026)**: receive, hold, and send stablecoins inside Payoneer. Launch **select markets Q2 2026**, broader through 2026. Example flows: receive customer stablecoin; pay suppliers/contractors in stablecoin; withdraw to local bank. — [Payoneer IR](https://investor.payoneer.com/news-releases/news-release-details/payoneer-launch-stablecoin-capabilities-powered-bridge-bringing)
- **PayPal PYUSD on Enterprise Payouts**: payee option, 1:1 USD, Paxos issuance/custody, 24/7, near-instant, “no need to own PYUSD” (PayPal converts). Aimed at limited-banking / unstable-currency payees. YouTube US creator PYUSD opt-in (Dec 2025) rides this rail (sister research). — [PayPal Enterprise Payouts](https://www.paypal.com/us/business/make-payments/enterprise-payouts)
- **Airwallex**: “Transfers via Stablecoin” **early access**, **API only**, not in the web app. Account manager must enable beneficiary, transfer type, **payout fee**, and routing. `transfer_method = LOCAL` routes through Airwallex’s stablecoin infrastructure. Fee **not published**. — [Airwallex stablecoin transfers](https://www.airwallex.com/docs/payouts/transfers/transfers-via-stablecoin)
- **Toku**: stablecoin payroll, token rails, and stablecoin invoice payments **included in every pricing tier**. Separate Stablecoin API / Integration SKUs are sales-quoted. — [Toku pricing](https://www.toku.com/pricing)
- **Rise**: hybrid fiat/crypto payroll; USDC as default on Stablecoin Payroll; **$2.50**/crypto payout vs **$10 + 1–2% FX** fiat. Employer can fund USD or stablecoins. — [Rise Pay](https://www.riseworks.io/blog/introducing-rise-pay); [Rise vs SWIFT](https://www.riseworks.io/blog/stablecoin-payroll-cost-vs-swift-wire)
- **Dots**: crypto payouts on the rate card (**3%+$2** Core, **2%** Scale). Coin and chain not specified on the pricing page. — [Dots pricing](https://usedots.com/pricing/)
- **Modern Treasury**: stablecoins listed alongside ACH/RTP/wire as a first-class rail; conversion fee unpublished. — [Modern Treasury pricing](https://www.moderntreasury.com/pricing)
- **Thunes**: Airwallex’s 2026 review says Thunes launched **Pay-to-Stablecoin-Wallets with Circle**. Primary page not fetched. — [Airwallex Thunes review](https://www.airwallex.com/en-us/blog/thunes-review)
- **Tipalti**: no stablecoin mention on the official pricing page fetched 13 Oct 2026. — [Tipalti pricing](https://tipalti.com/pricing/)
- **Tremendous / Giftbit / Tango / Melio / Gusto / Veem / Increase / Gigapay / Remote / Rippling**: no official stablecoin payout fee or product page found in this pass.

### Inferences
- The winning 2026 pattern is **“employer stays in fiat, recipient optionally gets a dollar token.”** Stripe says this in so many words. That is the opposite of asking a US recipient to open a Solana wallet — and the same as Loofta’s “claim to Venmo **or** USDC” if the USDC path is optional.
- Bridge/Stripe is becoming the **default OEM** (Deel, Payoneer, Treasury, Connect). A Loofta integration story that is “we are Bridge” is crowded; “we are the claim layer in front of many rails” is not.
- Crypto-native payroll (Toku, Rise) already prices stablecoin **cheaper than fiat**. Fiat-native payouts (Tremendous 4%, PayPal $0.25) have not.

### Gaps
- Tipalti stablecoin (rumor vs product): no official page found.
- Payoneer Q2 2026 live-market list and fees.
- Airwallex stablecoin fee.
- Whether PayPal Payouts API (not Enterprise) can send PYUSD.
- Dots crypto: which assets/chains.
- Nium/Ebanx/Wise Platform official stablecoin products (not found).

## 8. What each cannot do (capability holes vs Loofta)

### Takeaway
No incumbent matches Loofta’s bundle: **pay an identifier before an account exists, let the recipient choose USDC or a consumer cash app or a local EM bank, without forcing them onto the sender’s network.** PayPal can do email-then-claim but only into **PayPal/Venmo**, and not to NG/PK/GH. Tremendous can do email-then-claim to Venmo/Cash App/PayPal/bank at **4–6%**, with **no USDC** and weak EM banks. Stripe can do USDC but only after **Connect onboarding**, US-platform preview. Deel/Rise/Toku can do USDC but only after **contractor onboarding** at $19–$49/seat. Bank APIs (Increase, Modern Treasury) need an account number up front.

### Cited Findings (cannot-do, sourced)

| Player | Cannot do (sourced limit) | Source |
|---|---|---|
| PayPal/Venmo Payouts | Cannot pay Nigeria/Ghana/Pakistan (not on country list). Cannot pay Venmo outside US. Cannot pay Cash App, Zelle, Revolut, or self-custody USDC. Recipient must join PayPal/Venmo. India senders cannot initiate. | [supported features](https://developer.paypal.com/payouts/supported-features) |
| PayPal Enterprise / Hyperwallet | No public price. Payee must use hosted/embedded portal + KYC. ARS/BRL/MYR conversion locked. Sales-gated. | [Enterprise Payouts](https://www.paypal.com/us/business/make-payments/enterprise-payouts) |
| Stripe Connect | Cannot pay a bare email. Self-serve XB limited to US/UK/EEA/CA/CH. Instant list excludes NG/IN/BR/AR/PH/VN. Stablecoin = US-platform preview, individuals only. | [cross-border](https://docs.stripe.com/connect/cross-border-payouts); [stablecoin](https://docs.stripe.com/connect/stablecoin-payouts) |
| Stripe Global Payouts | 50+ countries, not 190. Needs a recipient instrument. List price $1.50 + bps. | [Stripe pricing](https://stripe.com/pricing) |
| Wise Business/Platform | Email-pay is consumer, requires Wise account, 7–10 day expiry. Platform fees unpublished. Not a creator-rewards claim UX. | [Wise email](https://wise.com/help/articles/2932105/how-can-i-send-money-to-an-email-address) |
| Payoneer | Payees must be **registered before** payout. No email-then-claim. Consumer-grade 1.2–4% withdraw. | [mass submit](https://www.payoneer.com/developers-docs/mass-payout/mass-submit-payout/) |
| Tipalti | No self-serve rate card. Not a pay-an-email product on the marketing page. No official stablecoin. | [Tipalti pricing](https://tipalti.com/pricing/) |
| Trolley | Recipient must finish widget onboarding. $2.4k/year floor. 2% FX. No USDC on the fee table. | [Trolley pricing](https://trolley.com/trolley-pricing/) |
| Tremendous | No USDC/crypto on pricing page. Cash is 4–6%. Not a contractor-compliance system. | [Tremendous pricing](https://www.tremendous.com/pricing/) |
| Giftbit / Tango | Gift-card first. Official Tango cash fees unknown. Not bank/Venmo/USDC as a primary rail (Giftbit exceptions are prepaid cards). | [Giftbit pricing](https://www.giftbit.com/pricing) |
| Deel / Remote / Rippling / Gusto | Per-seat. Recipient is a contractor on the roster. Cannot fire 1,000 claim emails. Gusto instant is $100/payroll. Rippling price unknown. | [Deel](https://deel.com/pricing); [Remote](https://remote.com/pricing); [Gusto](https://gusto.com/product/pricing) |
| Gigapay | 4.9% + €279. MoR model (brand does not pay the person directly). EU-weighted. No USDC on page. | [Gigapay pricing](https://www.gigapay.com/pricing) |
| Toku / Rise | Need a worker record + KYC. Seat fees. Crypto-native ICP, not SMB rewards. | [Toku](https://www.toku.com/pricing); [Rise](https://www.riseworks.io/blog/introducing-rise-pay) |
| Veem | Payee is a vendor with bank details. Instant is 1%. Not email-claim. | [Veem](https://www.veem.com/pricing/) |
| Airwallex | Beneficiary required. Stablecoin = early-access API, fee unknown. Weaker SSA mobile money vs Thunes (their own comparison). | [Airwallex stablecoin](https://www.airwallex.com/docs/payouts/transfers/transfers-via-stablecoin) |
| dLocal | Go card is LATAM payouts only. Needs a local instrument. 1–1.5% + $0.20. | [dLocal Go](https://40013370.fs1.hubspotusercontent-na1.net/hubfs/40013370/Pricing/dLocal%20Go_Payins_Multiple_Countries_2024.pdf) |
| Thunes / Nium / Ebanx | Quote-only. Beneficiary required. Not a consumer claim UX. | [Nium fees](https://docs.nium.com/docs/fees-and-limits/fees) |
| Dots | Closest API peer. Still a Dots recipient object; Core international is **3.9%+$2**. Crypto 2–3%. Scale starts at **$999/mo**. | [Dots](https://usedots.com/pricing/) |
| Melio | US AP. Global is $20 or 1%+. Not email-claim, not USDC. | [Melio](https://melio.com/pricing/) |
| Modern Treasury / Increase | Need account numbers. US-rail (Increase). Sales/custom. Not a recipient UX. | [Increase](https://increase.com/fees); [MT](https://www.moderntreasury.com/pricing) |
| Routable / Payable | Routable is AP automation (aggregator price ~$1–2k/mo). Payable official surface not found. | [SaaS True Cost](https://saastruecost.com/software/routable/pricing/) |

### Inferences
- The empty cell Loofta actually occupies is **small-dollar, pre-account, multi-rail claim** (US consumer apps **and** EM bank/USDC) at a fee **below Tremendous’s 4%** and **without Deel’s seat tax**. PayPal owns the cheap email-claim path but only into PayPal/Venmo and not into NG/PK/GH. Dots is the nearest API competitor and is expensive on international (3.9%+$2) unless the buyer is on $999 Scale.
- “Cannot do Zelle / Cash App / Revolut as a claim destination” is true of almost the entire table. Tremendous lists Cash App (at 4–6%). Nobody else on this list publishes Cash App or Zelle as a **business payout** destination. That is a real product gap — and also a compliance/risk gap those vendors chose not to open.

### Gaps
- Confirmation that Tremendous Cash App/Venmo/PayPal are live in 2026 (pricing page says yes; help article on monetary-option fees not re-fetched).
- Whether any Hyperwallet program can pay Cash App or Zelle (not on the Enterprise marketing list; list is bank, PayPal, Venmo, cards, wallets, eGift, cash pickup, PYUSD).
- Payable product status (alive / acquired / shut down) — not established.
- Rybbon vs BHN Rewards current brand and whether it still sells cash payouts.
