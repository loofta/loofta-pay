# Can brand social giveaways generate Loofta revenue at scale?

Research compiled 13 Oct 2026. Scope is brand giveaways as a *marketing practice* (prize GMV, frequency, industries), not contest-SaaS list prices. Prior notes in `research_notes/Stablecoin marketing rewards layer/` were read for context and are not copied here; this pass adds brand-usage evidence (Simpliers 2025 operational data, Giveaway Ninja May 2026 playbook, ESL FACEIT 2026 case study, Hootsuite/Sprout survey gaps, FTC/state bonding, Layer3 on-chain fee collapse, adjacent guaranteed-payout SKUs).

Loofta context used for the math: ~$800/mo from raids+giveaways; considering $15 + 5% of prize pool. A $1M take-rate business at 5% requires **$20M/year of cash-like prize GMV** that actually settles through Loofta.

---

## What % of brands/SMBs run giveaways? Any surveys (Hootsuite, Sprout, Later, Shopify)? Frequency (weekly, launch-only)?

### Takeaway
No 2025–2026 Hootsuite, Sprout Social, Later, or Shopify *brand-census* survey publishes “X% of brands/SMBs run giveaways.” The best primary operational dataset is Simpliers (comment-picker tool): Instagram is 88% of their giveaways; most accounts that run one do it **once**; a thin power-user tail (2.3% of accounts) runs 15+/year and produces 35% of volume. Shopify practice is **recurring monthly/quarterly for a minority of DTC operators**, not weekly for the median brand.

### Cited Findings
- Hootsuite’s Social Media Trends 2025 report is a commercial survey of **3,864 marketers in 99 countries (Aug 2024)**. The published table of contents covers creative disruption, outbound creator comments, social-performance listening, micro-virality, and AI — **not contests or giveaways**. — [Hootsuite Social Trends 2025 PDF](https://www.industryreports.co.za/sites/default/files/2025-03/HootsuiteSocialTrends2025_Report_en%20%281%29.pdf)
- Sprout Social’s 2026 social-statistics compilation reports **consumer interest**, not brand usage: **15% of Snapchat users** say they are interested in contests and giveaways (vs 29% entertainment, 12% influencer content). No “% of brands that run giveaways” figure appears. — [Sprout Social, 120+ Social Media Marketing Statistics for 2026](https://sproutsocial.com/insights/social-media-statistics/)
- Later.com: no 2025–2026 brand-giveaway adoption survey was found in this pass.
- Shopify itself does not publish a merchant-census of giveaway usage. Vendor-side evidence: Giveaway Ninja (May 2026 playbook) claims it has “powered thousands of giveaways” over six years and that “every single day, Shopify brands launch hundreds of tag-and-comment giveaways across Instagram and TikTok.” Treat as first-party vendor estimate, not a census. — [Giveaway Ninja, Shopify Giveaway Playbook, May 2026](https://www.giveaway.ninja/academy/shopify-giveaway-playbook)
- Simpliers (Instagram/TikTok/X comment-draw tool; data since March 2019, refreshed weekly) publishes **2025 operational stats from giveaways that actually drew a winner**:
  - Instagram is **88%** of Simpliers giveaways; other platforms **12%**.
  - **48.8%** of 2025 giveaways got more than 1,000 entries (entries = comments + likes).
  - **28.5%** of accounts that ran a giveaway in 2025 ran **at least one more** that year; those repeat accounts produced **72.4%** of all giveaways.
  - Accounts running **15+ giveaways/year are 2.3% of accounts but 35.4% of giveaways**.
  - Seasonality: worldwide Instagram peak in **December**; November ~60% of December volume; Valentine’s Day **2.6×** a normal day; International Women’s Day **2.3×**.
  - Median entries scale with followers but inefficiently: <1K followers median **469** entries; 500K+ median **4,986**.
  - Country filter includes US, UK, LATAM (AR, BR, MX, CO, CL, PE, UY, VE, DO), SEA (TH, ID), and EU. — [Simpliers Instagram Giveaway Trends](https://simpliers.com/en/giveaway/trends/instagram)
- GiftAFeeling’s June 2026 “59+ Giveaway Statistics” page cites a **survey of 378 marketers** with Facebook **92.6%**, Instagram **67.5%**, Twitter **20.6%**, and claims brands run giveaways **4–12 times/year** with **~30% monthly**. **No survey name, year, or firm is given.** The Facebook-first mix contradicts Simpliers’ 2025 Instagram-88% mix and looks like a recycled mid-2010s contest-SaaS survey. ElectroIQ reprints the same 92.6% figure. **Do not treat these as 2025–2026 brand census.** — [GiftAFeeling, Giveaway Statistics, 17 Jun 2026](https://www.giftafeeling.com/pages/giveaway-statistics-2026); [ElectroIQ giveaway statistics](https://electroiq.com/stats/giveaway-statistics/)
- Shopify App Store, Gleam Competitions (33 reviews, 3.9★ as of this pass): BridgeCom Systems (US) writes they have “used it every month for 6 years” for a monthly giveaway; The Chicken Coop Company hosted “multiple giveaways.” Negative reviews cluster on **billing/usage charges**, not on prize payout. — [Gleam on Shopify App Store](https://apps.shopify.com/gleam)
- Giveaway Ninja’s recommended cadence for *purchase-based* (not comment) campaigns: **monthly if you can, quarterly at minimum**; year-one target **6–12 campaigns**. Tag-and-comment is framed as a cheap complement, **one IG/TikTok hype campaign per quarter**. — [Giveaway Ninja playbook](https://www.giveaway.ninja/academy/shopify-giveaway-playbook)

### Inferences
- **Adoption is common as a *tactic*, not as a measured % of all brands.** Hootsuite’s 3,864-marketer survey omitting giveaways is itself a signal: contests are not a 2025 social-strategy headline the way AI, listening, and creator comments are.
- **Frequency is power-law, not weekly-for-everyone.** Simpliers: ~71.5% of giveaway-running accounts do **one** per year; a 2.3% tail is the “weekly/always-on” cohort. Shopify purchase-based operators (Giveaway Ninja ICP) are the always-on minority.
- **Do not equate “brands use giveaways” with “brands move cash through a prize rail.”** The high-volume format in 2025 is an Instagram comment contest (Simpliers) or a purchase-entry widget (Giveaway Ninja / Gleam) — both can run with **zero cash disbursement**.

### Gaps
- No Hootsuite / Sprout / Later / Shopify statistic for “% of brands that ran a giveaway in the last 12 months.”
- Simpliers is conditioned on *accounts that used Simpliers and drew a winner* — it undercounts native IG comment contests that pick a winner by hand, and over-represents comment-picker users vs Gleam landing-page users.
- GiftAFeeling/ElectroIQ 378-marketer figures cannot be dated or attributed.
- No split of SMB vs enterprise incidence.

---

## Typical prize: product, gift card, cash, crypto? Cash prize prevalence in US/EU vs LATAM/SEA

### Takeaway
The default Web2 brand prize in 2025–2026 is **the brand’s own product, merch, tickets, or a closed-loop credit** (Uber Cash, store gift card). Cash exists at the **enterprise-loyalty outlier** (Microsoft $1M) and at **fintech/EM promos** (UniFi PH ₱100k), not as the SMB Instagram default. US/EU legal structure (lottery test, NY/FL bonding above $5k, “no cash substitution” clauses) **pushes brands away from cash**. LATAM/SEA show more cash-shaped prizes in *fintech* campaigns, but no survey quantifies the mix.

### Cited Findings
- Giveaway Ninja’s explicit prize rule (May 2026): **“Don’t give away an iPhone, MacBook, or cash. Branded prizes only.”** Rationale: cash/iPhone attracts professional freebie hunters; branded SKUs filter for actual customers. Prize is described as **“one unit”** against paid orders that “lift revenue 5–20× the prize value.” — [Giveaway Ninja playbook](https://www.giveaway.ninja/academy/shopify-giveaway-playbook)
- UserLoop (Shopify contest app) fulfillment: the winner claim link **creates a discounted Shopify order from the store catalog**. Prize = SKU, not a cash transfer. — [UserLoop Contests](https://userloop.io/contests)
- ESL FACEIT Group (Gleam case study, 16 Mar 2026): **447+ giveaways over 10 years**; “Every single prize in the giveaways comes from our brand partners, so we effectively invest zero into it ourselves.” IEM Krakow 2026 prizes: Intel / ZOWIE / DHL / Red Bull / Kolex — **gaming hardware, CS2 starter boxes, event tickets**. ESL Pro League Season 20 public prize list: Intel i9-14900K, Logitech gear, Monster Energy, DHL box, signed jerseys, **5× €100 1xBet vouchers** (closed-loop betting credit, not cash). — [Gleam ESL FACEIT case study](https://gleam.io/success/esl-faceit-case-study); [ESL Pro League S20 giveaway](https://gleam.io/giveaways/Get0g)
- ESL / FACEIT official rules: prizes are **non-transferable, no cash redemptions**; one published merch prize ARV **$50**; DHL Drop prizes are CS2 skins + an Intel processor, “cannot be redeemed for cash.” — [ESL FACEIT giveaway T&Cs](https://eslfaceitgroup.com/giveaways/); [FACEIT EFG Drop T&Cs](https://support.faceit.com/hc/en-us/articles/18540922735516-EFG-Drop-Prize-Draw-Terms-and-Conditions)
- US counsel summary of promotional sweepstakes (2025–2026): a chance + prize + consideration = illegal lottery; brands must offer a free AMOE. **New York and Florida require pre-registration and bonding when the prize pool exceeds US$5,000**; Rhode Island registers above **US$500** if run through a retail establishment. — [ACC Corporate Counsel Now](https://corporatecounselnow.com/contracts-corner-play-rules-when-advising-promotional-sweepstakes)
- FTC (Apr 2025) sent **more than $18 million** in refunds to Publishers Clearing House sweepstakes consumers over dark-pattern “purchase improves odds” claims. The enforcement is about **entry deception**, not a ban on cash prizes — but it is the live US regulator signal on sweepstakes. — [FTC Lottery & Sweepstakes](https://www.ftc.gov/lottery-sweepstakes)
- Microsoft Rewards Ultimate Giveaway 2025: **$1,000,000 USD cash grand prize** plus daily instant prizes totaling another **$1,000,000**. Instant-win **$10,000** is a **check in the US/PR** and a **prepaid card in Canada, UK, France, Germany**. That is an enterprise loyalty sweepstakes with AMOE by mail, not a social-comment giveaway, and Microsoft already has payroll/rewards rails. — [Microsoft Rewards blog, Aug 2025](https://blogs.bing.com/rewards/2025/8/announcing-microsoft-rewards-ultimate-giveaway-more-prizes-more-winners/); [jorgep.com prize table](https://jorgep.com/blog/the-microsoft-rewards-ultimate-giveaway-2025/)
- Uber Eats Christmas 2025 sweepstakes: **3 winners × $500 Uber Cash** (ARV $1,500 total). Rules: Uber Cash is **not legal tender**, no cash equivalent. — [Uber official rules](https://www.uber.com/us/en/blog/2025-christmas-shop-and-deliver-with-uber-eats-uber-cash-sweepstakes-official-rules/)
- JSHealth (AU/EU/US, Jun 2025) advertised **US$5,000 cash or a US$1,000 gift card**; T&Cs excluded NY, FL, RI — consistent with the $5k bonding trigger. — [OzBargain listing](https://www.ozbargain.com.au/node/911065)
- Philippines fintech example: UniFi Aguinaldo Challenge — grand prize **₱100,000 (~US$1,700)**, 100× ₱1,000, weekly ₱500 cash. Mechanic is **spend/remit to earn entries**, not an Instagram follow raffle. — [UniFi blog](https://blog.unifi.co/digital-aguinaldo-challenge/)
- Tremendous (payout infra used by marketing and research teams): gift cards / prepaid / donations at **face value, $0 platform fee**; PayPal/Venmo/Cash App/bank at **4% sender-paid or 6% recipient-paid**. Catalog **2,200–2,500+ options, 200+ countries**. Amazon is the most popular US gift card; Visa prepaid is next. Tremendous’s own marketing-incentives page positions gift cards and money for **demos, referrals, contest winners, rebates, cashback** — i.e. the cash rail already exists for the minority of campaigns that want it, at 0–6%. — [Tremendous pricing](https://www.tremendous.com/pricing/); [Tremendous marketing incentives](https://www.tremendous.com/solutions/marketing-incentives/)
- GiftAFeeling’s “most popular giveaway items” table is **promotional products / swag** (drinkware 78%, apparel 70%, pens 60%) citing ASI-style promotional-product ROI ($5 per $1). That is **event swag**, not social-sweepstakes prize GMV. — [GiftAFeeling](https://www.giftafeeling.com/pages/giveaway-statistics-2026)

### Inferences
- **Cash-prize prevalence among SMB/DTC social giveaways is structurally low** because (1) the prize’s job is to *filter buyers*, (2) shipping your own SKU has ~100% margin optics and zero payout ops, (3) US/EU cash above a few thousand dollars trips bonding/tax, (4) Tremendous already settles gift cards at 0%.
- **US vs EU:** both prefer product/gift-card; when enterprise cash appears, EU/CA often gets **prepaid cards** rather than a check (Microsoft). Quebec registration is separately flagged by Giveaway Ninja.
- **LATAM/SEA:** more *cash-shaped* prizes show up in **fintech/remittance** promotions (UniFi PH) than in CPG Instagram. That is closer to Loofta’s EM payout story than to “P&G runs cash raffles.”
- **Crypto as a brand prize** for Web2 CPG/Shopify is not evidenced in this pass. Crypto prizes remain a Web3/TGE behavior.

### Gaps
- No survey (Hootsuite, IMH, Tremendous, Gleam) publishes a **cash / gift-card / product / crypto mix** of prize GMV.
- No LATAM/SEA brand-marketer survey on cash-prize willingness.
- Microsoft/Uber/JSHealth are existence proofs of cash or cash-like prizes, not a prevalence rate.

---

## Agency and CPG case studies: ESL, Shopify brands, gaming, CPG. Do they want cash rails or just an entry widget?

### Takeaway
The documented buyers want an **entry widget + compliance copy + email/CRM + sponsor action tracking**. They do **not** want a cash rail. ESL’s economic model is the opposite of Loofta’s: **sponsors donate product**, ESL invests $0 in prizes, Gleam proves sponsor ROI (follows, site visits). Shopify/CPG operators want **catalog SKUs and Klaviyo tags**. Cash rails are a Tremendous/PayPal job that Viral Loops already wires as an add-on.

### Cited Findings
- ESL FACEIT (Gleam, 16 Mar 2026): **1.27M+ participants, 29.5M actions, 447+ campaigns, 1M+ newsletter, 31.99% conversion**. Job-to-be-done quoted by Senior Director of Marketing Oliver Brix: convert broadcast viewers into **social follows and sponsor-channel follows**; “show our partners that they don’t only get eyeballs on their logo.” IEM Krakow 2026: 5,886 users, 68,326 actions, sponsor actions for Intel, DHL, Kolex, ZOWIE, Chexx, Red Bull. **Zero prize cash from ESL.** — [Gleam ESL FACEIT case study](https://gleam.io/success/esl-faceit-case-study)
- Gleam’s older ESL Cologne story (2016, still cited): 2M+ actions in one week; prize pool from NVIDIA, ASUS ROG, HyperX, Paysafe — hardware and sponsor goods, not USDC. — [Gleam ESL Cologne story](https://gleam.io/stories/esl)
- Giveaway Ninja 29-brand sample (vendor, unaudited): **>$32M tracked sales** (not prize GMV) across 25 verticals. Cluster mix: Collectibles/hobby/outdoor **~$13.9M** (7 brands); Vehicles/powersports **~$9.4M** (6); Apparel/merch/tech **~$4.07M** (4); **Beauty/wellness/CPG/F&B ~$3.43M** (9 brands — largest *count*, lowest AOV, list-build focus); Home/workwear/fitness **~$1.76M** (3). Smallest brand ~$120k tracked sales; largest ~$10M. Playbook: prize = branded SKU; success metric = **revenue per entry net of prize cost**. — [Giveaway Ninja playbook](https://www.giveaway.ninja/academy/shopify-giveaway-playbook)
- Floafers (EVA foam shoes, Vyper-attributed case, recycled on GiftAFeeling): **6,557 entries, $8,263 sales, 633% email growth**. Prize not specified as cash; outcome is **list + leftover-inventory sales**. — [GiftAFeeling / Vyper Floafers](https://www.giftafeeling.com/pages/giveaway-statistics-2026)
- Gleam Shopify reviews describe **monthly product giveaways** and email-list export, not payout. — [Gleam Shopify reviews](https://apps.shopify.com/gleam/reviews)
- Viral Loops Growing plan includes **“Automated Rewarding,” Stripe rewarding, Tremendous rewarding** — the Web2 stack is already **widget + optional fiat/gift-card payout**, without crypto escrow. Viral Loops is a referral/viral campaign tool, not a cash-prize marketplace. — [Viral Loops pricing](https://viral-loops.com/pricing)
- Klaviyo’s official contest guidance: treat giveaway sign-ups as a **separate list**, do not dump them into the main list until they confirm marketing interest — i.e. the asset is **email**, not prize settlement. — [Klaviyo, target contest entrants](https://help.klaviyo.com/hc/en-us/articles/360036881312)

### Inferences
- **ESL/gaming agencies want Gleam, not Loofta.** The sponsor pays in **product COGS + media rights**; the operator’s scarce resource is a verified action widget that produces a PDF of “135k follows for Intel.”
- **Shopify/CPG want a sales mechanic.** Giveaway Ninja’s $32M is **GMV of customer orders during the campaign**, which never touches a prize-escrow wallet. A 5% take on the *prize* (one SKU) is a rounding error next to the *sales* the brand already keeps.
- **Agencies are a seat buyer** (multi-site Woobox/Gleam) and a **distribution channel**, not the prize-budget owner. Prize budget sits on the brand or the sponsor.
- A cash rail is only requested when the prize is cash — which these case studies actively avoid.

### Gaps
- No published invoice showing a CPG brand paying a third party to *disburse* contest cash in 2025–2026 (Tremendous case studies on marketing incentives exist as category marketing, not CPG giveaway GMV).
- No independent audit of Giveaway Ninja’s $32M / “$3M a month through our app” claims.
- No 2025–2026 P&G / Unilever / Nestlé social-sweepstakes budget line.

---

## Crypto/Web3 giveaway spend vs Web2. TGE seasonality. Layer3/Galxe/Zealy GMV as analogue

### Takeaway
Web3 is the only place where **prize/reward GMV is the campaign**, and it is **tens to low-hundreds of millions lifetime, highly TGE-cyclical**. Layer3 claims **$285M+ client-funded rewards** and **$16.6M 2024 revenue / $20M+ 2025 ARR**; DefiLlama’s *on-chain Cube-mint fee* series then **collapses from $1.11M in Q2 2025 to $4.17k in Q4 2026** — a hard 2025–2026 seasonality print. Web2 prize *cash* GMV is not in the same order of magnitude. Loofta’s ~$800/mo sits on the Web3 raid/giveaway slice, not the Shopify slice.

### Cited Findings
- Presto Research (20 Oct 2025): Layer3 **$16.6M revenue in 2024 (10× YoY)**, projected **$20M+ ARR for 2025**, **500+ protocol clients**, **3.2M users**, **$285M+ rewards distributed**, **~98.6% of reward value from client budgets** (~$4M native L3), implied **~$40k ARPU**, inferred **~5–10% take**. Risks listed: quest fatigue, mercenary users, **“slowdown in new TGEs and a macro VC freeze.”** — [Presto Research](https://www.prestolabs.io/research/everyones-chasing-airdrops-layer3-is-selling-the-tools)
- Greenfield Capital follow-on (21 Feb 2025) repeats the **$16.6M / team of 16 / profitable** figures and $4M additional $L3 accumulation. — [Greenfield Layer3 thesis](https://greenfieldcapital.com/2025/02/21/layer3-l3-follow-on-investment-thesis/)
- DefiLlama Layer3 income statement (protocol Cube-minting fees, not the full off-chain SaaS number): **Q2 2025 $1.11M → Q3 2025 $338.64k → Q4 2025 $176.01k → Q1 2026 $79.02k → Q2 2026 $61.81k → Q3 2026 $42.19k → Q4 2026* $4.17k**. Trailing annualized revenue on this series **~$343k**. **Conflict with Presto’s $20M ARR:** DefiLlama is on-chain mint fees only; Presto is a research claim of total company revenue. Report both; do not add them. The *shape* of the on-chain series is a **TGE/airdrop winter**. — [DefiLlama Layer3](https://defillama.com/protocol/layer3)
- Galxe 2025 (Blockworks Intel): **~184 million quest participations**, **1.9M unique participant addresses/month** (peak 2.6M in June, low 1.3M in December — intra-year seasonality). Inaugural zkRaffle quest prize pool **300,000 G**. Galxe still sells Business+ seats (Essentials **$999/mo annual**). Starboard (InfoFi) launched with **$5M campaign rewards** then was later retired (3 Aug 2026, per prior/competitor notes). — [Blockworks Intel, Galxe](https://app.blockworks.com/report/galxe-the-web3-growth-engine)
- Intract Quest sunset **12 Jan 2026**; farewell claims **$10M+ rewards** lifetime, then weekly users **1M → <50k**. — [quest.intract.io](https://quest.intract.io/)
- Agency band for a typical quest campaign remains **$1,000–$20,000 all-in** including rewards (Suniko, 2026). — [Suniko, Quest platforms](https://suniko.agency/quest-platforms-for-crypto-marketing-galxe-vs-layer3-vs-zealy-a-founders-guide/)
- Zealy shipped **custodial USDC lock-and-auto-payout** on 17 Sep 2025; raffle USDC quests need **≥$100** and end within 14 days to feature on Earn. SaaS **$0 / $149 / $359/mo**. — [Zealy USDC Rewards changelog](https://zealy.io/changelog/2025-09-17-usdc-rewards)
- Web2 analogue for *prize GMV* (not software): Giveaway Ninja’s 29-brand **$32M is sales, not prizes**. If prize cost is “one unit” and campaigns “lift 5–20× prize value,” implied prize COGS on $32M sales is roughly **$1.6M–$6.4M across the whole multi-year sample**, i.e. **low-single-digit millions of product**, not cash. — constructed from [Giveaway Ninja playbook](https://www.giveaway.ninja/academy/shopify-giveaway-playbook)
- FMI (paywalled teaser) puts the *online sweepstakes platform* software market at **USD 127.1M in 2025**. Viral Loops, the only audited-enough public comp, did **CA$1.3M revenue in 2025**. — [Future Market Insights listing](https://www.futuremarketinsights.com/reports/online-sweepstakes-platform-market); [EMERGE acquisition PR](https://www.newswire.ca/news-releases/emerge-completes-acquisition-of-viral-loops-launching-profitable-b2b-vertical-866545544.html)

### Inferences
- **Web3 reward GMV >> Web2 cash-prize GMV.** Layer3’s $285M lifetime client rewards is the existence proof that a take-rate on *campaign rewards* can be a >$1M business — **inside crypto, in a TGE year**.
- **2025–2026 is the downcycle.** Galxe unique participants **halved from June to December 2025**; Layer3 on-chain fees **fell ~99.6% from Q2 2025 to Q4 2026**; Intract died. Underwriting 2026 Loofta growth on 2024 Layer3 numbers would be a mistake.
- **Web2 prize GMV is mostly in-kind.** Even a generous 5% take on Giveaway Ninja-implied prize COGS is **software-scale**, and the brand would not route a toaster through USDC escrow.
- Loofta’s **$800/mo (~$9.6k ARR)** is consistent with a thin slice of the cheap crypto-raid/giveaway band ($20–$525 pots), not with Layer3’s $40k ARPU protocols.

### Gaps
- No independent 2025 or 2026 *annual* reward GMV for Galxe, Zealy, or the whole quest category.
- Presto $16.6M / $20M ARR is not a 10-K; DefiLlama does not capture off-chain invoices.
- No head-to-head “dollars of Web2 cash prizes vs Web3 token rewards” dataset.

---

## Why Rafflecopter died (2025). Viral Loops sold for ~CA$2.3M. What does that say about scale?

### Takeaway
Rafflecopter’s 15-year widget died on **1 Oct 2025** with **no official cause**. The most credible reconstruction is **category decay**: website-embed giveaways lost to native Instagram/TikTok comment contests (exactly Simpliers’ 88% IG share), aging infra, and price compression ($0–$49 tools). Viral Loops sold for **CA$2.3M on CA$1.3M 2025 revenue / CA$800k Adj. EBITDA (~2.9×)** — a **profitable lifestyle B2B**, sold by Wishpond to pay down debt. Together they say the Web2 contest/referral-campaign category **clears at low-single-digit millions**, not venture scale, and **does not imply large prize-pool GMV**.

### Cited Findings
- Official farewell: “After 15 amazing years, the Rafflecopter platform shut down on October 1, 2025… millions of giveaways—run by everyone from bloggers to Fortune 500 brands.” **No reason stated.** Paying customers offered a late data export. — [rafflecopter.com](https://www.rafflecopter.com/)
- ContestQueen and MoneySavingExpert (Sep 2025) reprint the same notice; forum users note **bloggers** as the core user, not enterprise CMOs. — [ContestQueen](https://www.contestqueen.com/2025/the-end-of-rafflecopter/); [MSE forum](https://forums.moneysavingexpert.com/discussion/6629319/rafflecopter-is-closing-down)
- A later site, rafflecopter.app (“Rafflecopter is Back”), claims the original shutdown reasons were **“aging infrastructure, changing market conditions, and the inability to keep up with the shift from website-based giveaways to social media comment-based contests on Instagram, TikTok, and YouTube,”** and that “over 2 million creators” lost the tool. **This is a successor-brand marketing page, not the original company’s post-mortem.** — [rafflecopter.app blog](https://rafflecopter.app/blog/rafflecopter-is-back)
- KingSumo remains **$49 lifetime**; Gleam Competitions from **$29/mo** (Shopify listing also shows **$59/mo** Pro). Low willingness-to-pay for the widget. — [RafflePress KingSumo review](https://rafflepress.com/kingsumo-review/); [Gleam Shopify](https://apps.shopify.com/gleam)
- EMERGE completed the Viral Loops acquisition **10 Mar 2026** from Wishpond: **CA$2.1M at close + CA$200k deferred = CA$2.3M**; 2025 unaudited **CA$1.3M revenue, ~86% GM, CA$800k Adj. EBITDA (~62% margin)**; **~2.9× Adj. EBITDA / ~3.3× cash flow ($700k)**. Described as “hundreds” of B2B clients. First EMERGE B2B vertical. — [EMERGE closes deal](https://www.newswire.ca/news-releases/emerge-completes-acquisition-of-viral-loops-launching-profitable-b2b-vertical-866545544.html); [EMERGE cash-flow addendum](https://www.newswire.ca/news-releases/emerge-provides-cash-flow-figures-for-viral-loops-878343067.html)
- Wishpond (seller) used **~$1.6M of proceeds to repay its senior credit facility**. Viral Loops was originally acquired by Wishpond in **April 2022** and flipped in 2026. — [Wishpond sale PR](https://www.prnewswire.com/news-releases/wishpond-announces-closing-of-sale-of-viral-loops-for-2-3-million-302708733.html)

### Inferences
- **Rafflecopter did not die because brands stopped running giveaways.** Simpliers and Giveaway Ninja show the *practice* is alive. It died because the **widget was disintermediated by native comments** and the remaining SaaS was too cheap/churny to fund a rebuild.
- **Viral Loops at CA$1.3M / 2.9× EBITDA is the public comps for “we own referral + tempting-giveaway SaaS.”** A take-rate on prize pools is **not how this category makes money**. If prize GMV behind Viral Loops were large, the acquirer would have talked about GMV; they talked about **margin and cash flow**.
- Scale implication for Loofta: **beating Gleam/Viral Loops on contest UX is a sub-$2M outcome.** A $1M *take-rate* business has to sit on **payout GMV**, which these exits prove is not what Web2 contest software captures.

### Gaps
- No original-company Rafflecopter financials, user count, or board memo.
- “2 million creators” on rafflecopter.app is unsourced.
- No public Gleam revenue to compare with Viral Loops’ CA$1.3M.

---

## Adjacent bigger pots: referral cash, ambassador bonuses, user-research incentives, UGC bounties — are those “giveaways” or different SKUs?

### Takeaway
They are **different SKUs**: guaranteed pay for a completed action (refer, sit a study, post UGC), not a chance-based prize pool. The pots are **larger and already intermediated** (Tremendous 0–6%, UserTesting PayPal, Insense 7–20%, Viral Loops + Stripe). Loofta can honestly sell into these *only* as a **payout rail** (especially EM), not by relabeling them “giveaways.” Chance-based giveaways are the *small* pot.

### Cited Findings
- **Referral cash (product, not raffle):** Viral Loops’ core SKU is referral/waitlist campaigns; Growing plan already pays via **Stripe and Tremendous**. Revolut-style fintech referrals pay **in-app ledger credit** gated on card spend, not USDC to strangers. — [Viral Loops pricing](https://viral-loops.com/pricing)
- **User-research incentives:** UserTesting pays contributors via **PayPal, 14 days after completion**; amount varies by test type and is shown before apply. — [UserTesting participant compensation, 16 Sep 2026](https://help.usertesting.com/hc/en-us/articles/11880240002845-Participant-compensation)
- User Interviews participant referrals: **$10/$10** for a first completed study, **$30/$30** for a featured study, paid **only through Tremendous** (gift cards / prepaid / donations; “not able to offer alternative forms of payment”). Researcher-to-researcher referral: **$50 gift card via Tremendous** after 3 paid Recruit sessions. — [User Interviews referrals](https://www.userinterviews.com/support/referrals); [User Interviews researcher referrals](https://www.userinterviews.com/support/researcher-referrals)
- Respondent.io: **$50** per friend who earns **$75** in studies, **uncapped**, via Tremendous, 7–10 days. — [Respondent refer-friends](https://www.respondent.io/refer-friends)
- Tremendous Forsta case (prior-pass, still the scale marker): **>$2M to 175,000 participants in 100+ countries since 2018** — ~$250–350k/year GMV for a 2,500-customer research platform, i.e. **tiny per brand, large in aggregate at the platform**. — [Tremendous Forsta](https://www.tremendous.com/case-studies/tremendous-helps-forsta-send-2-million-in-research-incentives-in-100-countries/)
- **UGC / ambassador / creator bounties:** Relish (local CPG/restaurant UGC) pays creators roughly **$50–$100 cash plus comps**. Insense charges **7–20% on creator pay** plus $400–$650/mo SaaS. These are **invoices for deliverables**, not raffles. Giveaway Ninja’s “Ambassador Awakening” recipe is a **refer-a-friend leaderboard with a top-referrer prize** — still a sweepstakes skin on a referral program. — [Relish campaigns](https://tryrelish.com/campaigns); Giveaway Ninja playbook recipe 7
- **Affiliate/cashback** (orders of magnitude larger, not a giveaway): US affiliate advertiser spend **$13.62B in 2024 (PMA)**; Impact paid **$4.5B to partners** on **$100B GMV**. Loyalty/rewards publishers closed **55% of affiliate transactions in H1 2026**. — [PMA 2025 study](https://thepma.org/pma-study-affiliate-marketing-industry-grows-49-8-to-13-63-b-outpacing-e-commerce-growth-by-2x/)

### Inferences
- **Taxonomy that matters for Loofta:**
  | Job | Chance? | Who gets paid | Typical unit | Intermediary today | Same SKU as “giveaway”? |
  |---|---|---|---|---|---|
  | Social sweepstakes | Yes | 1–N winners | Product / $50–$500 | Gleam + ship SKU | **This SKU** |
  | Referral cash | No (or hybrid) | Every qualifier | $10–$50 | Viral Loops + Tremendous | **No — campaign + payout** |
  | Research incentive | No | Every completer | $5–$75 | Tremendous / PayPal | **No — ops payout** |
  | UGC / ambassador | No | Every accepted asset | $50–$2,000 | Insense / Aspire / Relish | **No — creator invoice** |
  | Affiliate / cashback | No | Every sale | % of GMV | Impact / Awin / Rakuten | **No — performance network** |
  | Crypto quest / raid | Mixed | Many wallets | $10–$20k pots | Galxe / Zealy / Layer3 | **Closest cousin** |
- The **bigger pots are the guaranteed-pay rows**. Calling them “giveaways” would mis-sell legal (sweepstakes vs compensation), buyer (insights ops / creator ops vs social manager), and competitor (Tremendous vs Gleam).
- A Loofta wedge on adjacent SKUs is **EM cash vs Tremendous 4–6% / PayPal gaps**, not “we run your raffle.”

### Gaps
- No 2025–2026 dollar TAM that isolates “marketing referral cash” from affiliate commissions.
- No public ambassador-program cash-bonus census.
- UserTesting does not publish average incentive or annual GMV.

---

## Honest answer: can giveaways generate Loofta revenue at scale (yes / no / only-if), with the GMV math?

### Takeaway
**Only-if — and not on Web2 brand social giveaways.** Chance-based brand giveaways are a **widely used marketing practice** whose economic value is **email + attributed sales + sponsor follows**. The money that moves as *cash prizes* is structurally small; the money that moves as *product* never needs a USDC escrow. A 5% take becomes $1M only if Loofta captures **~$20M/year of cash-like campaign GMV**. That exists in **crypto quests/raids in a hot TGE year** (and in adjacent guaranteed-pay SKUs), not in Shopify/ESL-style giveaways. At today’s ~$800/mo, the giveaway SKU is a **beachhead, not the scale path**.

### Cited Findings
- Arithmetic: **$1,000,000 / 0.05 = $20,000,000** cash-like prize GMV/year. At $15 + 5%: a $200 prize yields **$25** revenue; you need **~40,000 such campaigns/year** for $1M from the $15, or **$20M GMV** from the 5%. A $1,000 USDC raid yields **$65**; you need **~15,400 campaigns/year** on fee mix alone, or far fewer large pots.
- Loofta current run-rate in the brief: **~$800/month** from raids + giveaways ≈ **$9,600 ARR**. At 5% that implies **~$16k/month of prize GMV** (~$192k/year) — consistent with many small crypto pots, not 100 brands × $15k.
- Web2 contest software comps: Viral Loops **CA$1.3M revenue**, sold **CA$2.3M**; FMI software market teaser **~$127M**; Rafflecopter **dead**. These are **seat businesses**. — [EMERGE](https://www.newswire.ca/news-releases/emerge-completes-acquisition-of-viral-loops-launching-profitable-b2b-vertical-866545544.html)
- Web2 prize *practice*: ESL **$0 cash**; Giveaway Ninja **“don’t give away cash”**; UserLoop **Shopify order**; Uber **closed-loop credit**; NY/FL **bond above $5k**. — sources in prize-mix section
- Web3 analogue where take-rate *did* clear $1M: Layer3 **$16.6M 2024 revenue** on **$285M+ lifetime client rewards** (Presto). Same analogue is **cooling in 2026** on DefiLlama’s fee series. — [Presto](https://www.prestolabs.io/research/everyones-chasing-airdrops-layer3-is-selling-the-tools); [DefiLlama](https://defillama.com/protocol/layer3)
- Legal: chance + prize + consideration without a robust AMOE is an **illegal lottery** in the US; FTC is actively enforcing sweepstakes deception (PCH, Apr 2025). Crypto USDC raffles for social tasks inherit this, plus securities/gambling overlays. — [ACC](https://corporatecounselnow.com/contracts-corner-play-rules-when-advising-promotional-sweepstakes); [FTC](https://www.ftc.gov/lottery-sweepstakes)
- Adjacent guaranteed-pay: Tremendous already prices cash at **4–6%** (in-market with Loofta’s 5%) and gift cards at **0%**. Research/referral/UGC buyers already have a rail. — [Tremendous pricing](https://www.tremendous.com/pricing/)

**Worked GMV cases (labeled as constructs from cited bands):**

| Path | Prize/reward GMV you must own | 5% revenue | Realistic? |
|---|---|---|---|
| A. Shopify/ESL social giveaways (product) | Brands will not escrow SKUs as USDC | ~$0 take-rate | **No** |
| B. Web2 *cash* social prizes at $200 × 10,000 campaigns | $2M | $100k | Unrealistic volume of *cash* prizes |
| C. 100 brands × $15k/mo cash giveaways | $18M | $900k | **Not realistic** vs observed $50–$500 product prizes |
| D. Crypto quest/raid GMV in a hot TGE year, 10–20% category share of a $40–80M pot | $4–16M | $200k–$800k | **Possible**, cyclical, Zealy/Galxe/Layer3 already sit here |
| E. Layer3-like: 25 protocols × $40k ACV (SaaS, not 5%) | n/a | $1M | **Yes, but that is crypto SaaS**, not brand giveaways |
| F. 2–8 payout platforms (research / creator / clipping) routing cash at 5% | $20M | $1M | **Yes, different SKU** |
| G. Stay at ~$800/mo raids | ~$0.2M | ~$10k | Current state |

### Inferences
- **No** — Web2 brand giveaways cannot carry a $1M Loofta take-rate. The practice is real and common; the **cash prize GMV is the wrong numerator**. Prior research’s “prize GMV is tiny vs creator invoices” still holds; this pass adds *why*: CPG/Shopify/ESL optimize for **owned audience and sponsor proof**, and they are told by their own vendors **not to give cash**.
- **Only-if (crypto):** keep the current SKU as a TGE/raid beachhead, accept cyclicality, and do not need 100 CPG logos. $1M is conceivable if Loofta becomes a default **USDC escrow + draw + payout** for a meaningful share of quest/raid pots *and* the cycle turns up. 2026 public data says the cycle is down.
- **Only-if (leave crypto):** stop selling “giveaways” to brand CMOs. Sell **campaign-shaped guaranteed payouts** (raid leaderboards with quality bars, UGC bounties, research incentives, creator/clipper payroll) in corridors where PayPal/Tremendous cash is weak. That is a Tremendous/Stripe competitor, not a Gleam competitor.
- **Pricing:** $15 + 5% on a $200 product prize is **the same band as a month of Gleam** and **worse than Tremendous gift cards at 0%**. It only wins when the prize is **USDC the brand cannot easily send**, i.e. crypto-native or EM cash.

### Gaps
- Loofta internal campaign-size distribution (median pot, logo count) was not in public sources; $800/mo is from the assignment brief.
- No third-party TAM titled “global cash prize GMV for brand social giveaways.” Absence is the finding: the industry does not even account the number, because the prize is usually a SKU.
- Legal opinion on USDC raffles-for-follows is out of scope; flag only.
