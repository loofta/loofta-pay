// @ts-nocheck

export class SpecComponent {
  _privyHandle = '';
  state = { cap: 20, tokHits: null, tokStatus: '', split: 'top10', reward: 'tickets', raidToken: '', raidTokenMint: '', raidTokenLogo: '', raidTokenPrice: null, raidTokQ: '', raidTokOpen: false, usdBudget: '250', earnUsd: { like: 0.05, repost: 0.1, quote: 0.25, reply: 0.25 }, picked: [0], pickedIds: [], xPosts: [], xPostsFor: '', xHandle: '', postLink: '', postsNote: '', mode: 'oneoff', xConnected: false, scope: 'all', plan: 'growth', freq: '1w', annual: false, earn: { like: 1, repost: 2, quote: 5, reply: 3 }, streak: '2x', faq: 0, w: 1200, gw: null, savedAt: 0, launchStep: null, signMethod: null, fundMethod: 'card' };
  createRef = el => { this._c = el; };
  componentDidMount() {
    this._r = () => this.setState({ w: window.innerWidth, now: Date.now() }); this._r(); window.addEventListener('resize', this._r);
    try { const d = JSON.parse(localStorage.getItem('loofta-gw-draft') || 'null'); if (d) this.setState({ gw: { ...d, tokOpen: false }, restored: true }); } catch (e) {}
  }
  componentWillUnmount() { window.removeEventListener('resize', this._r); clearTimeout(this._t); }
  toCreate = () => { const el = this._c; if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: 'smooth' }); };
  gwVals(s, set, money) {
    const g = { minF: '', maxP: '', minTier: '', age: '', regions: '', requiredCountries: [], excludedCountries: [], requiredContinents: [], kyc: false, title: '', project: '', desc: '', prize: 'usdc', token: 'BONK', amount: '100', tickets: '1', winners: 10, tasks: [{ type: 'follow', val: '@looftaxyz' }], tokQ: '', tokOpen: false, close: '1w', more: false, pick: 'random', verified: false, email: 'lisa.bechina@gmail.com', submitted: false, ...(s.gw || {}) };
    const up = o => this.setState(st => { const gw = { ...g, ...(st.gw || {}), ...o }; try { localStorage.setItem('loofta-gw-draft', JSON.stringify(gw)); } catch (e) {} return { gw, savedAt: Date.now() }; });
    const sel = on => ({ bg: on ? 'rgba(255,90,26,0.12)' : '#0E0E12', color: on ? '#F2EFE8' : '#9A98A3', border: on ? 'rgba(255,122,42,0.7)' : 'rgba(255,255,255,0.08)' });
    const isT = g.prize === 'tickets', isTok = g.prize === 'token';
    const amt = parseFloat(g.amount) || 0, tix = parseInt(g.tickets) || 0;
    const winnersN = Math.min(500, Math.max(1, parseInt(g.winners, 10) || 1));
    const per = isT ? tix : amt / winnersN;
    const cost = isT ? tix * winnersN : amt;
    const fee = cost > 0 ? Math.max(5, cost * 0.10) : 0;
    const PRICE = { SOL: 152.3, BONK: 0.0000214, JUP: 0.82, WIF: 1.94, USDT: 1, JTO: 2.31, PYTH: 0.29, RAY: 3.12, POPCAT: 0.41, TRUMP: 9.6 };
    const px = (typeof g.tokenPrice === 'number' && g.tokenPrice > 0) ? g.tokenPrice : (PRICE[g.token] || 1), fmtTok = n => n >= 1000 ? Math.round(n).toLocaleString('en-US') : n >= 1 ? n.toFixed(2) : n.toPrecision(3);
    const TOK = { SOL: '#9945FF', BONK: '#F7A400', JUP: '#22C4A5', WIF: '#C8A27C', USDT: '#26A17B', JTO: '#6CC4A1', PYTH: '#7142CF', RAY: '#3A6BE0', POPCAT: '#E0B33A', TRUMP: '#C9A04A' };
    const TT = { follow: ['Follow on X', 'x', '#000', '@account to follow'], engage: ['Engage with a post', 'x', '#000', 'Link to the post on X'], post: ['Post on X', 'x', '#000', 'Exact text they must post'], tg: ['Join Telegram', 'tg', '#229ED9', 't.me/ invite link'], discord: ['Join Discord', 'dc', '#5865F2', 'discord.gg/ invite link'], custom: ['Custom task', 'c', '#FF5A1A', 'What should they do?'] };
    const ic = k => ({ isX: TT[k][1] === 'x', isTg: TT[k][1] === 'tg', isDc: TT[k][1] === 'dc', isCustom: TT[k][1] === 'c', bg: TT[k][2] });
    const ACTS = [['like', 'Like'], ['repost', 'Repost'], ['comment', 'Comment']];
    const engLabel = t => { const a = t.acts || ['like', 'repost']; if (!a.length) return 'Engage with a post'; const cap = a.join(', ').replace(/, ([^,]*)$/, ' and $1'); return cap[0].toUpperCase() + cap.slice(1) + ' the post'; };
    const tasks = (g.tasks || []).map(t => typeof t === 'string' ? { type: t, val: '' } : t).map(t => t.type === 'repost' || t.type === 'like' ? { type: 'engage', val: t.val, acts: [t.type], quote: false } : t).filter(t => TT[t.type]);
    const setTasks = fn => this.setState(st => { const cur = { ...g, ...(st.gw || {}) }; const list = (cur.tasks || []).map(t => typeof t === 'string' ? { type: t, val: '' } : t); const gw = { ...cur, tasks: fn(list) }; try { localStorage.setItem('loofta-gw-draft', JSON.stringify(gw)); } catch (e) {} return { gw, savedAt: Date.now() }; });
    const TOKL = [['SOL', 'Solana', '#9945FF', 'So11111111111111111111111111111111111111112'], ['BONK', 'Bonk', '#F7A400', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'], ['JUP', 'Jupiter', '#22C4A5', 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'], ['WIF', 'dogwifhat', '#C8A27C', 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'], ['USDT', 'Tether USD', '#26A17B', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'], ['JTO', 'Jito', '#6CC4A1', 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL'], ['PYTH', 'Pyth Network', '#7142CF', 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3'], ['RAY', 'Raydium', '#3A6BE0', '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R'], ['POPCAT', 'Popcat', '#E0B33A', '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr'], ['TRUMP', 'Official Trump', '#C9A04A', '6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN']];
    const qRaw = (g.tokQ || '').trim();
    const q = qRaw.toLowerCase();
    const tokRes = TOKL.filter(t => !q || t[0].toLowerCase().includes(q) || t[1].toLowerCase().includes(q));
    const iconFor = mint => mint && String(mint).length >= 32 ? '/api/giveaways/token-icon?mint=' + encodeURIComponent(mint) : '';
    const shortMint = mint => { const m = String(mint || ''); return m.length > 12 ? m.slice(0, 4) + '…' + m.slice(-4) : m; };
    const CLOSE = [['24h', '24 hours', 1], ['3d', '3 days', 3], ['1w', '1 week', 7], ['2w', '2 weeks', 14], ['custom', 'Pick a date', 0]];
    const p2 = x => String(x).padStart(2, '0'), ymd = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    const nowD = new Date(s.now || Date.UTC(2026, 9, 12, 4, 0, 0)); const defD = new Date(nowD.getTime() + 10 * 864e5);
    const cDate = g.closeDate || ymd(defD), cTime = g.closeTime || '18:00';
    const closeAt = g.close === 'custom' ? new Date(cDate + 'T' + cTime) : new Date(nowD.getTime() + CLOSE.find(c => c[0] === g.close)[2] * 864e5);
    const left = Math.max(0, closeAt - nowD), dl = Math.floor(left / 864e5), hl = Math.floor(left % 864e5 / 36e5);
    const closeAtStr = isNaN(closeAt) ? '—' : closeAt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' at ' + closeAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const PICK = [['random', 'Random draw'], ['first', 'First come'], ['manual', "I'll pick"]];
    const unit = isT ? 'Jackpot tickets' : isTok ? g.token : 'USDC';
    const T3 = (a, b, rim) => ({ tile: 'radial-gradient(120% 120% at 28% 18%,' + a + ')', shadow: 'inset 0 2px 4px rgba(255,255,255,0.5),0 3px 0 ' + rim, ink: b });
    return {
      gwSubmitted: g.submitted, gwEditing: !g.submitted,
      gwTitle: g.title, onGwTitle: e => up({ title: e.target.value }),
      gwPrizeTypes: [['usdc', 'USDC', 'Cash prize', '$', ...Object.values(T3('#9CC8FF 0%,#2775CA 48%,#1A55A0 100%', '#fff', '#123E78'))], ['token', 'Any token', 'On Solana', '◎', ...Object.values(T3('#D7B4FF 0%,#9945FF 48%,#6420C8 100%', '#fff', '#4A1698'))], ['tickets', 'Jackpot tickets', '$1.1M+ prize pool', '🎟', ...Object.values(T3('#FFF0B8 0%,#F5B70C 42%,#D17A04 100%', '#6A3500', '#8E5202'))]].map(([k, label, sub, glyph, tile, shadow, ink]) => ({ label, sub, isUsdc: k === 'usdc', isTok: k === 'token', isTix: k === 'tickets', tile, shadow, ink, set: () => up({ prize: k }), bg: g.prize === k ? 'rgba(255,90,26,0.1)' : '#0E0E12', border: g.prize === k ? 'rgba(255,122,42,0.75)' : 'rgba(255,255,255,0.07)' })),
      gwIsToken: isTok, gwIsTickets: isT, gwNotTickets: !isT, gwToken: g.token,
      gwTokQ: g.tokQ, onGwTokQ: e => up({ tokQ: e.target.value, tokOpen: true }), gwTokFocus: () => up({ tokOpen: true }),
      gwTokOpen: g.tokOpen, gwTokPicked: !g.tokOpen || !g.tokQ, gwTokBorder: g.tokOpen ? 'rgba(255,122,42,0.6)' : 'rgba(255,255,255,0.08)',
      gwTokDot: (TOKL.find(t => t[0] === g.token) || [0, 0, '#9945FF'])[2],
      gwTokLogo: g.tokenLogo || iconFor((TOKL.find(t => t[0] === g.token) || [])[3]),
      gwHasTokLogo: !!(g.tokenLogo || iconFor((TOKL.find(t => t[0] === g.token) || [])[3])),
      gwNoTokLogo: !(g.tokenLogo || iconFor((TOKL.find(t => t[0] === g.token) || [])[3])),
      gwTokSearching: s.tokStatus === 'loading',
      gwTokResults: (() => {
        const asRow = (sym, name, dot, mint, logo, price) => ({ sym, name, dot, mint: shortMint(mint), hasLogo: !!logo, noLogo: !logo, logo: logo || '', set: () => up({ token: sym, tokenMint: mint, tokenLogo: logo || '', tokenPrice: typeof price === 'number' ? price : null, tokQ: '', tokOpen: false }) });
        if (qRaw.length >= 2 && Array.isArray(s.tokHits)) {
          const rows = s.tokHits.map(t => asRow(t.symbol, t.name, '#3A3A44', t.mint, t.logo ? iconFor(t.mint) : '', t.usdPrice));
          if (!rows.length && qRaw.length >= 32 && s.tokStatus !== 'loading') return [asRow(qRaw.slice(0, 4).toUpperCase() + '…', 'Token at pasted address', '#3A3A44', qRaw, '', null)];
          return rows;
        }
        return tokRes.map(([sym, name, dot, mint]) => asRow(sym, name, dot, mint, iconFor(mint), PRICE[sym] || null));
      })(),
      gwTokNone: qRaw.length >= 2 && s.tokStatus !== 'loading' && Array.isArray(s.tokHits) && s.tokHits.length === 0 && qRaw.length < 32,
      gwAmountLabel: isT ? 'TICKETS PER WINNER' : isTok ? 'TOTAL VALUE (USD)' : 'TOTAL PRIZE',
      gwShowDollar: !isT, gwAmount: isT ? g.tickets : g.amount,
      onGwAmount: e => { const v = e.target.value.replace(/[^0-9.]/g, '').slice(0, 7); up(isT ? { tickets: v.replace('.', '') } : { amount: v }); },
      gwWinners: g.winners === '' ? '' : String(winnersN),
      onGwWinners: e => { const v = e.target.value.replace(/\D/g, '').slice(0, 3); up({ winners: v }); },
      gwWinDown: () => up({ winners: Math.max(1, winnersN - 1) }), gwWinUp: () => up({ winners: Math.min(500, winnersN + 1) }),
      gwSplitNote: isTok ? 'Each winner gets ≈ ' + fmtTok(per / px) + ' ' + g.token + ' (' + money(per) + ') · live price ' + (px < 0.01 ? '$' + px.toPrecision(3) : money(px)) : isT ? winnersN + ' winners × ' + tix + ' tickets = ' + (tix * winnersN) + ' tickets ($' + (tix * winnersN) + ')' : 'Each winner gets ' + money(per) + (isTok ? ' in ' + g.token : ' USDC'),
      gwTaskRows: tasks.map((t, i) => { const acts = t.acts || ['like', 'repost']; const patch = o => setTasks(l => l.map((x, j) => j === i ? { ...x, ...o } : x)); const text = String(t.val || ''); const proofOn = !!t.requireProof; const postFree = t.type === 'post' && t.postMode === 'free'; const chip = on => ({ bg: on ? 'rgba(255,90,26,0.12)' : '#17171D', color: on ? '#F2EFE8' : '#9A98A3', border: on ? 'rgba(255,122,42,0.7)' : 'rgba(255,255,255,0.08)' }); return { ...ic(t.type), label: t.type === 'engage' ? 'Engage with a post on X' : TT[t.type][0], ph: TT[t.type][3], val: t.type === 'post' ? text.slice(0, 280) : text,
        showLink: t.type !== 'post', isPost: t.type === 'post', isPostExact: t.type === 'post' && !postFree, isPostFree: postFree, postModes: [['free', 'Free post'], ['exact', 'Exact match']].map(([k, label]) => ({ label, ...chip((postFree ? 'free' : 'exact') === k), set: () => patch({ postMode: k }) })), isEngage: t.type === 'engage', needsProof: t.type === 'tg' || t.type === 'discord' || t.type === 'custom',
        instr: t.instructions || '', count: String(Math.min(text.length, 280)) + '/280', intent: 'https://x.com/intent/tweet?text=' + encodeURIComponent(text.slice(0, 280)),
        acts: ACTS.map(([k, label]) => { const on = acts.includes(k); return { label, mark: on ? '✓' : '+', bg: on ? 'rgba(255,90,26,0.12)' : '#17171D', color: on ? '#F2EFE8' : '#9A98A3', border: on ? 'rgba(255,122,42,0.7)' : 'rgba(255,255,255,0.08)', toggle: () => patch({ acts: on ? acts.filter(x => x !== k) : [...acts, k] }) }; }),
        onInstr: e => { const v = e.target.value; setTasks(l => l.map((x, j) => j === i ? { ...x, instructions: v } : x)); },
        proofOn, toggleProof: () => patch({ requireProof: !proofOn }), proofBg: proofOn ? 'linear-gradient(90deg,#FF2D0A,#F5B70C)' : '#3A3A44', proofKnob: proofOn ? '21px' : '3px', proofBorder: proofOn ? 'rgba(255,122,42,0.7)' : 'rgba(255,255,255,0.08)',
        onVal: e => { const v = t.type === 'post' ? e.target.value.slice(0, 280) : e.target.value; setTasks(l => l.map((x, j) => j === i ? { ...x, val: v } : x)); }, remove: () => setTasks(l => l.filter((_, j) => j !== i)) }; }),
      gwTaskAdd: Object.keys(TT).map(k => ({ label: TT[k][0], ...ic(k), add: () => setTasks(l => l.length < 10 ? [...l, k === 'engage' ? { type: k, val: '', instructions: '', acts: ['like', 'repost'] } : k === 'post' ? { type: k, val: '', postMode: 'exact', instructions: '', requireProof: false } : { type: k, val: '', requireProof: false }] : l) })),
      gwCloseOpts: CLOSE.map(([k, label]) => ({ label, ...sel(g.close === k), set: () => up({ close: k }) })),
      gwMore: g.more, gwMoreLabel: g.more ? 'Hide' : 'Show', gwToggleMore: () => up({ more: !g.more }),
      gwDesc: g.desc, onGwDesc: e => up({ desc: e.target.value }), gwHasDesc: !!g.desc,
      gwProject: g.project, onGwProject: e => up({ project: e.target.value }),
      gwPickOpts: PICK.map(([k, label]) => ({ label, ...sel(g.pick === k), set: () => up({ pick: k }) })),
      gwToggleVerified: () => up({ verified: !g.verified }), gwVerBg: g.verified ? 'linear-gradient(90deg,#FF2D0A,#F5B70C)' : '#3A3A44', gwVerKnob: g.verified ? '25px' : '3px',
      gwPrizeCost: isT ? (tix * winnersN) + ' tickets · ' + money(cost) : isTok ? '≈ ' + fmtTok(cost / px) + ' ' + g.token + ' · ' + money(cost) : money(cost), gwTotal: money(cost + fee),
      feeLabel: 'Platform fee (10%, $5 minimum, paid in USDC)', feeStr: money(fee),
      kyc: g.kyc, toggleKyc: () => up({ kyc: !g.kyc }), kycBg: g.kyc ? 'linear-gradient(90deg,#FF2D0A,#F5B70C)' : '#3A3A44', kycKnob: g.kyc ? '25px' : '3px', kycFeeTag: '+$1 per entrant', kycRowBg: g.kyc ? 'rgba(245,183,12,0.06)' : 'transparent', kycEdge: g.kyc ? 'rgba(255,122,42,0.7)' : 'transparent',
      toggleOnePer: () => up({ onePer: !g.onePer }), onePerBg: g.onePer ? 'linear-gradient(90deg,#FF2D0A,#F5B70C)' : '#3A3A44', onePerKnob: g.onePer ? '25px' : '3px',
      maxPOpts: (() => { const cap = String(g.maxP ?? ''); const key = cap === '100' || cap === '1000' || cap === '' ? cap : 'custom'; return [['100', '100'], ['1000', '1,000'], ['custom', 'Custom'], ['', 'No limit']].map(([k, label]) => ({ label, ...sel(key === k), set: () => up({ maxP: k === 'custom' ? (key === 'custom' && cap !== 'custom' ? cap : 'custom') : k }) })); })(),
      maxPCustom: !['100', '1000', ''].includes(String(g.maxP ?? '')),
      maxPCustomVal: ['100', '1000', '', 'custom'].includes(String(g.maxP ?? '')) ? '' : String(g.maxP),
      onMaxPCustom: e => { const v = e.target.value.replace(/\D/g, '').slice(0, 7); up({ maxP: v || 'custom' }); },
      tierOpts: [['', '1', 'Unknown', 'No notable crypto followers yet.', '', ''], ['noted', '2', 'Noted', 'On the radar of real crypto accounts.', '@looftaxyz', '/images/tiers/looftaxyz.png'], ['credible', '3', 'Credible', 'Followed by a solid crypto circle.', '@magicblock', '/images/tiers/magicblock.jpg'], ['significant', '4', 'Significant', 'Followed by top KOLs, projects and funds.', '@fomo', '/images/tiers/fomo.jpg'], ['supreme', '5', 'Supreme', 'The top of crypto X.', '@solana', '/images/tiers/solana.jpg']].map(([k, n, name, blurb, ex, avatar]) => { const on = (g.minTier || '') === k; return { n, name, blurb, ex, avatar, hasEx: !!ex, isNew: !ex, kicker: 'TIER ' + n, kickerColor: on ? '#FF7A2A' : '#8A8893', nameColor: on ? '#F2EFE8' : '#B5B2BC', set: () => up({ minTier: k }), bg: on ? 'rgba(255,90,26,0.12)' : 'transparent', border: on ? 'rgba(255,122,42,0.85)' : 'transparent' }; }),
      tierFoot: (() => { const row = [['', '1', 'Unknown', 'No notable crypto followers yet.', '', ''], ['noted', '2', 'Noted', 'On the radar of real crypto accounts.', '@looftaxyz', '/images/tiers/looftaxyz.png'], ['credible', '3', 'Credible', 'Followed by a solid crypto circle.', '@magicblock', '/images/tiers/magicblock.jpg'], ['significant', '4', 'Significant', 'Followed by top KOLs, projects and funds.', '@fomo', '/images/tiers/fomo.jpg'], ['supreme', '5', 'Supreme', 'The top of crypto X.', '@solana', '/images/tiers/solana.jpg']].find(r => r[0] === (g.minTier || '')); return { title: 'Tier ' + row[1] + ' ' + row[2] + ' and up', blurb: row[3], ex: row[4], avatar: row[5], hasEx: !!row[4], isNew: !row[4] }; })(),
      ageOpts: [['any', 'Any'], ['30', '30 days'], ['90', '90 days'], ['365', '1 year']].map(([k, label]) => ({ label, ...sel((!g.age || g.age === 'any' ? 'any' : g.age) === k), set: () => up({ age: k === 'any' ? '' : k }) })),
      qualifyLine: (() => { const bits = []; const loc = g.locMode || 'any'; const place = loc === 'only' ? [...(g.requiredContinents || []), ...(g.requiredCountries || [])] : loc === 'except' ? [...(g.excludedContinents || []), ...(g.excludedCountries || [])] : []; if (loc === 'any' || !place.length) bits.push('Anyone'); else bits.push((loc === 'only' ? 'Only in ' : 'Everywhere except ') + place.slice(0, 3).join(', ') + (place.length > 3 ? ' +' + (place.length - 3) : '')); const days = parseInt(g.age, 10); if (days > 0) bits.push('X accounts ' + days + '+ days old'); const tierName = { noted: 'Noted', credible: 'Credible', significant: 'Significant', supreme: 'Supreme' }[g.minTier || '']; if (tierName) bits.push(tierName + ' and up'); if (g.verified) bits.push('Verified X'); if (g.kyc) bits.push('KYC'); const cap = String(g.maxP ?? ''); if (cap && cap !== 'custom' && !isNaN(Number(cap))) bits.push('Up to ' + Number(cap).toLocaleString('en-US')); return bits.join(' · '); })(),
      ageDays: g.age === 'any' ? '' : g.age, onAgeDays: e => up({ age: e.target.value.replace(/[^0-9]/g, '').slice(0, 4) }),
      ageBorder: g.age && g.age !== 'any' && !['30', '90', '365'].includes(g.age) ? 'rgba(255,122,42,0.6)' : 'rgba(255,255,255,0.08)',
      regions: g.regions, onRegions: e => up({ regions: e.target.value }),
      pickNote: g.pick === 'random' ? 'Drawn with MagicBlock VRF. Anyone can verify the result on-chain.' : g.pick === 'first' ? 'The first verified entrants win, in order.' : 'You choose the winners after entries close.',
      approvalNote: g.kyc ? 'You sign in on the next step. KYC giveaways are reviewed before they go live.' : cost < 250 ? 'You sign in on the next step. Pools under $250 from verified hosts go live straight away.' : 'You sign in on the next step. Larger pools are reviewed in under an hour.',
      _needsReview: !!g.kyc || cost >= 250,
      _reviewNote: g.kyc ? 'KYC is on, so this stays hidden until it’s approved. We’ll message you when it can go live.' : 'Approved in under an hour. We’ll email or message you on Telegram when it’s live.',
      _cost: cost, _fee: fee, _tasks: tasks.length, _title: g.title,
      gwEmail: g.email, onGwEmail: e => up({ email: e.target.value }),
      gwSubmitOpacity: cost > 0 && tasks.length ? 1 : 0.45,
      gwSubmit: () => { if (g.title && cost > 0 && tasks.length) { up({ submitted: true }); window.scrollTo(0, 0); } },
      gwProjectShow: g.project || 'Your project', gwTitleShow: g.title || 'Your giveaway title',
      gwPrevBig: isT ? String(tix * winnersN) : money(cost).replace(/\.00$/, ''), gwPrevUnit: isT ? 'tickets' : isTok ? 'in ' + g.token : 'USDC',
      gwPrevChips: [isT ? tix + ' each' : money(per).replace(/\.00$/, '') + ' each', winnersN + (winnersN === 1 ? ' winner' : ' winners'), PICK.find(p => p[0] === g.pick)[1]],
      gwPrevBg: '#0E0E12',
      gwPrevBorder: 'rgba(255,255,255,0.08)',
      gwPrevAccent: isT ? '#F5B70C' : isTok ? '#C29BFF' : '#5FD38E',
      gwPrevTile: isT ? 'radial-gradient(120% 120% at 28% 18%,#FFF0B8 0%,#F5B70C 42%,#D17A04 100%)' : isTok ? TOK[g.token] : '#2775CA', gwPrevInk: isT ? '#6A3500' : '#fff', gwPrevGlyph: isT ? 'M' : isTok ? g.token[0] : '$',
      gwPrevLogo: isTok && !!(g.tokenLogo || iconFor((TOKL.find(t => t[0] === g.token) || [])[3])),
      gwPrevLetter: !isT,
      gwCloseShow: isNaN(closeAt) ? '—' : dl + 'd ' + hl + 'h',
      gwIsCustomClose: g.close === 'custom', gwCloseDate: cDate, gwCloseTime: cTime, gwMinDate: ymd(nowD), gwCloseAt: closeAtStr,
      onGwCloseDate: e => up({ closeDate: e.target.value }), onGwCloseTime: e => up({ closeTime: e.target.value }),
      gwPrevTasks: tasks.map(t => ({ ...ic(t.type), label: t.type === 'engage' ? engLabel(t) : t.type === 'follow' && t.val ? 'Follow ' + (t.val.startsWith('@') ? t.val : '@' + t.val) + ' on X' : t.type === 'post' && t.postMode === 'free' ? ('Post freely on X' + ((t.instructions || '').trim() ? ': ' + String(t.instructions).trim().slice(0, 42) : '')) : t.type === 'post' && (t.val || '').trim() ? 'Post on X: ' + String(t.val).trim().slice(0, 42) : t.type === 'custom' && t.val ? t.val : TT[t.type][0] })),
      _unit: unit,
    };
  }

  renderVals() {
    const s = this.state, set = o => this.setState(o);
    const money = n => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
    const gv = this.gwVals(s, set, money);
    const tile = (g, rim) => ({ tile: 'radial-gradient(120% 120% at 28% 18%,' + g + ')', shadow: 'inset 0 3px 6px rgba(255,255,255,0.5),0 4px 0 ' + rim + ',0 12px 22px rgba(0,0,0,0.4)' });
    const OR = tile('#FFC79A 0%,#FF5A1A 45%,#D23806 100%', '#9C2802'), GO = tile('#FFF0B8 0%,#F5B70C 42%,#D17A04 100%', '#8E5202'), BL = tile('#9CC8FF 0%,#2775CA 48%,#1A55A0 100%', '#123E78'), WH = tile('#FFFFFF 0%,#ECEAF0 45%,#BDBAC6 100%', '#8C8898');
    const fill = o => { const gw = { ...(s.gw || {}), ...o, tokOpen: false }; try { localStorage.setItem('loofta-gw-draft', JSON.stringify(gw)); } catch (e) {} this.setState({ gw, savedAt: Date.now() }); };
    const TPL = [
      ['Grow your X following', 'More followers and reach from one post.', '$100 USDC · 10 winners · follow + like & repost · 1 week', '𝕏', tile('#5A5A66 0%,#26262E 55%,#0B0B0E 100%', '#000'), '#fff', { prize: 'usdc', amount: '100', winners: 10, close: '1w', pick: 'random', tasks: [{ type: 'follow', val: '@' }, { type: 'engage', val: '', acts: ['like', 'repost'], quote: false }] }],
      ['Boost a launch post', 'Push one post up the feed with quotes and comments.', '$50 USDC · 5 winners · quote + comment · 3 days', '↻', tile('#9CC8FF 0%,#2775CA 48%,#1A55A0 100%', '#123E78'), '#fff', { prize: 'usdc', amount: '50', winners: 5, close: '3d', pick: 'random', tasks: [{ type: 'engage', val: '', instructions: 'Quote this post and add your own line', acts: ['like', 'repost', 'comment'] }] }],
      ['Grow your community', 'New Telegram and Discord members for the price of a few tickets.', '2 Jackpot tickets × 50 winners · join TG + Discord · 1 week', 'T', tile('#9FDBFF 0%,#229ED9 50%,#17699A 100%', '#0F4C70'), '#fff', { prize: 'tickets', tickets: '2', winners: 50, close: '1w', pick: 'random', tasks: [{ type: 'tg', val: '' }, { type: 'discord', val: '' }] }],
      ['Creator contest', 'The best posts win. You choose who.', '$200 USDC · 3 winners · post on X · I’ll pick · 1 week', '★', tile('#FFC79A 0%,#FF5A1A 45%,#D23806 100%', '#9C2802'), '#fff', { prize: 'usdc', amount: '200', winners: 3, close: '1w', pick: 'manual', tasks: [{ type: 'follow', val: '@' }, { type: 'post', val: '', postMode: 'free', instructions: '' }] }],
    ];
    const FAQ = [
      ['How is the winner picked?', 'Random draws use MagicBlock VRF: verifiable randomness generated on-chain. Anyone can check the draw from the proof link on the results page, so the host can’t hand-pick a winner.'],
      ['Do entrants need a crypto wallet?', 'No. Entrants sign in with X or email. Winners receive their prize in a Loofta balance and can cash out to Venmo, Cash App, Revolut or a crypto wallet.'],
      ['What are Jackpot tickets?', 'Each ticket is an entry into the daily Megapot draw, a lottery with a $1.1M+ Jackpot Prize. Give tickets instead of cash, from $1 each. Every winner gets a real chance at the $1.1M+ Jackpot Prize, and you don’t need a big budget.'],
      ['How fast is approval?', 'Pools under $250 from verified hosts go live straight away, unless you require KYC. KYC giveaways, and anything larger, are reviewed before they are shown live. You get an email or Telegram message when it’s approved.'],
      ['What does it cost?', 'USDC and token giveaways cost the prize plus a 10% admin fee, with a $5 minimum. A recurring raid uses the same weekly pool whether you pay in USDC or Jackpot tickets ($1 each). You pick a package for 1 week, 4 weeks, or 3 months, and the leaderboard still pays every week. Your own token uses that same weekly dollar amount. The fee is always paid in USDC. KYC checks add $1 per verified entrant. You see the full total before you pay.'],
      ['How are entries verified?', 'Loofta checks each task automatically, for example follows, likes, reposts, quotes, comments and Telegram or Discord joins. Your restrictions apply too: Sorsa score tier, account age, verified only, regions and optional KYC. A participant cap closes entries early.'],
    ];
    const step = s.launchStep;
    const PLANS = { starter: ['Starter', 79, 50], growth: ['Growth', 209, 150], pro: ['Pro', 499, 400] };
    const pl = PLANS[s.plan];
    const pk = on => ({ bg: on ? 'rgba(255,90,26,0.12)' : '#0E0E12', color: on ? '#F2EFE8' : '#9A98A3', border: on ? 'rgba(255,122,42,0.7)' : 'rgba(255,255,255,0.08)' });
    const EARN = [['like', 'Like'], ['repost', 'Repost'], ['quote', 'Quote'], ['reply', 'Reply']];
    const tw = n => n + (n === 1 ? ' ticket' : ' tickets');
    const isAuto = s.mode === 'auto';
    const TERMS = { '1w': [1, 'Billed every week', ' / week'], '4w': [4, 'Billed every 4 weeks', ' / 4 wk'], '3m': [12, 'Billed every 3 months', ' / 3 mo'] };
    const freq = TERMS[s.freq] ? s.freq : '1w';
    const [weeks, billHow, priceSuffix] = TERMS[freq];
    const usd = s.reward === 'usdc', tix = s.reward === 'tickets', tokReward = s.reward === 'token', ub = parseFloat(s.usdBudget) || 0;
    const charge = ub * weeks, uFee = charge > 0 ? Math.max(5, charge * 0.10) : 0;
    const weeklyTickets = Math.max(0, Math.round(ub));
    const termTickets = weeklyTickets * weeks;
    const billUsd = '$' + (charge + uFee).toLocaleString('en-US', { maximumFractionDigits: 2 }) + priceSuffix;
    const usePlan = tix || usd;
    const planRow = PLANS[s.plan] || PLANS.growth;
    const monthlyPrice = planRow[1], monthlyPool = planRow[2], weeklyPlan = monthlyPool / 4;
    const packagePrice = monthlyPrice * (weeks / 4);
    const fmtCount = n => (Math.round(n * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });
    const planDetail = tix ? monthlyPool + ' tickets / month' : '$' + monthlyPool + ' USDC / month';
    const weeklyDetail = tix ? fmtCount(weeklyPlan) + ' tickets every week' : money(weeklyPlan) + ' every week';
    const raidSym = s.raidToken || 'your token';
    const raidPx = typeof s.raidTokenPrice === 'number' && s.raidTokenPrice > 0 ? s.raidTokenPrice : 0;
    const fmtTok = n => n >= 1000 ? Math.round(n).toLocaleString('en-US') : n >= 1 ? (Math.round(n * 100) / 100).toLocaleString('en-US') : n > 0 ? n.toPrecision(3) : '0';
    const weeklyTok = raidPx > 0 ? ub / raidPx : 0;
    const termTok = weeklyTok * weeks;
    const tokAmt = n => fmtTok(n) + ' ' + raidSym;
    const iconFor = mint => mint && String(mint).length >= 32 ? '/api/giveaways/token-icon?mint=' + encodeURIComponent(mint) : '';
    const shortMint = mint => { const m = String(mint || ''); return m.length > 12 ? m.slice(0, 4) + '…' + m.slice(-4) : m; };
    const RAID_PRICE = { SOL: 152.3, BONK: 0.0000214, JUP: 0.82, WIF: 1.94 };
    const RAID_TOKL = [['SOL', 'Solana', '#9945FF', 'So11111111111111111111111111111111111111112'], ['BONK', 'Bonk', '#F7A400', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'], ['JUP', 'Jupiter', '#22C4A5', 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'], ['WIF', 'dogwifhat', '#C8A27C', 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm']];
    const raidQ = String(s.raidTokQ || '').trim();
    const pickRaid = (sym, mint, logo, price) => set({ raidToken: sym, raidTokenMint: mint, raidTokenLogo: logo || '', raidTokenPrice: typeof price === 'number' ? price : null, raidTokQ: '', raidTokOpen: false });
    return {
      ...gv,
      isOneOff: !isAuto, isAuto, whoNum: isAuto ? '4' : '3', whoTitle: isAuto ? 'Who can raid?' : 'Who can enter?',
      modes: [['oneoff', 'One-off giveaway', 'Fund a prize, set tasks, draw winners once.', '🎁', 'radial-gradient(120% 120% at 28% 18%,#FFC79A 0%,#FF5A1A 45%,#D23806 100%)', '#9C2802', ''], ['auto', 'Auto-pilot raids', 'A subscription that rewards your community for boosting your posts on X. The leaderboard pays every week.', '⚡', 'radial-gradient(120% 120% at 28% 18%,#FFF0B8 0%,#F5B70C 42%,#D17A04 100%)', '#8E5202', 'Recurring']].map(([k, title, sub, glyph, tile, rim, tag]) => { const on = s.mode === k; return { title, sub, glyph: k === 'oneoff' ? '1×' : '∞', tile, shadow: 'inset 0 2px 4px rgba(255,255,255,0.5),0 4px 0 ' + rim, hasTag: !!tag, tag, set: () => set({ mode: k }), bg: on ? '#1E1E25' : 'transparent', shadow: on ? '0 6px 18px rgba(0,0,0,0.35)' : 'none', color: on ? '#F2EFE8' : '#9A98A3' }; }),
      xLabel: s.xConnected ? '@' + ((s.xHandle || this._privyHandle || 'looftaxyz').replace(/^@/, '')) : 'Connect X', xSub: s.xConnected ? (s.scope === 'manual' ? 'Connected · you pick which posts to raid' : 'Connected · new posts become raids') : 'Read-only access to your posts', xBtn: s.xConnected ? 'Disconnect' : 'Connect', xBtnBg: s.xConnected ? '#26262E' : '#F2EFE8', xBtnColor: s.xConnected ? '#C9C6CF' : '#0B0B0E', xBorder: s.xConnected ? 'rgba(60,200,120,0.4)' : 'rgba(255,255,255,0.08)', toggleX: () => { const next = !s.xConnected; const handle = (this._privyHandle || s.xHandle || 'looftaxyz').replace(/^@/, ''); set(next ? { xConnected: true, xHandle: handle } : { xConnected: false }); }, xHandle: s.xConnected ? '@' + ((s.xHandle || 'looftaxyz').replace(/^@/, '')) : '@yourproject',
      raidScope: [['all', 'Every new post', 'Automatic. Each post you publish from @' + (s.xConnected ? (s.xHandle || 'looftaxyz').replace(/^@/, '') : 'yourproject') + ' starts a raid. Replies and reposts don’t count.'], ['tagged', 'Only posts with #raid', 'Add #raid to a post on X when you want it boosted. Others are ignored.'], ['manual', 'I choose the posts', 'Pick from your last 5 posts, or paste another link. Switch back to every new post any time.']].map(([k, label, sub]) => { const on = s.scope === k; return { label, sub, set: () => set({ scope: k }), bg: on ? 'rgba(255,90,26,0.08)' : '#0E0E12', border: on ? 'rgba(255,122,42,0.55)' : 'rgba(255,255,255,0.07)', ring: on ? '#FF7A2A' : '#4A4A55', dot: on ? '#FF7A2A' : 'transparent' }; }),
      scopeManual: s.scope === 'manual',
      showPostsNote: !!s.postsNote,
      postsNote: s.postsNote || '',
      postLink: s.postLink || '',
      onPostLink: e => set({ postLink: e.target.value }),
      addPost: () => {
        const raw = String(s.postLink || '').trim();
        const m = raw.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/i);
        if (!m) { set({ postsNote: 'Paste a post link like x.com/you/status/123' }); return; }
        const id = m[2];
        const post = { id, text: raw, when: 'Added', url: 'https://x.com/' + m[1] + '/status/' + id, added: true };
        const list = Array.isArray(s.xPosts) ? s.xPosts : [];
        const next = list.some(p => p.id === id) ? list : [...list, post];
        const ids = Array.isArray(s.pickedIds) ? s.pickedIds : [];
        set({ xPosts: next, pickedIds: ids.includes(id) ? ids : [...ids, id], postLink: '', postsNote: '' });
      },
      backToEvery: () => set({ scope: 'all', postsNote: '' }),
      recentPosts: (Array.isArray(s.xPosts) ? s.xPosts : []).map(p => { const ids = Array.isArray(s.pickedIds) ? s.pickedIds : []; const on = ids.includes(p.id); return { text: p.text, when: p.when, btn: on ? 'Raiding ✓' : 'Raid this', bg: on ? 'rgba(255,90,26,0.08)' : 'transparent', btnBg: on ? 'linear-gradient(90deg,#FF2D0A,#F5B70C)' : '#26262E', btnColor: on ? '#fff' : '#C9C6CF', toggle: () => set({ pickedIds: on ? ids.filter(x => x !== p.id) : [...ids, p.id] }) }; }),
      raidFlow: [{ isPost: true, t: 'You post on X', d: 'Your post becomes a raid, automatically or when you choose.' }, { isRepost: true, t: 'Raiders engage', d: 'Your community likes, reposts, quotes and replies in the first hours.' }, { isCheck: true, t: 'Leaderboard pays out', d: 'Verified actions earn points. The top raiders share the pool every week.' }],
      rewardTypes: [['tickets', 'Jackpot tickets'], ['usdc', 'USDC'], ['token', 'Your token']].map(([k, label]) => ({ label, set: () => set({ reward: k, raidTokOpen: k === 'token' }), bg: s.reward === k ? '#F2EFE8' : 'transparent', color: s.reward === k ? '#0B0B0E' : '#9A98A3' })),
      rewardTix: usePlan, rewardUsd: usd, rewardTok: tokReward, rewardBudget: tokReward, showBudgetNote: tokReward,
      raidTokQ: s.raidTokQ || '', onRaidTokQ: e => set({ raidTokQ: e.target.value, raidTokOpen: true }), raidTokFocus: () => set({ raidTokOpen: true }),
      raidTokOpen: !!s.raidTokOpen, raidTokPicked: !!s.raidToken && (!s.raidTokOpen || !raidQ), raidTokBorder: s.raidTokOpen ? 'rgba(255,122,42,0.6)' : 'rgba(255,255,255,0.08)',
      raidToken: raidSym, raidTokLogo: s.raidTokenLogo || iconFor(s.raidTokenMint), raidHasTokLogo: !!(s.raidTokenLogo || iconFor(s.raidTokenMint)), raidNoTokLogo: !(s.raidTokenLogo || iconFor(s.raidTokenMint)), raidTokDot: '#9945FF',
      raidTokSearching: s.tokStatus === 'loading',
      raidTokResults: (() => {
        const asRow = (sym, name, dot, mint, logo, price) => ({ sym, name, dot, mint: shortMint(mint), hasLogo: !!logo, noLogo: !logo, logo: logo || '', set: () => pickRaid(sym, mint, logo, price) });
        if (raidQ.length >= 2 && Array.isArray(s.tokHits)) {
          const rows = s.tokHits.map(t => asRow(t.symbol, t.name, '#3A3A44', t.mint, t.logo ? iconFor(t.mint) : '', t.usdPrice));
          if (!rows.length && raidQ.length >= 32 && s.tokStatus !== 'loading') return [asRow(raidQ.slice(0, 4).toUpperCase() + '…', 'Token at pasted address', '#3A3A44', raidQ, '', null)];
          return rows;
        }
        const q = raidQ.toLowerCase();
        return RAID_TOKL.filter(t => !q || t[0].toLowerCase().includes(q) || t[1].toLowerCase().includes(q)).map(([sym, name, dot, mint]) => asRow(sym, name, dot, mint, iconFor(mint), RAID_PRICE[sym] || null));
      })(),
      raidTokNone: raidQ.length >= 2 && s.tokStatus !== 'loading' && Array.isArray(s.tokHits) && s.tokHits.length === 0 && raidQ.length < 32,
      raidTokPayLine: tix ? weeklyTickets.toLocaleString('en-US') + ' Jackpot tickets each week · ' + termTickets.toLocaleString('en-US') + ' tickets for this bill, plus $' + uFee.toFixed(2) + ' USDC' : !s.raidToken ? 'Search for your token. The weekly pool is the same dollar amount as USDC, then paid in that token. The fee stays in USDC.' : raidPx > 0 ? '≈ ' + tokAmt(weeklyTok) + ' each week · ' + tokAmt(termTok) + ' for this bill, plus $' + uFee.toFixed(2) + ' USDC' : 'Live price unavailable, so the pool stays in USD until a price comes back.',
      usdBudget: s.usdBudget, onUsdBudget: e => set({ usdBudget: e.target.value.replace(/[^0-9.]/g, '').slice(0, 7) }),
      usdQuick: [100, 250, 500, 1000].map(v => ({ label: '$' + v, ...pk(String(v) === s.usdBudget), set: () => set({ usdBudget: String(v) }) })),
      periodUpper: 'WEEK',
      plans: Object.keys(PLANS).map(k => ({ name: PLANS[k][0], price: '$' + PLANS[k][1], tickets: tix ? PLANS[k][2] + ' tickets / month' : '$' + PLANS[k][2] + ' USDC / month', set: () => set({ plan: k }), bg: s.plan === k ? 'rgba(255,90,26,0.1)' : '#0E0E12', border: s.plan === k ? 'rgba(255,122,42,0.75)' : 'rgba(255,255,255,0.07)' })),
      freqOpts: [['1w', '1 week', 1], ['4w', '4 weeks', 4], ['3m', '3 months', 12]].map(([k, label, w]) => { const pool = ub * w; const fee = pool > 0 ? Math.max(5, pool * 0.10) : 0; const on = freq === k; const cardPrice = usePlan ? money(monthlyPrice * (w / 4)) : money(pool + fee); const cardDetail = usePlan ? weeklyDetail : tokReward && raidPx > 0 ? tokAmt(ub / raidPx) + ' every week' : money(ub) + ' every week'; return { label, price: cardPrice, detail: cardDetail, ...pk(on), bg: on ? 'rgba(255,90,26,0.1)' : '#0E0E12', border: on ? 'rgba(255,122,42,0.75)' : 'rgba(255,255,255,0.07)', set: () => set({ freq: k }) }; }),
      toggleAnnual: () => {}, annualBg: '#3A3A44', annualKnob: '3px',
      earnRules: EARN.map(([k, label], i) => ({ label, val: s.earn[k] + (s.earn[k] === 1 ? ' pt' : ' pts'), line: i ? 'rgba(255,255,255,0.06)' : 'transparent', down: () => set({ earn: { ...s.earn, [k]: Math.max(0, s.earn[k] - 1) } }), up: () => set({ earn: { ...s.earn, [k]: Math.min(20, s.earn[k] + 1) } }) })),
      capOpts: [10, 20, 50].map(n => ({ label: n + ' pts', ...pk(s.cap === n), set: () => set({ cap: n }) })),
      streakOpts: [['none', 'None'], ['1.5x', '1.5× at 4 weeks'], ['2x', '2× at 4 weeks']].map(([k, label]) => ({ label, ...pk(s.streak === k), set: () => set({ streak: k }) })),
      planName: tokReward ? raidSym + ' rewards' : planRow[0], planTickets: tokReward ? (raidPx > 0 ? tokAmt(weeklyTok) + ' / week' : 'Pick a token') : planDetail, spreadNote: usePlan ? weeklyDetail : '10% fee, $5 min · $' + uFee.toFixed(2) + ' USDC', spreadLabel: usePlan ? 'Leaderboard' : 'Platform fee',
      billLabel: billHow, planPrice: tokReward ? (raidPx > 0 ? tokAmt(termTok) + ' + $' + uFee.toFixed(2) : '—') + priceSuffix : usePlan ? money(packagePrice) + priceSuffix : billUsd,
      showAnnual: false,
      subOpacity: s.xConnected && ub > 0 && (!tokReward || raidPx > 0) ? 1 : 0.45, subscribe: () => { if (s.xConnected && ub > 0 && (!tokReward || raidPx > 0)) set({ launchStep: 'signin' }); },
      earnChips: EARN.filter(([k]) => s.earn[k] > 0).map(([k, label]) => label + ' +' + s.earn[k] + ' pts'),
      board: [['@kofi.sol', 412], ['@nova_studio', 356], ['@mayabuilds', 298], ['@tunde.eth', 240]].map(([who, p], i) => { const pool = tokReward && raidPx > 0 ? weeklyTok : usePlan ? weeklyPlan : ub; const shares = s.split === 'share' ? p / 1306 : [0.25, 0.18, 0.14, 0.11][i]; const amt = pool * shares; return { rank: String(i + 1), who, pts: p + ' pts', tix: tokReward && raidPx > 0 ? fmtTok(amt) + ' ' + raidSym : tix ? fmtCount(amt) + ' tix' : '$' + amt.toFixed(2) }; }),
      boardTitle: 'THIS WEEK’S LEADERBOARD', periodWord: 'week',
      splitOpts: [['top10', 'Top 10'], ['top25', 'Top 25'], ['share', 'Everyone, by share of points']].map(([k, label]) => ({ label, ...pk(s.split === k), set: () => set({ split: k }) })),
      splitNote: s.split === 'share' ? 'Every raider gets a slice in proportion to their points. 10% of points = 10% of the pool.' : 'Higher ranks get a bigger share. #1 gets about 25% of the pool, sliding down to #' + (s.split === 'top10' ? '10' : '25') + '.',
      leftLabel: 'Pool paid out Sunday',
      fA: isAuto ? (tokReward ? raidSym + ' rewards' : planRow[0] + (tix ? ' tickets' : ' USDC')) : 'Prize', fAv: isAuto ? (tokReward ? (raidPx > 0 ? tokAmt(weeklyTok) + ' / week' : 'Pick a token') : planDetail) : gv.gwPrizeCost, fB: isAuto ? (usePlan ? 'Leaderboard' : 'Platform fee (10%, $5 min, USDC)') : gv.feeLabel, fBv: isAuto ? (usePlan ? weeklyDetail : '$' + uFee.toFixed(2)) : gv.feeStr,
      fTotal: isAuto ? (tokReward ? (raidPx > 0 ? tokAmt(termTok) + ' + $' + uFee.toFixed(2) : '—') : usePlan ? money(packagePrice) : '$' + (charge + uFee).toFixed(2)) : gv.gwTotal, payLabel: isAuto ? 'Subscribe and start' : 'Pay ' + gv.gwTotal + ' and launch',
      leftNote: tokReward ? (raidPx > 0 ? tokAmt(weeklyTok) + ' pool' : 'token pool') : tix ? fmtCount(weeklyPlan) + ' tickets' : usePlan ? money(weeklyPlan) + ' pool' : '$' + ub + ' pool',
      createRef: this.createRef, toCreate: this.toCreate,
      heroPeople: [['K', '#2F5BE0', '+1 chance'], ['M', '#D23806', '+2 chances'], ['A', '#3CB371', '+1 chance'], ['J', '#7142CF', '+3 chances'], ['S', '#E0A02A', '+1 chance']].map(([g, bg, n]) => ({ g, bg, n })),
      draftNote: s.savedAt ? 'Draft saved on this device' : s.restored ? 'Draft restored' : 'Your draft saves as you go',
      jpSteps: [{ n: '1', t: 'You give Jackpot tickets', d: '$1 each. Pick how many winners and how many tickets each.' }, { n: '2', t: 'Winners join the daily Megapot draw', d: 'Their tickets enter the next draw automatically. No wallet needed.' }, { n: '3', t: 'Any ticket can win the Jackpot Prize', d: 'The prize pool is $1.1M+, paid straight to the winner’s Loofta balance.' }],
      templates: TPL.map(([name, benefit, setup, glyph, t, ink, o]) => ({ name, benefit, setup, glyph, tile: t.tile, shadow: t.shadow, ink, bg: '#141419', border: 'rgba(255,255,255,0.07)', use: () => fill(o) })),
      proof: [{ v: '$204', k: 'paid out to winners' }, { v: '5', k: 'giveaways run' }, { v: '535', k: 'participants' }],
      hostStats: [
        { logo: '/images/partners/1tap.jpg', name: '1tap', value: '15K', label: 'impressions' },
        { logo: '/images/partners/lottopad.png', name: 'Lottopad', value: '200', label: 'new users' },
        { logo: '/images/icons/loofta-icon.svg', name: 'Loofta', value: '535', label: 'participants' },
      ],
      compare: [
        { a: 'Prize held in escrow', ad: 'Funds are locked before the giveaway opens.', b: 'Trust the host', bd: 'Entrants hope the prize gets sent.' },
        { a: 'Verifiable draw', ad: 'MagicBlock VRF picks winners on-chain, with a public proof.', b: 'Hand-picked winner', bd: 'No way to check how winners were chosen.' },
        { a: 'Entries checked for you', ad: 'Quotes, follows and joins verified automatically, with bot filters.', b: 'Scroll through replies', bd: 'Hours of manual checking, bots included.' },
        { a: 'Automatic payout', ad: 'Winners claim to a Loofta balance and cash out their way.', b: 'DM for wallets', bd: 'Chase winners for addresses, send one by one.' },
      ],
      compare: [
        { a: 'Prize held in escrow', ad: 'Funds are locked before the giveaway opens.', b: 'Trust the host', bd: 'Entrants hope the prize gets sent.' },
        { a: 'Verifiable draw', ad: 'MagicBlock VRF picks winners on-chain, with a public proof.', b: 'Hand-picked winner', bd: 'No way to check how winners were chosen.' },
        { a: 'Entries checked for you', ad: 'Follows, engagements and joins verified automatically, with bot filters and optional KYC.', b: 'Scroll through replies', bd: 'Hours of manual checking, bots included.' },
        { a: 'Automatic payout', ad: 'Winners claim to a Loofta balance and cash out their way.', b: 'DM for wallets', bd: 'Chase winners for addresses, send one by one.' },
      ],
      faqs: FAQ.map(([q, a], i) => ({ q, a, open: s.faq === i, mark: s.faq === i ? '−' : '+', toggle: () => set({ faq: s.faq === i ? -1 : i }) })),
      isMobile: s.w < 760, summary: gv.gwPrizeCost + ' · ' + gv.gwTotal + ' total',
      launch: () => { if (gv._cost > 0 && gv._tasks) set({ launchStep: 'signin' }); },
      showLaunch: !!step, isSignin: step === 'signin', isFund: step === 'fund', isLive: step === 'live', closeLaunch: () => set({ launchStep: null }),
      signOpts: [['email', 'Continue with email', '@'], ['x', 'Continue with X', '𝕏'], ['wallet', 'Connect a wallet', '◆']].map(([k, label, g]) => ({ label, g, set: () => { set({ signMethod: k }); this._t = setTimeout(() => this.setState({ launchStep: 'fund' }), 700); }, bg: s.signMethod === k ? 'rgba(255,90,26,0.1)' : '#1A1A20', border: s.signMethod === k ? 'rgba(255,122,42,0.6)' : 'rgba(255,255,255,0.07)' })),
      fundOpts: [['card', 'Card or bank', 'Apple Pay, Google Pay, bank transfer'], ['balance', 'Loofta balance', '$250.00 available'], ['crypto', 'Crypto wallet', 'USDC on Solana or any chain']].map(([k, label, sub]) => ({ label, sub, set: () => set({ fundMethod: k }), bg: s.fundMethod === k ? 'rgba(255,90,26,0.1)' : '#1A1A20', border: s.fundMethod === k ? 'rgba(255,122,42,0.7)' : 'rgba(255,255,255,0.07)', ring: s.fundMethod === k ? '#FF7A2A' : '#4A4A55', dot: s.fundMethod === k ? '#FF7A2A' : 'transparent' })),
      payNow: () => set({ launchStep: 'live' }), launchTitle: step === 'signin' ? 'Sign in to launch' : step === 'fund' ? (isAuto ? 'Start your subscription' : 'Fund your giveaway') : gv._needsReview ? 'Submitted for review' : isAuto ? 'Auto-pilot is on' : 'Your giveaway is live',
      liveTitle: gv._needsReview ? 'Submitted for review' : isAuto ? 'Auto-pilot is on' : 'Your giveaway is live',
      liveNote: gv._needsReview ? gv._reviewNote : isAuto ? 'Your next post becomes a raid. Raiders are verified and rewarded automatically.' : 'Pools under $250 from verified hosts go live straight away. Share it below.',
      shareItems: [{ k: 'Post on X', v: 'Tweet text with your giveaway link' }, { k: 'Giveaway image', v: 'Ready-made card for X and Telegram' }, { k: 'Telegram message', v: 'Copy-paste announcement' }, { k: 'Short link', v: 'loofta.xyz/g/oct-drop' }],
    };
  }
}


export function renderSpec(state, setState, inst) {
  const c = new SpecComponent();
  c.state = state;
  c.setState = setState;
  c._c = inst._c;
  c._t = inst._t;
  c.createRef = (el) => { inst._c = el; };
  c.toCreate = () => {
    const el = inst._c;
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: "smooth" });
  };
  const vals = c.renderVals();
  inst._t = c._t;
  return vals;
}
