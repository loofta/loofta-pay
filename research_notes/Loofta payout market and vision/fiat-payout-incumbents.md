# Fiat mass-payout and contractor/creator payout incumbents (2025–2026)

Fetched 13 October 2026. All prices below are **published list prices** unless labeled negotiated / sales-quoted / aggregator. Do not treat list prices as what a high-volume buyer actually pays. When a vendor publishes no number, the finding is **unknown**, not a guess.

Loofta context for the writer: Solana product that lets a business pay any email/@username before the recipient has an account; recipient claims to USDC, Venmo, Cash App, Revolut, Zelle, or a local bank.

## 1. Exact fees: platform, per-payout, FX, instant, cross-border, minimums

### Takeaway
Published list prices cluster into four models: (a) **flat cents** on a closed network (PayPal/Venmo Payouts API $0.25 USD; Hyperwallet PayPal/Venmo/PYUSD $0.25; Increase ACH $0.50 next-day); (b) **percent-of-cash** on claim-later rewards (Tremendous 4% sender-paid / 6% recipient-paid for US cash rails; 5% for most EM wallets); (c) **per-seat SaaS + FX** for contractors (Deel $49, Remote $29, Toku $19, Gusto $49+$6 or $5/global payment); (d) **quote-only enterprise** (Tipalti, Nium, Thunes, Ebanx, Modern Treasury, Routable dollar amounts). Instant payouts are consistently ~1–1.5%. Published FX markups sit at 0.23% (Wise floor) to 2% (Trolley and Hyperwallet “basic”) to 4% (Hyperwallet rest-of-world).

### Cited Findings

**PayPal Payouts / Venmo Payouts (US merchant schedule, last updated 1 Oct 2026)**
- US web/dashboard Payouts (ex–Mass Pay): **2% of the transaction, not to exceed the cap**. USD cap **$1.00**. — [PayPal US merchant fees, last updated 1 Oct 2026](https://www.paypal.com/us/business/paypal-business-fees)
- US **Payouts API**: **flat $0.25 USD** per payout (not 2%). Other API flats: €0.22, £0.17, C$0.32, A$0.32, ¥30, ₱12.50, R$0.50, MXN 2.75, etc. MYR API fee “Not Applicable”. International Payouts: **2% not to exceed the international cap**. USD international cap **$20.00**. Other international caps: €16, £14, A$24, R$40, ₱1,000, ¥2,000. — same page
- Developer docs (updated 14 Sep 2026): fee is charged to the **sender**, not the recipient; “typically” 2% with a cap; **Venmo payouts incur the same fees as PayPal Payouts in the US**; extra fees if currency conversion is required. — [PayPal Payouts fees](https://developer.paypal.com/payouts/fees)
- No published platform/subscription fee for Payouts API. No published instant-payout surcharge separate from the above (PayPal/Venmo wallet credit is the product).

**PayPal Enterprise Payouts / Hyperwallet (same US merchant-fee page, 1 Oct 2026)**
- Enterprise marketing page still says **customized pricing** by volume, size, and markets. — [PayPal Enterprise Payouts](https://www.paypal.com/us/business/make-payments/enterprise-payouts)
- Official US merchant-fee **list** for Hyperwallet (treat as published schedule; enterprise programs may negotiate): Domestic bank **$0.95**; domestic instant bank **$1.50**; international bank **$4.95**; wire **2% (min $10, max $30)**; debit card domestic **$1.50**, international **1.5% (min $3, max $30)**; cash pickup **$10**; PayPal **$0.25**; PYUSD **$0.25**; Venmo **$0.25**; check **$3**; third-party digital wallet **1.5% (min $1.50)**; spendback greater of **$0.50 or 1%**; FX spread **2%** in USD/CAD/HKD/AUD/EUR-SEPA/GBP/MXN and **4%** rest of world; subaccount unload **$5**; return **$10**. Card issuing: magnetic stripe **$2.95** branded / **$3.95** merchant-branded (min 1,000); chip-and-pin **$5.95**; virtual card **$1.00**. — [PayPal US merchant fees, 1 Oct 2026](https://www.paypal.com/us/business/paypal-business-fees)

**Stripe Connect (payouts to connected accounts)**
- Two models. **Stripe handles pricing**: platform pays **no** extra account, payout-volume, tax-reporting, or per-payout fee. **You handle pricing**: **$2 per monthly active account** (active = a month in which a payout is sent to bank or debit) + **0.25% + 25¢ per payout**. — [Stripe Connect pricing](https://stripe.com/connect/pricing)
- Instant Payouts (Connect): **1% of payout volume**, both models. Platform can mark up further. — [Stripe Connect pricing](https://stripe.com/connect/pricing)
- Cross-border Connect payouts: **starting at 0.25% of payout volume**. — same page
- 1099 (you-handle-pricing): **$2.99 IRS e-file, $1.49 state, $2.99 mailed**. Stripe-handles-pricing: digital 1099 free. Account debits (you-handle only): **1.5%**. Pay-with-Stripe-balance (preview): **1%**. — same page

**Stripe Instant Payouts (merchant) and Global Payouts (third-party send)**
- Merchant Instant Payouts (withdrawing own funds): **1.5%** of volume; “pricing differs for Connect users”. Standard scheduled payouts: free. — [Stripe pricing](https://stripe.com/pricing)
- Global Payouts **domestic**: local bank **$1.50**/payout; debit card **$1.50 + 0.75%**, **minimum 50¢**. — [Stripe pricing](https://stripe.com/pricing)
- Global Payouts **international** (50+ countries): **$1.50**/payout + cross-border **starting at +0.25%** + FX **starting at +0.5%**. Cross-border depends on recipient country; FX depends on merchant country. — [Stripe pricing](https://stripe.com/pricing)

**Wise Business / Wise Platform**
- US Wise Business: one-time setup **$31** for receiving-account details in multiple currencies. Volume discount above **$25,000** (or equivalent). Sending/converting: **from 0.23%**, varies by currency. Holding balances free. Domestic receive (non-SWIFT) in listed currencies: free. USD wire/SWIFT receive: **$6.11**. — [Wise Business US pricing](https://wise.com/us/pricing/business) (cited from prior fetch this research cycle; live page not re-fetched 13 Oct 2026 afternoon)
- Wise Platform: **no public rate card**. Investor materials: cost-plus-margin; partners can override displayed fees via `pricingConfiguration` (beta). — [Wise investor topics](https://owners.wise.com/investor-topics); [Wise Platform pricing docs](https://docs.wise.com/guides/product/send-money/quotes/pricing)
- FY26 (year to 31 Mar 2026) average **cross-border take rate** implied by $243.5B volume and cross-border revenue path; press release: net revenue **$2,502.8M**, cross-border volume **$243.5B**. — [Wise FY26 results](https://owners.wise.com/news-releases/news-release-details/wise-group-plc-reports-full-year-2026-financial-results)

**Payoneer (public “typical” table, last updated 1 Jan 2026)**
- Page is an **estimate** for “majority of account types in majority of regions.” Exact fee is shown in-account before confirm. Custom package for **>$50k USD monthly**. — [Payoneer pricing](https://www.payoneer.com/about/pricing/)
- Receive: Payoneer-to-Payoneer free; marketplace “varies”; local-currency receiving account free; non-local receiving account **1% (min $1)**; card receive **up to 3.99% + $0.49**; US ACH debit receive **1%**; EU/UK bank receive **1%**; PayPal receive (US) **up to 3.99% + $0.49**.
- Send to a Payoneer account: same-country **up to $4 / €4 / £4**; cross-country **up to 1% + up to $4**; card **up to 3.99%**; UK/EU bank **1%**; US ACH **1%**.
- Withdraw to bank: same-country local currency (listed countries including USA, UK, PH, VN, MX, KE, etc.) **$1.50**; to recipient local currency with no conversion **1.2%–4%** (some corridors min up to **$20**); with conversion **1.2%–4%**.
- US customers (by registration date): **$1.50** per withdrawal/payment up to **$50,000**/month, then **up to 0.5%**.
- Balance-to-balance currency move: **0.50%**.
- Annual account fee **$29.95** if the account receives **<$6,000** in any 12 consecutive months. Annual card fee **$29.95**. Escheatment fee: “variable per state.”

**Tipalti**
- Accounts Payable plans **starting at $99/month**. Mass Payments plans **starting at $249/month**. Unlimited users. **Plus** transaction pricing per invoice/payment, entity count, and modules. No per-user fee. No free tier. Per-method fees and FX **not published** — “request a custom quote.” — [Tipalti pricing](https://tipalti.com/pricing/)

**Trolley (published calculator, fetched 13 Oct 2026)**
- Modules: Pay **$2,399/year**; Tax **$2,399/year** (one jurisdiction on Standard); Trust **$1,199/year** (10 free IDV scans/month). 30-day free trial. — [Trolley pricing](https://trolley.com/trolley-pricing/)
- USD transaction fees: ACH **$1**; CAD EFT **$1**; SEPA/FPS/NPP/BECS **$4**; IACH **$4**; debit-card payout **1% ($1.50 min)**; FX wire **$10**; USD wire no-FX **$25**; PayPal **$0** (PayPal’s own fees may still apply); Venmo **$1.50** (PayPal fees may still apply); FX conversion **2.00%** (negotiable at volume). IRS statement **$2**; digital-platform reporting **$3**; IDV scan **$2.50**. Fees can be carried, split, or passed to recipients. EUR/CAD/GBP/AUD tables differ (e.g. EUR SEPA **€1**, EUR ACH **€4**).

**Tremendous**
- Platform, API, bulk, fraud, tax tools: **$0**. Gift cards / prepaid Visa / donations: **face value**. Credit-card funding: **3%**. Bank funding (US/EU/UK): **$0**. Volume conversation at **$200k+**/year. — [Tremendous pricing](https://www.tremendous.com/pricing/)
- Monetary options (help article, fetched 13 Oct 2026): sender-paid **4%** on US instant debit / Cash App / Venmo / PayPal / US-GBP-EUR-AUD-CAD-MXN-BRL bank (mins $0.25–$2.50 depending on product); **5%** on Alipay, GCash, MoMo, GoPay, DANA, LinkAja, Naver Pay, OVO, ShopeePay, TrueMoney, Teen Cash (min $0.25). Recipient-paid alternative: **6%** deducted (USD min $1, max $25). If sender passes fees, at least one no-fee product is required. — [Tremendous monetary option fees](https://help.tremendous.com/en/articles/monetary-option-fees)

**Tango Card (Blackhawk Network)**
- Official FAQ: portal is **free to use**; customers “typically only pay the value of the rewards, incentives, or payouts they send.” “Small fees may be applied by our partners for some payout or funding options.” No published cash-payout percent. RaaS API: “No transaction or API fee.” — [Tango fees FAQ](https://www.tangocard.com/questions/are-there-any-fees-or-contracts); [Tango RaaS API](https://www.tangocard.com/reward-program-api)
- Competitor-authored Giftbit comparison (do not treat as official) has historically listed 3.5% card funding and customization fees. Official Tango cash-to-PayPal/ACH percent: **unknown**.

**Rybbon / BHN Rewards**
- Official page: On-Demand (pay-as-you-go) and Annual Subscription are both **contact-for-quote**. **100% refund** for rewards not claimed (all plans). Card funding: US corporate cards “case-to-case,” **3% processing fee**. PayPal rewards have **minimum annual volume requirements**. No published per-payout cash percent. — [BHN Rewards pricing](https://www.bhnrewards.com/pricing/)

**Giftbit**
- No subscription, platform, or minimum. Digital gift cards: face value. Card funding: **2.9%**. Physical prepaid exceptions: US Visa 6-mo **$2.95**/card, 12-mo **$4.95**; GBP Mastercard **£1**; AUD Visa **$2**. FX conversion: **free**. Promotional (expiring) rewards: default **25% of unclaimed value returns to sender**. Unused credits refundable in full. — [Giftbit pricing](https://www.giftbit.com/pricing)

**Deel**
- Contractor management **$49**/contractor/month. Contractor of Record **$325**/month. EOR **$599**/employee/month. US PEO **$125**/employee/month. Talent marketplace **$14**/worker/month. Month-to-month. Page says “no hidden fees” and “competitive exchange rates” but **does not publish FX markup or per-withdrawal fees**. — [Deel pricing](https://deel.com/pricing)
- A Deel blog (contractor-facing) lists **withdrawal** fees: non-US instant card **2% (min $5, cap $15)**; US **0.75% (min $5, cap $25)**; Wise and Revolut **no Deel withdrawal fee**; PayPal **2.5% (min $0.25)**; Coinbase **1.5%**. These are **recipient-side** withdrawal fees, not the employer platform fee. — [Deel withdrawal options](https://www.deel.com/blog/contractor-payment-withdrawal-options-on-deel/)

**Remote**
- Contractor Management **$29**/contractor/month. Plus **$99** (adds indemnity up to $100k/contractor). Contractor of Record **from $325**. EOR **$699**/employee/month. Global Payroll **$29**/employee/month (implementation fee + recurring “payroll delivery fee” exist, amounts unpublished). US PEO **from $99**. Equity **from $39**. No platform/setup fee on HR/EOR/contractor. FX: “Remote FX rate” shown on invoice; markup **not published as a percent**. No minimum headcount. — [Remote pricing](https://remote.com/pricing)

**Rippling**
- No public contractor or EOR list price found 13 Oct 2026. Quote-based. — [Omnivoo Deel vs Rippling](https://omnivoo.com/blog/deel-vs-rippling-contractor-payments)

**Gusto**
- Live payroll plans (13 Oct 2026): Simple **$49/mo + $6/person**; Plus **$80/mo + $12/person**; Premium **$180/mo + $22/person**. US contractors billed at the per-person rate **only in months they are paid**. Global contractor payments: **no monthly per-contractor fee**; **$5 per payment to US-based bank accounts**; “foreign exchange rates may vary” (markup unpublished). Instant pay add-on **$100 per payroll** (included in Premium). Same-day **$90 per payroll**. — [Gusto pricing](https://gusto.com/product/pricing)

**Gigapay**
- Pro: **€279/month + 4.9% per payout**. Unlimited global payouts/vendors, tax/compliance, API, self-serve creator onboarding. Enterprise: custom, for **€1.8M+**/year transferred. Gigapay is Merchant of Record. — [Gigapay pricing](https://www.gigapay.com/pricing)

**Toku**
- Contractor Management list **$19**/contractor/month. AOR **$149**/contractor/month. EOR **$599**/employee/month. US PEO **$89**/employee/month (min 5 employees). Token-grant admin **$1,200/month** up to 49 stakeholders. Stablecoin payroll **included** in every tier. On-chain fees itemized separately; final commercial terms agreed before onboarding. Stablecoin API: contact sales. — [Toku pricing](https://www.toku.com/pricing)

**Rise**
- Rise’s own 2 Oct 2026 blog, citing riseworks.io/pricing: Global Contractor/Direct **from $49**; AOR **$299**/contractor/month; EOR **$399**/employee/month. Separate cost post: stablecoin/crypto payout **$2.50** flat; fiat payout **$10 + 1–2% FX**; US Direct Payroll greater of **$49/month or $19/employee**. Live pricing page not independently re-fetched this pass. — [Rise Pay 2026](https://www.riseworks.io/blog/introducing-rise-pay); [Rise stablecoin vs SWIFT](https://www.riseworks.io/blog/stablecoin-payroll-cost-vs-swift-wire)

**Veem**
- Free plan vs Premium **$24.99 USD / $34.99 CAD**. Domestic ACH/EFT: **free on Premium, else $1** ($1.49 CAD). Check **$1.99**. Same-day bank **0.5%** on the plan comparison; fee table also lists same-day **1% max $20** (sender or receiver can pay) — two figures on the same page; treat as **0.5–1% same-day / instant, confirm in-product**. Instant deposit is a receive feature. International in USD: receive **$29** (**$40** if over $10k). International in local currency: send/receive presented as free (FX is the revenue). US debit send **1.5% min $3.50** (business **2.5% or $3.50 min**). US credit send **3.5% min $3.50**. — [Veem pricing](https://www.veem.com/pricing/)

**Airwallex (US fee schedule)**
- Explore **$0/month**; Grow **$99/month**; Accelerate/Custom: custom. SWIFT SHA **$15**; SWIFT OUR **$25**. FX in Airwallex’s own comparison copy: **0.5–1% above interbank**. Local-payout cents not fully extracted from the PDF this pass. — [Airwallex US Fee Schedule](https://www.airwallex.com/us/terms); [Airwallex vs Nium](https://www.airwallex.com/en-us/blog/comparison-nium-vs-airwallex)

**dLocal Go (self-serve) vs dLocal enterprise**
- Enterprise dLocal is **negotiated**. FY2025 TPV **$40.8B**, revenue **$1,093.6M**. — [dLocal 4Q25 earnings](https://www.globenewswire.com/news-release/2026/03/18/3258603/0/en/dLocal-Reports-2025-Fourth-Quarter-Financial-Results.html)
- H1 2026 TPV **$31.7B**, revenue **$735.5M**. — [dLocal Q2 2026 exhibit](https://www.sec.gov/Archives/edgar/data/1846832/000184683226000031/ex_991-dlocalxearningsxres.htm)
- dLocal Go LATAM payout list prices were cited in a prior pass (local 1.00% + $0.20; cross-border 1.50% + $0.20). That PDF was not re-fetched this afternoon; treat as previously extracted, not re-verified 13 Oct 2026 p.m.

**Thunes / Nium / Ebanx**
- **No public rate card.** Nium docs describe configurable flat/percent/tiered/FX-margin engines with rates set per client. — [Nium fees](https://docs.nium.com/docs/fees-and-limits/fees)
- Thunes exposes a calculate-fees API; example payload in docs is **not** a public list price. — [Thunes calculate-fees](https://thunes-tilia-docs.redocly.app/openapi/prod/invoicing/openapi/payout/paths/~1v2~1%7Baccount_id%7D~1payout~1calculate-fees/get.md)

**Dots (usedots.com)**
- Core **$19/month**: domestic **$2**; international **3.9% + $2**; crypto **3% + $2**; instant **$0**; 1099 **$5** (+$1 mail); IDV **$5**; intl wire **$40**. Push-to-card disabled on Core.
- Scale **$999/month**: domestic **$1**; international **2.9% + $1**; domestic push-to-card **$1 + 0.75% ($1.50 min)**; intl push-to-card **$1 + 2.9%**; crypto **2%**; instant **$0**; 1099 **$3.50**; IDV **$3**; background check **$10**; intl wire **$30**.
- Enterprise: custom. Claims 190+ countries. — [Dots pricing](https://usedots.com/pricing/)

**Routable**
- Official page (fetched 13 Oct 2026) advertises Growth / Invoice Automation / scale tiers with feature checklists (mass payouts “up to 1000 included” / “up to 3000 included”) but **publishes no dollar prices**. — [Routable pricing](https://www.routable.com/pricing/)
- Aggregator SaaS True Cost (last verified 2026-05-17) reports Growth **$1,250/month** ($1,000 annualized) and Scale **$2,000/month** ($1,600 annualized). Treat as **unverified against official page**. — [SaaS True Cost Routable](https://saastruecost.com/software/routable/pricing/)

**Melio**
- Go: **$0**; **5 free ACH/month**, then **$0.50**. Core: **$25/mo + $10/extra user** (annual $20 + $8); **20 free ACH**. Boost: **$55/mo + $10/extra user**; **50 free ACH**. Unlimited: **$80/mo**, unlimited ACH and users. Platinum: invite-only, **>$300k/month card volume**, custom.
- Payment-method table: ACH **$0.50**; check **$1.50**; fast check **$20**; overnight check **$50**; instant bank **1% ($75 max)**; same-day ACH **1% ($75 max)**; wire **$10**; same-day wire **1% ($10 min, $75 max)**. Card-funded versions add **2.9%**. Global by ACH: USD **$20**; fast USD **1% ($30 min, $95 max)**; local currency “conversion rates apply.” — [Melio pricing](https://melio.com/pricing/)

**Modern Treasury**
- Usage-based; **no public per-payout dollar figures**. Covers ACH, wires, RTP/FedNow, push-to-card, checks, **stablecoins**. On/off-ramp = fiat-rail fee + conversion fee; amounts sales-quoted. Their educational RTP page cites **industry** ranges (ACH $0.20–$1.50, RTP $0.25–$1, wires $25–$50) — those are **not** Modern Treasury’s price. — [Modern Treasury pricing](https://www.moderntreasury.com/pricing)

**Increase**
- Published technology fees (platforms can get custom). Next-day ACH origination **$0.50**; same-day ACH **$2.00**; ACH return **$5**; unauthorized return **$15**; late return **$25**. Wire origination **$15**. Check print/mail **$3** + $1/extra page; check return **$10**. Virtual card **$0.25**. Card dispute **$15**. RTP origination **$2.50**. FedNow origination **$2.50**. Monthly platform fee: “varies by use case,” unpublished. — [Increase fees](https://increase.com/fees)

**Payable**
- Y Combinator S14 contractor-payout startup. **Acquired by Stripe in July 2017**. Domain now redirects to Stripe. Not a current standalone product. — [Dealroom Payable](https://app.dealroom.co/companies/payable); [YC Payable listing](https://www.markosweb.com/startup-ideas/companies/payable.com)

### Inferences
- For a $50 US payout to an existing PayPal/Venmo user, the cheapest published API is PayPal/Venmo Payouts or Hyperwallet PayPal/Venmo/PYUSD at **$0.25** (0.5%). Tremendous cash to the same rails is **4% ($2)** — 8× more — because Tremendous is selling “email a claim link, recipient picks the rail” plus catalog economics.
- For a $50 US payout to a bank, Increase next-day ACH at **$0.50** and Melio ACH at **$0.50** (after free-tier) undercut Stripe Global Payouts (**$1.50**), Hyperwallet domestic bank (**$0.95**), and Trolley ACH (**$1** plus $2,399/year).
- Contractor SaaS (Deel/Remote at $29–$49/seat) is uneconomic for nano/creator $20–$100 one-offs. Gigapay’s **4.9% + €279** and Tremendous’s **4–6% + $0** are the list prices that actually map to that job.
- Anything labeled “starting at” (Tipalti $99/$249, Stripe XB 0.25%, Wise from 0.23%) is a floor. Enterprise corridors are negotiated.

### Gaps
- Official Tango Card cash-to-PayPal/ACH/Venmo percent (portal is free; cash fee unpublished).
- Official Routable, Nium, Thunes, Ebanx, Rippling, Tipalti per-method, Wise Platform partner, Airwallex local-payout cents, Modern Treasury contracted rates.
- PayPal currency-conversion **spread percent** on Payouts (developer docs confirm a spread exists; Hyperwallet publishes 2%/4%; Payouts API spread was not extracted as a single bps number).
- Whether Gusto still sells a contractor-only $35+$6 SKU (not on the live page 13 Oct 2026).
- Veem same-day vs instant fee conflict (0.5% vs 1% max $20 on the same page).
- dLocal Go 2026 payout card not re-fetched this afternoon.

## 2. Recipient requirements: onboard, KYC, bank, tax, email-only, unclaimed funds

### Takeaway
Almost every incumbent that can pay an email still forces the recipient onto **that vendor’s account** (or a connected Stripe/Payoneer/Deel account) before money is spendable. The widely documented “pay just an email, claim later” mass-payouts are **PayPal/Venmo Payouts** (30-day auto-return), **Tremendous** (email/SMS claim; monetary options expire at 6 months), **Giftbit / BHN Rewards / Tango** (reward links), and (partially) **Dots** (testimonial: onboard after first payment). Contractor, AP, and bank-rail products require bank details and usually W-9/W-8 **before** the first payment. Unclaimed-funds treatment is published for PayPal (30-day return), Tremendous (6-month monetary drop-off), Giftbit (unlimited or 25% breakage share), BHN Rewards (100% refund), and Payoneer (state escheatment + fee).

### Cited Findings
- **PayPal/Venmo Payouts**: Unregistered recipients can be paid; they must **create a PayPal or Venmo account to claim**. Unclaimed items auto-return after **30 days**. Venmo payouts **US-only**. Per-item limits: registered USD **$60,000**, unregistered USD **$20,000**. — [PayPal Payouts fees/limits](https://developer.paypal.com/payouts/fees); [PayPal supported features](https://developer.paypal.com/payouts/supported-features)
- **PayPal Enterprise Payouts**: hosted or embedded **payee portal**; payee chooses bank / PayPal / Venmo / card / wallet / eGift / cash pickup / **PYUSD**. Vendor sells **KYC/KYB, account validation, 1099, AML/sanctions**. Not an email-only fire-and-forget rail. — [PayPal Enterprise Payouts](https://www.paypal.com/us/business/make-payments/enterprise-payouts)
- **Stripe Connect**: recipient is a **connected account**. Full ToS + identity verification. Instant Payouts require full ToS and a local-currency external account. Stablecoin preview: individual/sole prop only; must use Express Dashboard and link a crypto wallet. Cannot pay “just an email” without onboarding a connected account. — [Stripe Instant Payouts](https://docs.stripe.com/connect/instant-payouts); [Stripe stablecoin payouts](https://docs.stripe.com/connect/stablecoin-payouts)
- **Wise**: consumer “pay by email” requires the recipient to **create a Wise account** with that email, then claim to Wise or a bank; expiry 7 or 10 days (help articles conflict), then refund. Not a business mass-payout API. — [Wise pay-by-email](https://wise.com/help/articles/2932105/how-can-i-send-money-to-an-email-address)
- **Payoneer Mass Payout**: “Register your payees first — **only registered payees** can receive payouts.” Deposit-in-advance. — [Payoneer mass submit](https://www.payoneer.com/developers-docs/mass-payout/mass-submit-payout/)
- **Payoneer consumer account**: unused funds can be **escheated to a US state**, with a processing fee “in the amount permitted by that state.” — [Payoneer pricing](https://www.payoneer.com/about/pricing/)
- **Trolley**: white-label **recipient self-onboarding** widget (bank, PayPal, Venmo, check, debit, wallet) plus tax forms. IDV is a paid Trust module. Payment does not go out until the recipient has completed the chosen method. — [Trolley pricing](https://trolley.com/trolley-pricing/)
- **Tremendous**: rewards **delivered via email or SMS**. Recipient picks from options the sender enabled. Automated **W-9 collection and 1099 prep** included at $0. Monetary options are **not default**; sender must enable them. Monetary options remain selectable for **6 months**, then drop off (replaced by prepaid card if they were the only option). 99.8% of monetary redeemers do so within 6 months. — [Tremendous pricing](https://www.tremendous.com/pricing/); [Tremendous monetary option fees](https://help.tremendous.com/en/articles/monetary-option-fees)
- **Giftbit**: email reward link. Standard rewards **never expire**. Promotional rewards expire on a sender-set date; **25% of unclaimed value** returns to the sender (Giftbit keeps the rest as breakage). — [Giftbit pricing](https://www.giftbit.com/pricing)
- **BHN Rewards (Rybbon)**: sender sets a claim window; unclaimed rewards are **100% refunded** on all plans. Unused ordered rewards also 100% refundable. — [BHN Rewards pricing](https://www.bhnrewards.com/pricing/)
- **Deel / Remote / Rippling / Gusto / Toku / Rise**: contractor must be **onboarded** (contract, tax form, payout method) before payroll runs. Deel blog: 10+ withdrawal methods after funds sit in a Deel balance. These are workforce products, not claim-links. — [Deel pricing](https://deel.com/pricing); [Remote pricing](https://remote.com/pricing); [Toku pricing](https://www.toku.com/pricing)
- **Gigapay**: “self-service creator onboarding”; Gigapay is MoR so the **brand** does not collect each creator’s tax identity — Gigapay does. Creator still onboards to Gigapay. — [Gigapay pricing](https://www.gigapay.com/pricing)
- **Dots**: customer testimonial: “onboard users **after** their first payment” (Collabstr). Product includes IDV and 1099. Methods: ACH, wire, PayPal, Venmo, local currency, gift cards, RTP. — [Dots pricing](https://usedots.com/pricing/)
- **Melio**: vendor/contractor is a payee with bank/check/card details. Core+ includes **W-9 collection, TIN validation, 1099**. Not email-only. — [Melio pricing](https://melio.com/pricing/)
- **Increase / Modern Treasury**: bank-rail infrastructure. Recipient is an **account number / RTP address / wallet**, not an email. — [Increase fees](https://increase.com/fees); [Modern Treasury pricing](https://www.moderntreasury.com/pricing)
- **Routable**: branded vendor onboarding, domestic/international tax forms, 1099 / 1042-S filing, bank-account ownership validation on higher tiers. — [Routable pricing](https://www.routable.com/pricing/)

### Inferences
- “Pay an email before the recipient exists” as a **business API** is productized by PayPal Payouts, Tremendous, Giftbit/Tango/BHN-class rewards, and (partially) Dots. Everyone else wants a payee record first.
- Tax is the forcing function. W-9/W-8/1099 is built into Trolley, Tremendous, Tipalti, Dots, Melio, Stripe Connect, Deel, Gusto, Routable. A Loofta “claim to Venmo” flow that skips US tax collection will look incomplete to any US platform buyer above hobby volume.
- Unclaimed-funds policy is a product decision incumbents have already made: refund (PayPal 30d; BHN 100%), keep-and-share-breakage (Giftbit 25%), drop monetary options at 6 months (Tremendous), or escheat (Payoneer). Loofta needs an explicit rule; silence is a legal gap, not a feature.

### Gaps
- Stripe Global Payouts email-recipient KYC (docs URL known: https://docs.stripe.com/global-payouts/recipient-requirements — page not fetched this pass).
- Tango official unclaimed / expiry policy (BHN Rewards, a sister Blackhawk brand, publishes 100% refund; Tango’s own terms were not fetched).
- Tipalti payee-portal: whether a payment can be issued to an email before the payee finishes onboarding.
- Hyperwallet payee expiry / unclaimed / escheat (return fee $10 is published; escheatment is not).
- Whether Dots can complete a payout to PayPal/Venmo without the recipient creating a Dots account.
- Nigeria/Pakistan/Ghana KYC specifics (BVN/NIN etc.) for any of these vendors.

## 3. Country coverage and notable gaps

### Takeaway
Headline “190–200+ countries” is common (Payoneer, Tipalti, Dots, Enterprise Payouts, Airwallex, Nium) and mostly means **some rail exists**, not local NGN/PKR/GHS. **PayPal Payouts’ own country table omits Nigeria, Ghana, and Pakistan entirely.** India is receive-and-withdraw only (Indian merchants cannot send Payouts). Argentina/Brazil have conversion locks. Tremendous cash banks stop at US/UK/EU/AU/CA/MX/BR plus EM **wallets** (GCash, MoMo, Alipay, Indo e-wallets) — **no NGN/PKR/GHS/INR bank**. The corridors Loofta cares about (NG, PK, GH, plus PH/VN/BR/AR) are either missing, FX-restricted, or only reachable via Thunes/dLocal/Payoneer-class local rails — not via PayPal/Venmo/Zelle.

### Cited Findings
- **PayPal Payouts eligible-country table** (updated 10 Sep 2026): includes AR, BR, IN (receive/withdraw only), MX (receive/withdraw only), PH (local currency), VN, KE, ZA, SN, and most of Europe/APAC. **Nigeria, Ghana, and Pakistan are not listed.** India: merchants **cannot send** payouts from India. Currency conversion **excluded** for China, India, Korea, Taiwan, Thailand, Turkey, the Caribbean, and almost all of Latin America including **Argentina, Brazil (special), Chile, Colombia, Peru**. Enterprise Payouts separately: cannot convert **ARS, BRL, MYR**. Venmo: **US recipients only**. — [PayPal supported features](https://developer.paypal.com/payouts/supported-features); [PayPal Enterprise Payouts](https://www.paypal.com/us/business/make-payments/enterprise-payouts)
- **Stripe Connect Instant Payouts country list** (from prior-cycle docs): AU, CA, DK, EU, HK, MY, NZ, NO, SG, SE, AE, UK, US — **no NG/PK/GH/IN/BR/AR/PH/VN**. Cross-border self-serve Connect: platform and connected account in **US, UK, EEA, CA, CH** only. Global Payouts: “50+ countries.” — [Stripe Instant Payouts](https://docs.stripe.com/connect/instant-payouts); [Stripe pricing](https://stripe.com/pricing)
- **Payoneer**: 190+ countries/territories, 70+ payout currencies. Same-country $1.50 withdraw list includes PH, VN, MX, KE, but **not Nigeria/Ghana/Pakistan** in that particular list (those corridors may still exist at the 1.2–4% cross-border rate — not confirmed). — [Payoneer pricing](https://www.payoneer.com/about/pricing/)
- **Tipalti**: “200+ countries and territories,” local rails, tax-ID validation in **62 countries**. Per-country matrix not on the pricing page. — [Tipalti pricing](https://tipalti.com/pricing/)
- **Deel**: 150+ countries, payments in 120+ currencies, EOR in 130+ countries. **40,000+** customers. — [Deel pricing](https://deel.com/pricing)
- **Remote**: EOR in **90+** countries (narrower than Deel’s 130+). — [Remote pricing](https://remote.com/pricing)
- **Gusto global contractors**: “more than **120 countries**.” Domestic product is US payroll. — [Gusto pricing](https://gusto.com/product/pricing)
- **Toku**: contractor/EOR/AOR “**100+ countries**.” — [Toku pricing](https://www.toku.com/pricing)
- **Dots**: “**190+ countries**, 300+ payout rails.” — [Dots pricing](https://usedots.com/pricing/)
- **Tremendous monetary geography** (13 Oct 2026): PayPal in **112 countries**; Cash App / Venmo / instant debit **USA only**; bank in US, UK/Gibraltar, 39 EU countries, AU, BR, CA, MX; wallets in CN, ID, PH (GCash), KR, TH, VN (MoMo). **No Nigeria, Pakistan, Ghana, or India bank product on the table.** — [Tremendous monetary option fees](https://help.tremendous.com/en/articles/monetary-option-fees)
- **Airwallex**: payouts to **200+ countries**, local rails in **120+**. Africa/mobile-money depth is the weak side vs Thunes in Airwallex’s own competitive copy. — [Airwallex vs Nium](https://www.airwallex.com/en-us/blog/comparison-nium-vs-airwallex)
- **Thunes**: competitor reviews (including Airwallex’s own) position Thunes as strongest for **Sub-Saharan Africa mobile money (M-Pesa, MTN)** including NG/KE/GH. No official public country PDF fetched. — [Airwallex Thunes review](https://www.airwallex.com/en-us/blog/thunes-review)
- **Melio / Increase / Veem**: US-centric AP/banking. Melio has a global-payments SKU (USD $20 / local FX). Increase is **US rails** (ACH, RTP, FedNow, US wire). — [Melio pricing](https://melio.com/pricing/); [Increase fees](https://increase.com/fees)
- **Gigapay**: creator testimonials are EU-heavy (NO, FI, DE, PL, SE, BG). Country list not on the pricing page. — [Gigapay pricing](https://www.gigapay.com/pricing)

### Inferences
- PayPal is a **wallet network**, not a last-mile bank network in West Africa. If Loofta’s recipient is in Nigeria, PayPal/Venmo/Zelle/Cash App do not solve the last mile; Payoneer, Thunes, dLocal-class, or a local bank/stablecoin off-ramp does.
- Tremendous is closer to Loofta on **claim UX** than anyone else, and it already lists Cash App + GCash + MoMo — but it still has **no NGN/PKR/GHS** and **no USDC**.
- “200 countries” on Tipalti/Dots/Enterprise Payouts is a sales claim that usually routes through SWIFT or a local partner. The **published** local-rail cards that actually name NG/PK/GH are thin. That is the wedge for a claim-to-local-bank or claim-to-USDC product.

### Gaps
- Official PayPal/Hyperwallet, Tipalti, Trolley, Payoneer, Nium, Thunes, Ebanx country×method matrices for **NG, PK, GH, IN, BR, AR, PH, VN**.
- Ebanx payout vs pay-in coverage (Ebanx is historically a LATAM **pay-in** specialist; payout list not fetched).
- Wise Platform corridor list vs Wise Business consumer corridors (GHS excluded on consumer email-pay).
- dLocal enterprise Africa/Asia payout coverage (Go card is LATAM).

## 4. Speed of settlement

### Takeaway
Wallet credits (PayPal, Venmo, Tremendous PayPal/Venmo/Cash App, PYUSD, Connect Instant, Rise/Toku stablecoin) are **minutes**. Domestic ACH is **T+1–T+2** (Increase next-day $0.50; Melio same-day 1%). RTP/FedNow/Instant SEPA are the published “real-time bank” options and cost more (Increase RTP $2.50; Stripe Instant 1%; Melio instant bank 1% cap $75). Tremendous publishes per-product timelines (Cash App instant; US bank 2–4 days; BRL/MXN/GCash/MoMo minutes). Cross-border local rails claim hours-to-same-day. SWIFT remains days plus correspondent fees.

### Cited Findings
- PayPal Payouts: “Recipients get payments **instantly**” to PayPal/Venmo; unclaimed returns in **30 days**. — [PayPal Payouts fees](https://developer.paypal.com/payouts/fees)
- Enterprise Payouts: near-instant to eligible PayPal/Venmo/PYUSD; US **RTP**, Instant SEPA, OCT debit, same-day in select markets. Availability varies. — [PayPal Enterprise Payouts](https://www.paypal.com/us/business/make-payments/enterprise-payouts)
- Stripe Instant Payouts: “typically within **30 minutes**.” — [Stripe Instant Payouts](https://docs.stripe.com/connect/instant-payouts)
- Stripe standard merchant payouts: rolling / weekly / monthly, **free**. — [Stripe pricing](https://stripe.com/pricing)
- Tremendous monetary timelines: instant debit / Cash App **instantly**; Venmo / PayPal **within minutes**; US bank **2–4 business days**; GBP/EUR **within minutes**; AUD/CAD **1–2 business days**; BRL/MXN **within minutes**; GCash / MoMo / Alipay / Indo wallets **within minutes**. — [Tremendous monetary option fees](https://help.tremendous.com/en/articles/monetary-option-fees)
- Veem: instant deposit (receive) in minutes; same-day bank priced; standard ACH days (implied). — [Veem pricing](https://www.veem.com/pricing/)
- Melio: instant bank and same-day ACH at 1% ($75 cap); same-day ACH if scheduled before **2 p.m. ET**; same-day wire before **6 p.m. ET**. Standard ACH is the $0.50 rail. — [Melio pricing](https://melio.com/pricing/)
- Increase: next-day ACH, same-day ACH, RTP, FedNow, wires as separate priced rails. — [Increase fees](https://increase.com/fees)
- Airwallex: own blog claims **94% of transactions outside SWIFT**, **93% arrive within hours or the same day**. — [Airwallex Thunes review](https://www.airwallex.com/en-us/blog/thunes-review)
- Deel: method-dependent (Wise local, SWIFT, instant card, Coinbase). No single SLA on the pricing page. — [Deel withdrawals](https://www.deel.com/blog/contractor-payment-withdrawal-options-on-deel/)

### Inferences
- “Instant” in this market means **wallet or RTP**, and it is sold as a **premium SKU** (1% Stripe/Melio, $1.50 Trolley Venmo / Hyperwallet instant bank, $2.50 Increase RTP). Loofta USDC-on-Solana is structurally in the instant bucket without that 1% rail fee — the cost is the off-ramp the recipient chooses later.
- Cross-border “local rail, same day” is Airwallex/Nium/Thunes/dLocal’s pitch against SWIFT. It still requires a **known bank account or wallet** at send time, except on the rewards/PayPal claim-link products.

### Gaps
- Official T+n tables for Payoneer, Tipalti, Trolley, Nium, Thunes, Ebanx, Gigapay, Toku fiat.
- Wise FY26 instant-transfer percentage (not in the FY26 press-release extract).
- dLocal payout settlement time.

## 5. Who they sell to, and minimum volume

### Takeaway
Three go-to-markets: **self-serve SMB** (Tremendous $0, Giftbit $0, Tango free portal, Melio $0, Veem $0/$25, Gusto $49, Dots $19, Wise ~$31 setup); **sales-led mid-market** (Tipalti $99–$249+, Trolley $2.4k/year, Gigapay €279, Deel/Remote/Rise per-seat); **enterprise/API infrastructure** (PayPal Enterprise, Stripe Connect platforms, Payoneer >$50k/mo custom, Nium/Thunes/Modern Treasury/Increase custom, dLocal enterprise). Several vendors publish an explicit volume conversation: Tremendous $200k/year, Payoneer $50k/month, Gigapay €1.8M/year, Melio Platinum $300k/month cards, BHN Rewards PayPal SKU has a min annual volume.

### Cited Findings
- PayPal Payouts: merchants/platforms with a PayPal business account; API vs web. Enterprise Payouts: “large enterprises and marketplaces,” CSV or REST, dedicated onboarding. — [PayPal Enterprise Payouts](https://www.paypal.com/us/business/make-payments/enterprise-payouts)
- Stripe Connect: platforms and marketplaces. Global Payouts: businesses sending to third parties. — [Stripe Connect pricing](https://stripe.com/connect/pricing)
- Wise Business: SMB self-serve. Wise Platform: banks and embedded partners. — [Wise FY26 results](https://owners.wise.com/news-releases/news-release-details/wise-group-plc-reports-full-year-2026-financial-results)
- Payoneer: SMB + marketplace payouts; “processing over **50k USD monthly**? Get in touch.” — [Payoneer pricing](https://www.payoneer.com/about/pricing/)
- Tipalti: finance teams, AP automation, “creators, artists, sellers, clinical-trial participants.” — [Tipalti pricing](https://tipalti.com/pricing/)
- Trolley: creator/marketplace payouts; self-serve trial then subscription. — [Trolley pricing](https://trolley.com/trolley-pricing/)
- Tremendous / Giftbit / Tango / BHN: marketing, research incentives, rewards; self-serve in minutes (Tremendous/Tango/Giftbit) or quote (BHN annual). Tremendous enterprise AM at $0 extra. BHN: “3,000 customers.” — [Tremendous pricing](https://www.tremendous.com/pricing/); [BHN Rewards pricing](https://www.bhnrewards.com/pricing/)
- Deel: startups to enterprise, **40,000+** customers. Remote: same category, no minimum headcount. Gusto: US SMB, **500,000+** businesses. — [Deel pricing](https://deel.com/pricing); [Remote pricing](https://remote.com/pricing); [Gusto pricing](https://gusto.com/product/pricing)
- Gigapay: influencer/creator finance teams; Enterprise at **€1.8M+**/year. — [Gigapay pricing](https://www.gigapay.com/pricing)
- Toku / Rise: crypto-native and global payroll; Toku AOR for “ambassador, creator, contributor, or validator programs.” — [Toku pricing](https://www.toku.com/pricing)
- Dots: platforms (creators, gig, marketplaces); Core $19 is SMB-API. — [Dots pricing](https://usedots.com/pricing/)
- Melio: US SMB AP/AR; Platinum **>$300k/month card**. — [Melio pricing](https://melio.com/pricing/)
- Increase: “financial technology platform moving funds for your customers, or large corporate balances.” — [Increase fees](https://increase.com/fees)
- Modern Treasury: platforms; annual terms, usage toward a minimum commitment. — [Modern Treasury pricing](https://www.moderntreasury.com/pricing)
- Payable: historical contractor-payout ICP; **no longer a standalone vendor** (Stripe 2017). — [Dealroom Payable](https://app.dealroom.co/companies/payable)

### Inferences
- Loofta’s “pay 1,000 emails before they have accounts” is a **Tremendous / PayPal Payouts / Dots** buyer, not a Deel/Remote/Gusto buyer. Those HRIS products will not discount a $20 claim-link.
- Sales-led enterprise (Tipalti, Hyperwallet programs, Nium, Thunes) will not quote a startup at list. The public “starting at” is a lead magnet.

### Gaps
- Official minimums for PayPal Enterprise programs (list Hyperwallet fees exist; program minimums unpublished), Tipalti, Nium, Thunes, Ebanx, Modern Treasury, Increase custom.
- Rippling contractor packaging (HRIS bundle vs standalone).
- Routable official dollar minimum (page has no prices).

## 6. Revenue, GMV, valuations, customer counts

### Takeaway
The public companies that actually disclose payout-adjacent volume are huge: Wise **$243.5B cross-border / $2.50B net revenue / 18.9M actives** (FY26); Payoneer **$87.5B volume / $1.05B revenue** (FY2025); dLocal **$40.8B TPV / $1.09B revenue** (FY2025). Contractor SaaS: Deel **40k customers, $20B+ payroll**. Gusto **500k+ businesses**. BHN Rewards claims **3,000 customers**. Most private payout specialists (Tremendous, Trolley, Tipalti, Dots, Gigapay, Toku, Melio, Increase): no primary 2025–26 revenue found this pass.

### Cited Findings
- **Payoneer FY2025 10-K**: volume **$87.5B** (from $80.1B); revenue **$1,052.8M** (from $977.7M); +9% volume, +8% revenue. Competes with PayPal, Airwallex, Wise, Adyen/Braintree/Stripe, Bill.com, “mass payout service providers,” and global payroll/EOR. — [Payoneer 10-K FY2025](https://www.sec.gov/Archives/edgar/data/1845815/000110465926020487/payo-20251231x10k.htm)
- **Wise FY2026** (year to 31 Mar 2026): net revenue **$2,502.8M** (+19%); cross-border volume **$243.5B** (from $185.2B, +31%); active customers **18.9M** (from 15.6M). Business actives reached **572k** in Q4 FY26. — [Wise FY26 results](https://owners.wise.com/news-releases/news-release-details/wise-group-plc-reports-full-year-2026-financial-results)
- **dLocal FY2025**: TPV **$40.8B** (+60%); revenue **$1,093.6M** (+47%); gross profit **$402.8M**; net income **$196.9M**. 4Q25 TPV **$13.1B**. 2026 TPV guidance in the release was not re-extracted here. H1 2026 TPV **$31.7B**, revenue **$735.5M**. Pay-in vs payout split **not in the GlobeNewswire summary** fetched this pass. — [dLocal 4Q25](https://www.globenewswire.com/news-release/2026/03/18/3258603/0/en/dLocal-Reports-2025-Fourth-Quarter-Financial-Results.html); [dLocal Q2 2026](https://www.sec.gov/Archives/edgar/data/1846832/000184683226000031/ex_991-dlocalxearningsxres.htm)
- **Deel**: pricing page **40,000+ customers**, **$20B+** “compliantly processed global payroll,” 150+ countries. — [Deel pricing](https://deel.com/pricing)
- **Gusto**: “Trusted by more than **500,000** businesses.” — [Gusto pricing](https://gusto.com/product/pricing)
- **BHN Rewards**: “over **3,000** customers.” — [BHN Rewards pricing](https://www.bhnrewards.com/pricing/)
- **PayPal Q3 2025** (Enterprise Payouts footnote): “400M+ active accounts” cited as PayPal Earnings-Q3 2025 internal data. Full FY2025 10-K TPV/revenue **not re-fetched this afternoon**. — [PayPal Enterprise Payouts](https://www.paypal.com/us/business/make-payments/enterprise-payouts)
- Tremendous, Trolley, Tipalti, Giftbit, Tango, Dots, Gigapay, Toku, Veem, Melio, Routable, Modern Treasury, Increase, Ebanx, Payable: **no primary 2025–26 revenue/GMV found** in this pass.
- Airwallex / Nium / Thunes valuations: company-blog or aggregator figures exist in sister notes; not re-verified against primary filings this afternoon.

### Inferences
- PayPal’s hundreds of millions of accounts are the distribution moat that makes $0.25 API payouts viable. Loofta does not have that graph; Tremendous’s 4% is the price of **not** owning the wallet graph.
- Payoneer’s $87.5B and dLocal’s $40.8B TPV show that **marketplace/emerging-market disbursement** is a real, disclosed P&L line, not a feature checkbox. dLocal does **not** break out payout TPV in the earnings summary fetched here.
- Private infrastructure (Nium/Thunes/Airwallex) is funded at multi-billion valuations **without** publishing a rate card. Price discovery for Loofta vs these names will be corridor-by-corridor, not list-vs-list.

### Gaps
- PayPal FY2025 10-K TPV/revenue and Payouts/Hyperwallet volume (not broken out; 10-K not re-fetched this afternoon).
- Tipalti, Tremendous, Trolley, Melio, Modern Treasury, Increase, Ebanx, Rippling, Remote revenue.
- Primary-source Nium/Thunes/Ebanx/Airwallex financials.
- Stripe Connect payout volume (Stripe is private; no 10-K).
- dLocal pay-in vs payout TPV split (not in the GlobeNewswire summary).

## 7. Which have added stablecoin rails, and how

### Takeaway
Stablecoins are being bolted onto **existing fiat payout stacks**, almost always with the platform remaining in fiat. Stripe (Bridge) is the default plumbing: Connect stablecoin payouts are **US-platform private preview**; Deel launched a **Bridge/Privy DLUSD** wallet; Payoneer announced **Bridge-powered** receive/hold/send; Airwallex has **early-access API** stablecoin wallet payouts; PayPal Enterprise already pays **PYUSD at $0.25 list**; Toku and Rise sell **stablecoin payroll as a default SKU**; Modern Treasury lists stablecoins as a rail; Dots prices **crypto 2–3%**. Tipalti: **no official stablecoin payout page found**. Tremendous/Tango/Giftbit/Melio/Gusto/Veem/Increase: **no stablecoin rail found**.

### Cited Findings
- **Stripe Connect stablecoin payouts**: private preview, **US platforms only**. Platform balance stays **fiat**; Stripe converts and pays **USDC** to a wallet the connected account links in Express Dashboard. Individuals/sole props only; companies/nonprofits not yet. — [Stripe Connect stablecoin payouts](https://docs.stripe.com/connect/stablecoin-payouts)
- **Stripe Treasury stablecoins**: businesses in **101 countries** can hold a dollar stablecoin balance; powered by **Bridge**. Starting with USDC. — [Stripe Treasury stablecoins](https://stripe.com/blog/introducing-stablecoins-for-treasury)
- **Deel × Stripe (3 Jun 2026)**: Deel wallet holds **DLUSD** (custom stablecoin via Bridge Open Issuance) in an embedded **Privy** wallet. Live in **Argentina**, then rest of LATAM, then APAC/MENA/Africa. — [Stripe–Deel newsroom](https://stripe.com/en-gi/newsroom/news/deel-and-stripe)
- **Payoneer × Bridge (17 Feb 2026)**: receive, hold, and send stablecoins inside Payoneer. Launch **select markets Q2 2026**, broader through 2026. — [Payoneer IR](https://investor.payoneer.com/news-releases/news-release-details/payoneer-launch-stablecoin-capabilities-powered-bridge-bringing)
- **PayPal PYUSD on Enterprise Payouts / Hyperwallet**: payee option, 1:1 USD, Paxos issuance/custody, 24/7, near-instant, “no need to own PYUSD” (PayPal converts). List price **$0.25** per PYUSD transfer on the US merchant-fee schedule. Aimed at limited-banking / unstable-currency payees. — [PayPal Enterprise Payouts](https://www.paypal.com/us/business/make-payments/enterprise-payouts); [PayPal US merchant fees, 1 Oct 2026](https://www.paypal.com/us/business/paypal-business-fees)
- **Airwallex**: “Transfers via Stablecoin” **early access**, **API only**, not in the web app. Fee **not published**. — [Airwallex stablecoin transfers](https://www.airwallex.com/docs/payouts/transfers/transfers-via-stablecoin)
- **Toku**: stablecoin payroll, token rails, and stablecoin invoice payments **included in every pricing tier**. Separate Stablecoin API / Integration SKUs are sales-quoted. — [Toku pricing](https://www.toku.com/pricing)
- **Rise**: hybrid fiat/crypto payroll; USDC as default on Stablecoin Payroll; **$2.50**/crypto payout vs **$10 + 1–2% FX** fiat. — [Rise Pay](https://www.riseworks.io/blog/introducing-rise-pay)
- **Dots**: crypto payouts on the rate card (**3%+$2** Core, **2%** Scale). Coin and chain not specified on the pricing page. — [Dots pricing](https://usedots.com/pricing/)
- **Modern Treasury**: stablecoins listed alongside ACH/RTP/wire as a first-class rail; conversion fee unpublished. — [Modern Treasury pricing](https://www.moderntreasury.com/pricing)
- **Thunes**: Airwallex’s 2026 review says Thunes launched **Pay-to-Stablecoin-Wallets with Circle**. Primary page not fetched. — [Airwallex Thunes review](https://www.airwallex.com/en-us/blog/thunes-review)
- **Tipalti**: no stablecoin mention on the official pricing page fetched 13 Oct 2026. — [Tipalti pricing](https://tipalti.com/pricing/)
- **Tremendous / Giftbit / Tango / BHN / Melio / Gusto / Veem / Increase / Gigapay / Remote**: no official stablecoin payout fee or product page found in this pass. Tremendous monetary table is fiat wallets and bank only. — [Tremendous monetary option fees](https://help.tremendous.com/en/articles/monetary-option-fees)

### Inferences
- The winning 2026 pattern is **“employer stays in fiat, recipient optionally gets a dollar token.”** Stripe says this in so many words. That is the opposite of asking a US recipient to open a Solana wallet — and the same as Loofta’s “claim to Venmo **or** USDC” if the USDC path is optional.
- Bridge/Stripe is becoming the **default OEM** (Deel, Payoneer, Treasury, Connect). A Loofta integration story that is “we are Bridge” is crowded; “we are the claim layer in front of many rails” is not.
- Crypto-native payroll (Toku, Rise) already prices stablecoin **cheaper than fiat**. Fiat-native payouts (Tremendous 4%, PayPal $0.25) have not added USDC as a claim destination.

### Gaps
- Tipalti stablecoin (rumor vs product): no official page found.
- Payoneer Q2 2026 live-market list and fees.
- Airwallex stablecoin fee.
- Whether PayPal Payouts API (not Enterprise/Hyperwallet) can send PYUSD. Hyperwallet list includes PYUSD at $0.25; Payouts API docs describe PayPal and Venmo only.
- Dots crypto: which assets/chains.
- Nium/Ebanx/Wise Platform official stablecoin products (not found).

## 8. What each cannot do (capability holes vs Loofta)

### Takeaway
No incumbent matches Loofta’s bundle: **pay an identifier before an account exists, let the recipient choose USDC or a consumer cash app or a local EM bank, without forcing them onto the sender’s network.** PayPal can do email-then-claim but only into **PayPal/Venmo**, and not to NG/PK/GH. Tremendous can do email-then-claim to Venmo/Cash App/PayPal/bank/EM wallets at **4–6%**, with **no USDC** and **no NGN/PKR/GHS**. Stripe can do USDC but only after **Connect onboarding**, US-platform preview. Deel/Rise/Toku can do USDC but only after **contractor onboarding** at $19–$49/seat. Bank APIs (Increase, Modern Treasury) need an account number up front. Payable is dead (Stripe 2017).

### Cited Findings (cannot-do, sourced)

| Player | Cannot do (sourced limit) | Source |
|---|---|---|
| PayPal/Venmo Payouts | Cannot pay Nigeria/Ghana/Pakistan (not on country list). Cannot pay Venmo outside US. Cannot pay Cash App, Zelle, Revolut, or self-custody USDC. Recipient must join PayPal/Venmo. India senders cannot initiate. | [supported features](https://developer.paypal.com/payouts/supported-features) |
| PayPal Enterprise / Hyperwallet | Payee must use hosted/embedded portal + KYC. ARS/BRL/MYR conversion locked. Sales-gated programs; list prices exist but enterprise is customized. Venmo US-only. | [Enterprise Payouts](https://www.paypal.com/us/business/make-payments/enterprise-payouts) |
| Stripe Connect | Cannot pay a bare email. Self-serve XB limited to US/UK/EEA/CA/CH. Instant list excludes NG/IN/BR/AR/PH/VN. Stablecoin = US-platform preview, individuals only. | [stablecoin](https://docs.stripe.com/connect/stablecoin-payouts); [Connect pricing](https://stripe.com/connect/pricing) |
| Stripe Global Payouts | 50+ countries, not 190. Needs a recipient instrument. List price $1.50 + bps. | [Stripe pricing](https://stripe.com/pricing) |
| Wise Business/Platform | Email-pay is consumer, requires Wise account, 7–10 day expiry. Platform fees unpublished. Not a creator-rewards claim UX. | [Wise email](https://wise.com/help/articles/2932105/how-can-i-send-money-to-an-email-address) |
| Payoneer | Payees must be **registered before** payout. No email-then-claim. Consumer-grade 1.2–4% withdraw. | [mass submit](https://www.payoneer.com/developers-docs/mass-payout/mass-submit-payout/) |
| Tipalti | No self-serve rate card. Not a pay-an-email product on the marketing page. No official stablecoin. | [Tipalti pricing](https://tipalti.com/pricing/) |
| Trolley | Recipient must finish widget onboarding. $2.4k/year floor. 2% FX. No USDC on the fee table. | [Trolley pricing](https://trolley.com/trolley-pricing/) |
| Tremendous | No USDC/crypto on monetary table. Cash is 4–6%. No NGN/PKR/GHS/INR bank. Monetary options expire at 6 months. Not a contractor-compliance system. | [monetary fees](https://help.tremendous.com/en/articles/monetary-option-fees) |
| Giftbit / Tango / BHN | Gift-card first. Official Tango cash fees unknown. BHN is quote-only. Not bank/Venmo/USDC as a primary published rail. | [Tango FAQ](https://www.tangocard.com/questions/are-there-any-fees-or-contracts); [BHN](https://www.bhnrewards.com/pricing/); [Giftbit](https://www.giftbit.com/pricing) |
| Deel / Remote / Rippling / Gusto | Per-seat. Recipient is a contractor on the roster. Cannot fire 1,000 claim emails. Gusto instant is $100/payroll. Rippling price unknown. | [Deel](https://deel.com/pricing); [Remote](https://remote.com/pricing); [Gusto](https://gusto.com/product/pricing) |
| Gigapay | 4.9% + €279. MoR model (brand does not pay the person directly). EU-weighted. No USDC on page. | [Gigapay](https://www.gigapay.com/pricing) |
| Toku / Rise | Need a worker record + KYC. Seat fees. Crypto-native ICP, not SMB rewards. | [Toku](https://www.toku.com/pricing); [Rise](https://www.riseworks.io/blog/introducing-rise-pay) |
| Veem | Payee is a vendor with bank details. Instant/same-day is percent-priced. Not email-claim. | [Veem](https://www.veem.com/pricing/) |
| Airwallex | Beneficiary required. Stablecoin = early-access API, fee unknown. Weaker SSA mobile money vs Thunes (their own comparison). | [Airwallex vs Nium](https://www.airwallex.com/en-us/blog/comparison-nium-vs-airwallex) |
| dLocal | Enterprise is quote-only. Needs a local instrument. Go self-serve card is LATAM-weighted. | [dLocal 4Q25](https://www.globenewswire.com/news-release/2026/03/18/3258603/0/en/dLocal-Reports-2025-Fourth-Quarter-Financial-Results.html) |
| Thunes / Nium / Ebanx | Quote-only. Beneficiary required. Not a consumer claim UX. | [Nium fees](https://docs.nium.com/docs/fees-and-limits/fees) |
| Dots | Closest API peer. Still a Dots recipient object; Core international is **3.9%+$2**. Crypto 2–3%. Scale starts at **$999/mo**. | [Dots](https://usedots.com/pricing/) |
| Melio | US AP. Global is $20 or 1%+. Not email-claim, not USDC. | [Melio](https://melio.com/pricing/) |
| Modern Treasury / Increase | Need account numbers. US-rail (Increase). Sales/custom. Not a recipient UX. | [Increase](https://increase.com/fees); [MT](https://www.moderntreasury.com/pricing) |
| Routable | AP automation with vendor onboarding/tax. Official page has **no prices**. Not email-claim. | [Routable](https://www.routable.com/pricing/) |
| Payable | **Not a current product** — acquired by Stripe July 2017; domain redirects. | [Dealroom](https://app.dealroom.co/companies/payable) |

### Inferences
- The empty cell Loofta actually occupies is **small-dollar, pre-account, multi-rail claim** (US consumer apps **and** EM bank/USDC) at a fee **below Tremendous’s 4%** and **without Deel’s seat tax**. PayPal owns the cheap email-claim path but only into PayPal/Venmo and not into NG/PK/GH. Dots is the nearest API competitor and is expensive on international (3.9%+$2) unless the buyer is on $999 Scale.
- “Cannot do Zelle / Revolut as a claim destination” is true of the entire fetched table. Tremendous lists **Cash App** (US, 4%, instant). Nobody else on this list publishes Cash App or Zelle as a **business payout** destination. That is a real product gap — and also a compliance/risk gap those vendors chose not to open.
- Hyperwallet’s newly confirmed **$0.25 PYUSD** list price means PayPal already sells “payout a dollar token” at the same price as PayPal/Venmo wallet credit — but only after Enterprise onboarding, and only PYUSD (not self-custody USDC on Solana).

### Gaps
- Whether any Hyperwallet program can pay Cash App or Zelle (not on the Enterprise marketing list; list is bank, PayPal, Venmo, cards, wallets, eGift, cash pickup, PYUSD).
- Confirmation of Tango Payouts Link live cash methods and fees in 2026.
- Rybbon vs BHN Rewards vs Tango brand map (all Blackhawk; Tango portal is linked from the BHN pricing page).
