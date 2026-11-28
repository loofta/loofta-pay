// <ample-pack-3d phase="idle|filling|shake|open" card='{"name","set","grade","value","rarity"}' progress="0..1" tuning='{"charge":3,...}'>
// Opening: charge (shake builds) -> tear (the top strip rips off left to right) -> rise (the card slides out) -> hold -> flip (reveal burst).
// Events: 'tear' when the rip starts, 'flip' at the reveal (detail.rarity), 'revealed' when it settles.
// 3D Ample x Loofta pack (adapted from the PoolRip Gacha Pack 3D). Reveals a collectible card when phase becomes "open".
(function () {
  if (customElements.get('ample-pack-3d-v9')) return;
  const AW = 760, AH = 1120;
  let RED = '#FF1301', ORG = '#FF6A00', YEL = '#EAB308', GOLD_L = '#FFE9A8', GOLD_M = '#E8B23A', GOLD_D = '#9A6B12', INK = '#0B0B0F';
  const PAPER = '#FFFDF7';
  let BODY = ['#FFF6DA', '#E9D49A', '#F7E8B8', '#BFA05A'], EDGE = ['#CFC9BA', '#FFFFFF', '#D9D3C4'], TXT = [], EXT = '#5A3A07', BADGE = '/logos/F1.svg';
  // Pack colorways, picked with the `theme` attribute: gold (default), silver, red, bordeaux.
  const PALETTES = {
    ample: { RED: '#2F9E6A', ORG: '#4FC38A', YEL: '#B8F0CF', GOLD_L: '#FFFFFF', GOLD_M: '#BFEBD3', GOLD_D: '#2B6E4B', INK: '#0B1F16', BODY: ['#6FD6A0', '#2F9E6A', '#58C98E', '#1F6B47'], EDGE: ['#1F6B47', '#9FE8C2', '#2A7F57'], TXT: ['#FFFFFF', '#DFF7EA', '#7BC49A', '#F2FFF8', '#B8EBD0', '#3F8F68'], EXT: '#0E3A25', BADGE: '/ample-pack/badge.svg' },
    gold: { RED: '#FF1301', ORG: '#FF6A00', YEL: '#EAB308', GOLD_L: '#FFE9A8', GOLD_M: '#E8B23A', GOLD_D: '#9A6B12', INK: '#0B0B0F', BODY: ['#FFF6DA', '#E9D49A', '#F7E8B8', '#BFA05A'], EDGE: ['#B9A468', '#FFF6DA', '#C9B070'], TXT: ['#FFF4C8', '#F6CD62', '#B8791A', '#FFE9A0', '#D9A331', '#8A5A0B'], EXT: '#5A3A07', BADGE: '/logos/F1.svg' },
    silver: { RED: '#5B7DA8', ORG: '#8FB0D4', YEL: '#DCE8F4', GOLD_L: '#FFFFFF', GOLD_M: '#C3CBD6', GOLD_D: '#6B7480', INK: '#171A21', BODY: ['#E4E8ED', '#AEB6C2', '#D5DBE3', '#7D8794'], EDGE: ['#6F7885', '#D8DEE6', '#8A93A0'], TXT: ['#FFFFFF', '#DDE3EA', '#7D8794', '#F4F7FA', '#B4BDC8', '#5F6874'], EXT: '#39414C', BADGE: '/logos/F1-silver.svg' },
    red: { RED: '#FF3B1F', ORG: '#FF6A00', YEL: '#EAB308', GOLD_L: '#FFE9A8', GOLD_M: '#E8B23A', GOLD_D: '#9A6B12', INK: '#2A0508', BODY: ['#E5262E', '#B3121B', '#D4202A', '#8C0C14'], EDGE: ['#7A0A12', '#E5262E', '#8C0C14'], TXT: ['#FFF4C8', '#F6CD62', '#B8791A', '#FFE9A0', '#D9A331', '#8A5A0B'], EXT: '#3A0A0C', BADGE: '/logos/F1.svg' },
    bordeaux: { RED: '#C23B5E', ORG: '#E8B7A0', YEL: '#F3D9C8', GOLD_L: '#F6D3C0', GOLD_M: '#D9987E', GOLD_D: '#8A4A3A', INK: '#1E0610', BODY: ['#56102A', '#380817', '#4A0D22', '#240510'], EDGE: ['#1E040C', '#56102A', '#2A0612'], TXT: ['#FFE9DE', '#F0B8A0', '#9A5A48', '#FFE0D2', '#D4927C', '#6E3A30'], EXT: '#2A1010', BADGE: '/logos/F1-rose.svg' },
  };
  const applyPalette = name => { const p = PALETTES[name] || PALETTES.gold; ({ RED, ORG, YEL, GOLD_L, GOLD_M, GOLD_D, INK, BODY, EDGE, TXT, EXT, BADGE } = p); };
  let THREE_P = null;
  // three.js is served from our own origin (/vendor/ample-three.js, bundled from the app's three): the page's CSP does not allow third-party scripts.
  const loadThree = () => THREE_P || (THREE_P = import('/vendor/ample-three.js?v=1').then(m => [m.THREE, m, m, m, m, m, m, m, m]));
  const loadSvg = url => fetch(url).then(r => r.text()).then(t => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(t))); })).catch(() => null);

  function goldGrad(x, x0, y0, x1, y1) { const g = x.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, GOLD_D); g.addColorStop(.22, GOLD_M); g.addColorStop(.5, GOLD_L); g.addColorStop(.78, GOLD_M); g.addColorStop(1, GOLD_D); return g; }
  function brandGrad(x, x0, y0, x1, y1) { const g = x.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, RED); g.addColorStop(.55, ORG); g.addColorStop(1, YEL); return g; }
  function star(x, cx, cy, r) { x.beginPath(); for (let i = 0; i < 10; i++) { const rad = i % 2 ? r * .44 : r, a = -Math.PI / 2 + i * Math.PI / 5, px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad; i ? x.lineTo(px, py) : x.moveTo(px, py); } x.closePath(); }
  function crimp(x, y, h, dir) {
    x.save(); x.fillStyle = INK; x.globalAlpha = .9; x.fillRect(0, y, AW, h); x.globalAlpha = .16; x.fillStyle = '#fff';
    for (let i = 0; i < AW; i += 9) x.fillRect(i, y, 3, h);
    x.globalAlpha = .9; x.fillStyle = INK; const teeth = 30, tw = AW / teeth, base = dir > 0 ? y + h : y, tip = base + dir * 14;
    x.beginPath(); x.moveTo(0, base); for (let i = 0; i < teeth; i++) { x.lineTo(i * tw + tw / 2, tip); x.lineTo((i + 1) * tw, base); } x.closePath(); x.fill(); x.restore();
  }
  function medallion(x, cx, cy, r) {
    x.save(); x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fillStyle = goldGrad(x, cx - r, cy - r, cx + r, cy + r); x.fill(); x.lineWidth = 3; x.strokeStyle = GOLD_D; x.stroke();
    const ri = r - 26;
    x.save(); x.beginPath(); x.arc(cx, cy, ri, Math.PI, 0); x.closePath(); x.clip(); x.fillStyle = brandGrad(x, cx - ri, cy - ri, cx + ri, cy); x.fillRect(cx - ri, cy - ri, ri * 2, ri);
    x.globalAlpha = .28; x.fillStyle = '#fff'; x.beginPath(); x.ellipse(cx - ri * .3, cy - ri * .55, ri * .42, ri * .22, -.5, 0, 7); x.fill(); x.restore();
    x.save(); x.beginPath(); x.arc(cx, cy, ri, 0, Math.PI); x.closePath(); x.clip(); const lg = x.createLinearGradient(0, cy, 0, cy + ri); lg.addColorStop(0, '#FFFFFF'); lg.addColorStop(1, '#E4DFD3'); x.fillStyle = lg; x.fillRect(cx - ri, cy, ri * 2, ri); x.restore();
    x.save(); x.beginPath(); x.arc(cx, cy, ri, 0, 7); x.clip(); x.fillStyle = INK; x.fillRect(cx - ri, cy - ri * .135, ri * 2, ri * .27); x.fillStyle = goldGrad(x, cx - ri, 0, cx + ri, 0); x.fillRect(cx - ri, cy - ri * .152, ri * 2, 4); x.fillRect(cx - ri, cy + ri * .135, ri * 2, 4); x.restore();
    const br = r * .3; x.beginPath(); x.arc(cx, cy, br + 12, 0, 7); x.fillStyle = goldGrad(x, cx - br, cy - br, cx + br, cy + br); x.fill();
    x.beginPath(); x.arc(cx, cy, br, 0, 7); x.fillStyle = PAPER; x.fill(); x.lineWidth = 3; x.strokeStyle = GOLD_D; x.stroke();
    x.textAlign = 'center'; x.fillStyle = brandGrad(x, cx - br, cy - br, cx + br, cy + br); x.font = `500 ${Math.round(br * 1.5)}px "Clash Display"`; x.fillText('?', cx, cy + br * .53); x.restore();
  }
  // Deterministic pseudo-random so the foil texture is identical on both halves of the pack.
  function rng(seed) { let t = seed >>> 0; return () => ((t = (t * 1664525 + 1013904223) >>> 0) / 4294967296); }
  // Brushed, extruded metal lettering (same look as the website logo).
  function metalText(x, text, cx, y, size, maxW, italic) {
    x.save(); x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    let fs = size; const font = f => `${italic ? 'italic ' : ''}700 ${f}px "Clash Display"`; x.font = font(fs);
    while (fs > 14 && x.measureText(text).width > maxW) { fs -= 2; x.font = font(fs); }
    const depth = Math.max(3, Math.round(fs / 13));
    x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = fs * .3; x.shadowOffsetY = fs * .14; x.fillStyle = EXT; x.fillText(text, cx + depth * .3, y + depth);
    x.shadowColor = 'transparent';
    for (let d = depth; d >= 1; d--) { x.fillStyle = EXT; x.fillText(text, cx + d * .3, y + d); }
    const g = x.createLinearGradient(0, y - fs * .8, 0, y); TXT.forEach((c, i) => g.addColorStop(i / (TXT.length - 1), c));
    x.fillStyle = g; x.fillText(text, cx, y);
    x.lineWidth = Math.max(1, fs / 40); x.strokeStyle = 'rgba(255,255,255,.4)'; x.strokeText(text, cx, y);
    x.restore();
  }
  function drawPack(x, face, logo, badge, meta) {
    meta = meta || {};
    x.clearRect(0, 0, AW, AH);
    // 1. metal foil body
    const base = x.createLinearGradient(0, 0, AW, AH); base.addColorStop(0, BODY[0]); base.addColorStop(.38, BODY[1]); base.addColorStop(.62, BODY[2]); base.addColorStop(1, BODY[3]); x.fillStyle = base; x.fillRect(0, 0, AW, AH);
    // 2. brushed streaks + a faint diagonal weave, like stamped foil
    const R = rng(face === 'front' ? 7 : 11);
    for (let i = 0; i < 1500; i++) { const yy = R() * AH, xx = R() * AW, len = 60 + R() * 380; x.globalAlpha = .025 + R() * .065; x.fillStyle = R() < .5 ? '#fff' : '#000'; x.fillRect(xx - len / 2, yy, len, .8 + R() * 1.6); }
    x.globalAlpha = .06; x.strokeStyle = '#fff'; x.lineWidth = 2; for (let k = -AH; k < AW + AH; k += 36) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k + AH * .55, AH); x.stroke(); }
    x.globalAlpha = 1;
    // 3. broad light sweeps
    x.save(); x.translate(AW / 2, AH / 2); x.rotate(-.62);
    [[-60, 300, .55], [330, 90, .35]].forEach(([off, w, a]) => { x.globalAlpha = a; const sh = x.createLinearGradient(-AW, 0, AW, 0); sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(.5, 'rgba(255,255,255,.9)'); sh.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = sh; x.fillRect(-AW, off - w / 2, AW * 2, w); });
    x.restore(); x.globalAlpha = 1;
    // 4. dark curved caps top and bottom, edged in metal
    x.fillStyle = INK; x.beginPath(); x.moveTo(0, 0); x.lineTo(AW, 0); x.lineTo(AW, 132); x.bezierCurveTo(AW * .64, 322, AW * .30, 292, 0, 196); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(0, AH); x.lineTo(AW, AH); x.lineTo(AW, AH - 248); x.bezierCurveTo(AW * .60, AH - 430, AW * .26, AH - 392, 0, AH - 286); x.closePath(); x.fill();
    x.lineWidth = 7; x.strokeStyle = goldGrad(x, 0, 0, AW, 0);
    x.beginPath(); x.moveTo(AW, 152); x.bezierCurveTo(AW * .64, 342, AW * .30, 312, 0, 216); x.stroke();
    x.beginPath(); x.moveTo(AW, AH - 268); x.bezierCurveTo(AW * .60, AH - 450, AW * .26, AH - 412, 0, AH - 306); x.stroke();
    const cx = AW / 2;
    if (face === 'front') {
      // wordmark alone in the top cap (no "by Loofta" on the pack)
      metalText(x, 'AMPLE', cx, 206, 128, 560, true);
      // emblem: glow, then the metal badge
      const bw = 410, bh = bw * 160 / 168, by = 340;
      const glow = x.createRadialGradient(cx, by + bh / 2, 20, cx, by + bh / 2, 330); glow.addColorStop(0, 'rgba(255,255,255,.55)'); glow.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = glow; x.fillRect(0, by - 120, AW, bh + 240);
      if (badge) { x.save(); x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = 40; x.shadowOffsetY = 22; x.drawImage(badge, cx - bw / 2, by, bw, bh); x.restore(); }
      // tier + mode in the bottom cap
      // what's inside, big (every pack is Pokémon), then the tier and the mode
      metalText(x, 'x LOOFTA', cx, AH - 236, 96, 560, true);
      { const line = [meta.label, meta.sub].filter(Boolean).join(' · ').toUpperCase() || 'FREE PACK';
        x.save(); x.textAlign = 'center'; x.fillStyle = goldGrad(x, cx - 220, 0, cx + 220, 0); x.letterSpacing = '6px';
        let fs = 32; x.font = `600 ${fs}px "Clash Display"`; while (fs > 18 && x.measureText(line).width > 560) { fs -= 2; x.font = `600 ${fs}px "Clash Display"`; }
        x.fillText(line, cx, AH - 176); x.restore(); }
    } else {
      // Back: no Loofta logo (the front already says "by Loofta"), just the badge and the name.
      const bw = 300, bh = bw * 160 / 168, by = 330;
      const glow = x.createRadialGradient(cx, by + bh / 2, 20, cx, by + bh / 2, 260); glow.addColorStop(0, 'rgba(255,255,255,.5)'); glow.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = glow; x.fillRect(0, by - 100, AW, bh + 200);
      if (badge) { x.save(); x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = 30; x.shadowOffsetY = 16; x.drawImage(badge, cx - bw / 2, by, bw, bh); x.restore(); }
      metalText(x, 'AMPLE', cx, 700, 110, 560, true);
      x.save(); x.textAlign = 'center';
      x.fillStyle = goldGrad(x, cx - 260, 0, cx + 260, 0); x.font = '600 34px "Clash Display"'; x.letterSpacing = '9px'; x.fillText('FREE PACK', cx, 140);
      x.fillText('AMPLE x LOOFTA', cx, 192);
      x.fillStyle = 'rgba(255,255,255,.62)'; x.font = '500 23px "Clash Display"'; x.letterSpacing = '4px';
      x.fillText('EARNED BY PAYING ON LOOFTA', cx, AH - 232); x.fillText('BONUS DRAW TICKETS', cx, AH - 190); x.fillText('DEPOSIT TO UNLOCK', cx, AH - 148);
      x.restore();
    }
    crimp(x, 0, 46, 1); crimp(x, AH - 46, 46, -1);
    x.save(); x.globalAlpha = .55; x.fillStyle = '#3A3A44'; x.beginPath(); x.ellipse(AW / 2, 74, 30, 13, 0, 0, 7); x.fill(); x.restore();
  }
  const RAR = { common: ['#9AA4B2', '#E9EDF2'], uncommon: ['#34D399', '#C9F7E4'], rare: ['#4C8DFF', '#CFE0FF'], epic: ['#A45CFF', '#E6D2FF'], legendary: ['#E8B23A', '#FFE9A8'] };
  function drawCard(c, card, img) {
    const W = 630, H = 880, x = c.getContext('2d'), [ac, al] = RAR[card.rarity] || RAR.rare;
    x.fillStyle = '#16161C'; x.fillRect(0, 0, W, H);
    const fr = x.createLinearGradient(0, 0, W, H); fr.addColorStop(0, ac); fr.addColorStop(.5, al); fr.addColorStop(1, ac);
    x.fillStyle = fr; x.fillRect(0, 0, W, H);
    x.fillStyle = '#121217'; x.beginPath(); x.roundRect ? x.roundRect(26, 26, W - 52, H - 52, 22) : x.rect(26, 26, W - 52, H - 52); x.fill();
    if (card.kind === 'cash' || card.kind === 'stocks' || card.kind === 'device' || card.kind === 'game') { // Ample prizes
      const cx = W / 2, pad = 26, bw = W - 52, bh = H - 52;
      const clipCard = () => { x.beginPath(); x.roundRect ? x.roundRect(pad, pad, bw, bh, 22) : x.rect(pad, pad, bw, bh); x.clip(); };
      x.save(); clipCard(); x.textAlign = 'center';
      const head = (col) => { x.fillStyle = col; x.font = '600 30px "Clash Display"'; x.letterSpacing = '7px'; x.fillText('AMPLE x LOOFTA', cx, 110); x.letterSpacing = '0px'; };
      if (card.kind === 'cash') {
        const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#58B77C'); g.addColorStop(1, '#14502F'); x.fillStyle = g; x.fillRect(0, 0, W, H); head('#E6FFEF');
        x.fillStyle = '#fff'; x.shadowColor = 'rgba(0,0,0,.35)'; x.shadowBlur = 24; x.shadowOffsetY = 10; x.font = '700 ' + (String(card.title).length > 4 ? 230 : 290) + 'px "Clash Display"'; x.fillText(card.title, cx, H * .55); x.shadowBlur = 0; x.shadowOffsetY = 0;
        x.fillStyle = '#E6FFEF'; x.font = '600 56px "Clash Display"'; x.letterSpacing = '12px'; x.fillText('CASH', cx, H * .55 + 96); x.letterSpacing = '3px'; x.font = '500 26px "Clash Display"'; x.fillText('PAID IN USDC', cx, H - 110);
      } else if (card.kind === 'stocks') {
        const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#14307A'); g.addColorStop(1, '#0A1233'); x.fillStyle = g; x.fillRect(0, 0, W, H); head('#BFD2FF');
        const pts = [[90, 560], [160, 520], [220, 535], [280, 470], [340, 480], [400, 400], [460, 350], [520, 280]];
        pts.forEach(([px, py], i) => { x.fillStyle = i % 4 === 1 ? '#FF7A8A' : '#6FD6A0'; x.fillRect(px - 9, py, 18, 70); });
        x.strokeStyle = '#FFD36A'; x.lineWidth = 10; x.lineCap = 'round'; x.lineJoin = 'round'; x.beginPath(); pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.stroke();
        x.fillStyle = '#FFD36A'; x.beginPath(); x.arc(520, 280, 16, 0, 7); x.fill();
        x.fillStyle = '#fff'; x.font = '700 64px "Clash Display"'; x.fillText(card.title, cx, H - 170); x.fillStyle = '#BFD2FF'; x.font = '500 34px "Clash Display"'; x.fillText(card.sub, cx, H - 112);
      } else if (card.kind === 'device') {
        x.fillStyle = '#F4F5F7'; x.fillRect(0, 0, W, H); head('#3B4A42');
        if (img) { const k = Math.min((bw - 40) / img.width, 520 / img.height), iw = img.width * k, ih = img.height * k; x.globalCompositeOperation = 'multiply'; x.drawImage(img, cx - iw / 2, 150 + (520 - ih) / 2, iw, ih); x.globalCompositeOperation = 'source-over'; }
        x.fillStyle = '#111'; x.font = '700 78px "Clash Display"'; x.fillText(card.title, cx, H - 150); x.fillStyle = '#5A6660'; x.font = '500 32px "Clash Display"'; x.fillText(card.sub, cx, H - 98);
      } else {
        x.fillStyle = '#2A1250'; x.fillRect(0, 0, W, H);
        if (img) { const k = Math.max(bw / img.width, bh / img.height), iw = img.width * k, ih = img.height * k; x.drawImage(img, cx - iw / 2, pad + (bh - ih) / 2, iw, ih); }
        const g = x.createLinearGradient(0, H * .6, 0, H); g.addColorStop(0, 'rgba(10,4,24,0)'); g.addColorStop(1, 'rgba(10,4,24,.92)'); x.fillStyle = g; x.fillRect(0, H * .55, W, H * .45);
        x.fillStyle = '#fff'; x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 16; x.font = '700 84px "Clash Display"'; x.fillText(card.title, cx, H - 120); x.shadowBlur = 0; x.fillStyle = 'rgba(255,255,255,.8)'; x.font = '500 32px "Clash Display"'; x.fillText(card.sub, cx, H - 70);
      }
      x.restore(); return;
    }
    if (card.kind === 'cash' || card.kind === 'stocks' || card.kind === 'device' || card.kind === 'game') { // Ample prizes
      const cx = W / 2, pad = 26, bw = W - 52, bh = H - 52;
      x.save(); x.beginPath(); x.roundRect ? x.roundRect(pad, pad, bw, bh, 22) : x.rect(pad, pad, bw, bh); x.clip(); x.textAlign = 'center';
      const head = (col) => { x.fillStyle = col; x.font = '600 30px "Clash Display"'; x.letterSpacing = '7px'; x.fillText('AMPLE x LOOFTA', cx, 110); x.letterSpacing = '0px'; };
      if (card.kind === 'cash') {
        const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#58B77C'); g.addColorStop(1, '#14502F'); x.fillStyle = g; x.fillRect(0, 0, W, H); head('#E6FFEF');
        x.fillStyle = '#fff'; x.shadowColor = 'rgba(0,0,0,.35)'; x.shadowBlur = 24; x.shadowOffsetY = 10; x.font = '700 ' + (String(card.title).length > 4 ? 230 : 290) + 'px "Clash Display"'; x.fillText(card.title, cx, H * .55); x.shadowBlur = 0; x.shadowOffsetY = 0;
        x.fillStyle = '#E6FFEF'; x.font = '600 56px "Clash Display"'; x.letterSpacing = '12px'; x.fillText('CASH', cx, H * .55 + 96); x.letterSpacing = '3px'; x.font = '500 26px "Clash Display"'; x.fillText('PAID IN USDC', cx, H - 110);
      } else if (card.kind === 'stocks') {
        const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#14307A'); g.addColorStop(1, '#0A1233'); x.fillStyle = g; x.fillRect(0, 0, W, H); head('#BFD2FF');
        const pts = [[90, 560], [160, 520], [220, 535], [280, 470], [340, 480], [400, 400], [460, 350], [520, 280]];
        pts.forEach(([px, py], i) => { x.fillStyle = i % 4 === 1 ? '#FF7A8A' : '#6FD6A0'; x.fillRect(px - 9, py, 18, 70); });
        x.strokeStyle = '#FFD36A'; x.lineWidth = 10; x.lineCap = 'round'; x.lineJoin = 'round'; x.beginPath(); pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.stroke();
        x.fillStyle = '#FFD36A'; x.beginPath(); x.arc(520, 280, 16, 0, 7); x.fill();
        x.fillStyle = '#fff'; x.font = '700 64px "Clash Display"'; x.fillText(card.title, cx, H - 170); x.fillStyle = '#BFD2FF'; x.font = '500 34px "Clash Display"'; x.fillText(card.sub, cx, H - 112);
      } else if (card.kind === 'device') {
        x.fillStyle = '#F4F5F7'; x.fillRect(0, 0, W, H); head('#3B4A42');
        if (img) { const k = Math.min((bw - 40) / img.width, 520 / img.height), iw = img.width * k, ih = img.height * k; x.globalCompositeOperation = 'multiply'; x.drawImage(img, cx - iw / 2, 150 + (520 - ih) / 2, iw, ih); x.globalCompositeOperation = 'source-over'; }
        x.fillStyle = '#111'; x.font = '700 78px "Clash Display"'; x.fillText(card.title, cx, H - 150); x.fillStyle = '#5A6660'; x.font = '500 32px "Clash Display"'; x.fillText(card.sub, cx, H - 98);
      } else {
        x.fillStyle = '#2A1250'; x.fillRect(0, 0, W, H);
        if (img) { const k = Math.max(bw / img.width, bh / img.height), iw = img.width * k, ih = img.height * k; x.drawImage(img, cx - iw / 2, pad + (bh - ih) / 2, iw, ih); }
        const g = x.createLinearGradient(0, H * .6, 0, H); g.addColorStop(0, 'rgba(10,4,24,0)'); g.addColorStop(1, 'rgba(10,4,24,.92)'); x.fillStyle = g; x.fillRect(0, H * .55, W, H * .45);
        x.fillStyle = '#fff'; x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 16; x.font = '700 84px "Clash Display"'; x.fillText(card.title, cx, H - 120); x.shadowBlur = 0; x.fillStyle = 'rgba(255,255,255,.8)'; x.font = '500 32px "Clash Display"'; x.fillText(card.sub, cx, H - 70);
      }
      x.restore(); return;
    }
    if (img) { // the real Collector Crypt scan, fitted inside the rarity frame
      const bw = W - 52, bh = H - 52, k = Math.min(bw / img.width, bh / img.height), iw = img.width * k, ih = img.height * k;
      x.save(); x.beginPath(); x.roundRect ? x.roundRect(26, 26, bw, bh, 22) : x.rect(26, 26, bw, bh); x.clip();
      x.drawImage(img, 26 + (bw - iw) / 2, 26 + (bh - ih) / 2, iw, ih); x.restore(); return;
    }
    if (card.tickets !== undefined) { // Ample pack result: the bonus tickets on a green card
      const cx = W / 2, g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#1F6B47'); g.addColorStop(.5, '#0B1F16'); g.addColorStop(1, '#1F6B47');
      x.save(); x.beginPath(); x.roundRect ? x.roundRect(26, 26, W - 52, H - 52, 22) : x.rect(26, 26, W - 52, H - 52); x.clip(); x.fillStyle = g; x.fillRect(0, 0, W, H);
      const gl = x.createRadialGradient(cx, H * .42, 10, cx, H * .42, 360); gl.addColorStop(0, 'rgba(120,230,170,.55)'); gl.addColorStop(1, 'rgba(120,230,170,0)'); x.fillStyle = gl; x.fillRect(0, 0, W, H);
      x.textAlign = 'center'; x.fillStyle = '#B8EBD0'; x.font = '600 34px "Clash Display"'; x.letterSpacing = '8px'; x.fillText('AMPLE x LOOFTA', cx, 130);
      x.fillStyle = '#fff'; x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = 24; x.shadowOffsetY = 10; x.font = '700 220px "Clash Display"'; x.letterSpacing = '0px'; x.fillText('$' + String(card.tickets), cx, H * .54, W - 100);
      x.shadowBlur = 0; x.shadowOffsetY = 0; x.fillStyle = '#7BE0A8'; x.font = '600 46px "Clash Display"'; x.letterSpacing = '10px'; x.fillText('BONUS TICKETS', cx, H * .54 + 90);
      x.fillStyle = 'rgba(255,255,255,.65)'; x.font = '500 26px "Clash Display"'; x.letterSpacing = '3px'; x.fillText('DEPOSIT TO UNLOCK', cx, H - 110);
      x.restore(); return;
    }
    // scan not loaded yet: a mystery card, no text (the metadata can be wrong until the real scan is there)
    const hx = 50, hy = 50, hw = W - 100, hh = H - 100;
    const ho = x.createLinearGradient(hx, hy, hx + hw, hy + hh);
    ['#FF6A88', '#FFD36A', '#6AFFC4', '#6AB8FF', '#C46AFF', '#FF6A88'].forEach((col, i, a) => ho.addColorStop(i / (a.length - 1), col));
    x.save(); x.beginPath(); x.roundRect ? x.roundRect(hx, hy, hw, hh, 18) : x.rect(hx, hy, hw, hh); x.clip();
    x.fillStyle = ho; x.fillRect(hx, hy, hw, hh); x.globalAlpha = .35; x.fillStyle = '#000';
    for (let i = -hh; i < hw; i += 28) { x.beginPath(); x.moveTo(hx + i, hy); x.lineTo(hx + i + 14, hy); x.lineTo(hx + i + 14 + hh, hy + hh); x.lineTo(hx + i + hh, hy + hh); x.fill(); }
    x.restore();
    x.save(); x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = '700 340px "Clash Display"';
    x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 30; x.shadowOffsetY = 12; x.fillStyle = '#fff'; x.fillText('?', W / 2, H / 2 + 10); x.restore();
  }

  class AmplePack3D extends HTMLElement {
    static get observedAttributes() { return ['phase', 'card', 'progress', 'theme', 'label', 'sub', 'yaw', 'interactive', 'distance', 'tuning', 'atmosphere', 'hidecard']; }
    constructor() { super(); this._phase = 'idle'; this._card = {}; this._progress = 0; }
    set phase(v) { this.setAttribute('phase', v); } get phase() { return this._phase; }
    set card(v) { this.setAttribute('card', typeof v === 'string' ? v : JSON.stringify(v || {})); }
    set progress(v) { this.setAttribute('progress', String(v)); }
    replay() { this._replay && this._replay(); }
    attributeChangedCallback(n, o, v) {
      if (n === 'progress') this._progress = parseFloat(v) || 0;
      if (n === 'theme') this._theme = v || 'gold';
      if (n === 'yaw') this._yaw = (parseFloat(v) || 0) * Math.PI / 180; // degrees; 180 shows the back of the pack
      if (n === 'label') this._label = v || '';
      if (n === 'interactive') { this._interactive = v !== 'false'; if (this._controls) this._controls.enabled = this._interactive; }
      if (n === 'distance') this._distance = parseFloat(v) || 0; // camera distance; smaller = bigger pack (lobby cards use ~6.4)
      if (n === 'sub') this._sub = v || '';
      if (n === 'atmosphere') this._atmosphere = v === 'true';
      if (n === 'hidecard') this._hidecard = v === 'true';
      if (n === 'tuning') { try { this._tuning = JSON.parse(v || '{}'); } catch (e) { this._tuning = {}; } }
      if (n === 'card') { try { this._card = JSON.parse(v || '{}'); } catch (e) { this._card = {}; } this._cardDirty = true; this._cardImg = null;
        const src = this._card.image; if (src) { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => { if (this._card.image === src) { this._cardImg = im; this._cardDirty = true; } }; im.src = src; } }
      if (n === 'phase' && v !== this._phase) { this._phase = v || 'idle'; this._onPhase && this._onPhase(this._phase); }
    }
    connectedCallback() {
      this.style.display = 'block'; this.style.position = 'absolute'; this.style.inset = '0'; this.style.width = '100%'; this.style.height = '100%';
      if (this._started) return; this._started = true;
      this._init().catch(e => console.warn('ample-pack-3d-v9', e));
    }
    disconnectedCallback() { this._dead = true; this._ro && this._ro.disconnect(); this._io && this._io.disconnect(); this._renderer && this._renderer.dispose(); }
    async _init() {
      const [THREE, { OrbitControls }, { RoomEnvironment }, { EffectComposer }, { RenderPass }, { UnrealBloomPass }, { ShaderPass }, { OutputPass }, { RGBELoader }] = await loadThree();
      const POST = !!this._atmosphere; // big stages: bloom, god rays, HDRI; lobby cards: the cheap path
      // Canvas text does not trigger font downloads: load the exact faces the pack art uses, or the first pack on a
      // page can bake a serif fallback into its texture.
      try { await Promise.all(['italic 700 40px "Clash Display"', '700 40px "Clash Display"', '600 40px "Clash Display"', '500 20px "Clash Display"'].map((f) => document.fonts.load(f))); await document.fonts.ready; } catch (e) {}
      const logo = await loadSvg('/promo/loofta.svg');
      const badge = await loadSvg((PALETTES[this._theme] || PALETTES.gold).BADGE);
      const meta = { label: this._label, sub: this._sub };
      // The palette is module-level state shared by every pack on the page. Apply it after the last await, so the
      // synchronous texture building below always uses THIS pack's colors even when several packs load at once.
      applyPalette(this._theme);
      if (this._dead) return;
      const host = this, w0 = () => Math.max(50, host.clientWidth), h0 = () => Math.max(50, host.clientHeight);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); this._renderer = renderer;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(w0(), h0());
      renderer.shadowMap.enabled = false; // no drop shadows: the pack and card float in the light renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .95;
      renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;outline:none'; host.appendChild(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, w0() / h0(), .1, 100); camera.position.set(0, .4, this._distance || 10.6);
      const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.enablePan = false; controls.enableZoom = false; controls.zoomSpeed = .7; { const d0 = this._distance || 10.6; controls.minDistance = d0 * .45; controls.maxDistance = d0 * 1.5; } // wheel / pinch zoom controls.target.set(0, .5, 0);
      this._controls = controls; if (this._interactive === false) controls.enabled = false;
      // Dragging tilts the pack/card itself (the camera, smoke and backdrop stay still), and it springs back when released.
      controls.enableRotate = false;
      const tilt = { x: 0, y: 0, tx: 0, ty: 0 }; let grab = null;
      if (this._interactive !== false) { const el = renderer.domElement, lim = (v, m) => Math.max(-m, Math.min(m, v));
        el.addEventListener('pointerdown', (e) => { grab = { x: e.clientX, y: e.clientY, rx: tilt.tx, ry: tilt.ty, id: e.pointerId }; try { el.setPointerCapture(e.pointerId); } catch (err) {} });
        el.addEventListener('pointermove', (e) => { if (!grab) return; tilt.ty = lim(grab.ry + (e.clientX - grab.x) * .009, .75); tilt.tx = lim(grab.rx + (e.clientY - grab.y) * .006, .35); });
        const up = () => { grab = null; tilt.tx = tilt.ty = 0; }; el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); }
      const stepTilt = () => { const k = grab ? .25 : .07; tilt.x += (tilt.tx - tilt.x) * k; tilt.y += (tilt.ty - tilt.y) * k; };
      // Several packs can be on one page (lobby): only draw the ones on screen, and nothing while the tab is hidden.
      this._visible = true; this._io = new IntersectionObserver((es) => { this._visible = es.some((e) => e.isIntersecting); }, { rootMargin: '120px' }); this._io.observe(this);
      const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
      scene.add(new THREE.HemisphereLight(0xfff6e6, 0x141014, .6));
      const key = new THREE.DirectionalLight(0xfffaf0, 2.6); key.position.set(1.6, 6.2, 2.6); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 5;
      Object.assign(key.shadow.camera, { near: 1, far: 16, left: -3.4, right: 3.4, top: 4, bottom: -4 }); key.shadow.camera.updateProjectionMatrix(); scene.add(key);
      const rim = new THREE.DirectionalLight(0xffcf7a, 1.7); rim.position.set(-4.2, 1.8, -3.2); scene.add(rim);
      const glow = new THREE.PointLight(0xFFD98A, 0, 14); glow.position.set(0, .5, 1.4); scene.add(glow);
      const ground = new THREE.Mesh(new THREE.CircleGeometry(10, 64), new THREE.ShadowMaterial({ opacity: .26 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -1.42; ground.receiveShadow = true; scene.add(ground);
      const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
      const tex = c => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
      const full = {}; const art = f => full[f] || (full[f] = (() => { const c = cv(AW, AH); drawPack(c.getContext('2d'), f, logo, badge, meta); return c; })());
      const edgeT = (() => { const c = cv(64, 560), x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 64, 0); g.addColorStop(0, EDGE[0]); g.addColorStop(.45, EDGE[1]); g.addColorStop(1, EDGE[2]); x.fillStyle = g; x.fillRect(0, 0, 64, 560); return tex(c); })();
      const tornT = (() => { const c = cv(760, 64), x = c.getContext('2d'); x.fillStyle = '#B9B2A2'; x.fillRect(0, 0, 760, 64); x.fillStyle = PAPER; x.beginPath(); x.moveTo(0, 64); for (let i = 0; i <= 38; i++) x.lineTo(i * 20, i % 2 ? 18 : 44); x.lineTo(760, 64); x.closePath(); x.fill(); return tex(c); })();
      const crinkleT = (() => { const S = 512, c = cv(S, S), x = c.getContext('2d'); x.fillStyle = '#808080'; x.fillRect(0, 0, S, S);
        for (let i = 0; i < 40; i++) { x.save(); x.translate(Math.random() * S, Math.random() * S); x.rotate(Math.random() * Math.PI); const len = 30 + Math.random() * 90, g = x.createLinearGradient(0, -5, 0, 5); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.45, 'rgba(255,255,255,.5)'); g.addColorStop(.55, 'rgba(0,0,0,.46)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(-len / 2, -5, len, 10); x.restore(); } return tex(c); })();
      const PW = 2.32, PH = PW * AH / AW, PD = .4;
      // The pack is two pieces: a thin strip above the tear line (under the top crimp) and the body. Opening rips the
      // strip off from left to right, then the card rises out of the body.
      const TEAR = .155, SH = PH * TEAR, BH = PH - SH, tearY = PH / 2 - SH;
      const pouch = (geo, cy) => { const p = geo.attributes.position, hy = PH / 2;
        for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), u = Math.min(1, Math.abs(x) / (PW / 2)), v = Math.min(1, Math.abs(y + cy) / hy);
          const prof = Math.max(.3, Math.pow((1 - Math.pow(u, 4)) * (1 - Math.pow(v, 6)), .45)); p.setXYZ(i, x * (1 - .055 * Math.pow(v, 6)), y, z * prof); }
        p.needsUpdate = true; geo.computeVertexNormals(); return geo; };
      const crinkleN = (() => { const src = crinkleT.image, S = src.width, d = src.getContext('2d').getImageData(0, 0, S, S).data, c = cv(S, S), x = c.getContext('2d'), o = x.createImageData(S, S), h = (i, j) => d[(((j + S) % S) * S + ((i + S) % S)) * 4] / 255;
        for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const dx = (h(i + 1, j) - h(i - 1, j)) * 3.2, dy = (h(i, j + 1) - h(i, j - 1)) * 3.2, l = Math.hypot(dx, dy, 1), k = (j * S + i) * 4;
          o.data[k] = (-dx / l * .5 + .5) * 255; o.data[k + 1] = (-dy / l * .5 + .5) * 255; o.data[k + 2] = (1 / l * .5 + .5) * 255; o.data[k + 3] = 255; }
        x.putImageData(o, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1.4, 1.4); return t; })();
      const foil = map => new THREE.MeshPhysicalMaterial({ map, metalness: .22, roughness: .2, clearcoat: 1, clearcoatRoughness: .05, envMapIntensity: POST ? 1.5 : 1.25, normalMap: crinkleN, normalScale: new THREE.Vector2(.35, .35), iridescence: POST ? .28 : 0, iridescenceIOR: 1.35, iridescenceThicknessRange: [120, 420] });
      const slice = (f, a, b) => { const h = Math.round(AH * (b - a)), c = cv(AW, h); c.getContext('2d').drawImage(art(f), 0, AH * a, AW, AH * (b - a), 0, 0, AW, h); return tex(c); };
      const rig = new THREE.Group(); rig.position.y = .5; scene.add(rig); const pg = new THREE.Group(); rig.add(pg);
      // a piece of the pack between art rows a..b (0 = top), with the torn edge on its cut side
      const piece = (a, b, cutTop) => { const h = PH * (b - a), cy = PH / 2 - PH * (a + b) / 2, side = foil(edgeT), cut = new THREE.MeshPhysicalMaterial({ map: tornT, metalness: .05, roughness: .7 });
        const segX = 44, segY = Math.max(4, Math.round(24 * (b - a)));
        const m = new THREE.Mesh(pouch(new THREE.BoxGeometry(PW, h, PD, segX, segY, 2), cy), [side, side, cutTop ? cut : side, cutTop ? side : cut, foil(slice('front', a, b)), foil(slice('back', a, b))]);
        m.castShadow = true; m.position.y = cy; m.userData.rest = Float32Array.from(m.geometry.attributes.position.array); m.userData.cy = cy; return m; };
      const strip = piece(0, TEAR, false), body = piece(TEAR, 1, true); pg.add(strip, body);
      const cardGroup = new THREE.Group(); cardGroup.visible = false; scene.add(cardGroup);
      { let _v = false; Object.defineProperty(cardGroup, 'visible', { get: () => _v && !this._hidecard, set: (v) => { _v = v; }, configurable: true }); } // hidecard: the page shows the real product instead of the card
      const cardCanvas = cv(630, 880), cardTex = tex(cardCanvas);
      const cardFront = new THREE.MeshPhysicalMaterial({ map: cardTex, roughness: .35, metalness: .2, clearcoat: 1, clearcoatRoughness: .1 });
      // a proper card back (dark, gold frame, medallion), so the face-down card never looks like a second pack
      const cardBack = new THREE.MeshPhysicalMaterial({ map: (() => { const c = cv(630, 880), x = c.getContext('2d'); const bg = x.createLinearGradient(0, 0, 630, 880); bg.addColorStop(0, '#0F3A26'); bg.addColorStop(.5, INK); bg.addColorStop(1, '#0F3A26'); x.fillStyle = bg; x.fillRect(0, 0, 630, 880);
        x.save(); x.globalAlpha = .07; x.strokeStyle = GOLD_L; x.lineWidth = 2; for (let i = -880; i < 630; i += 26) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 880, 880); x.stroke(); } x.restore();
        x.lineWidth = 16; x.strokeStyle = goldGrad(x, 0, 0, 630, 880); x.beginPath(); x.roundRect ? x.roundRect(22, 22, 586, 836, 26) : x.rect(22, 22, 586, 836); x.stroke();
        medallion(x, 315, 400, 150); metalText(x, 'AMPLE', 315, 660, 90, 480, true); return tex(c); })(), roughness: .35, metalness: .3, clearcoat: 1 });
      const edge = new THREE.MeshStandardMaterial({ color: 0x3FA874, roughness: .4, metalness: .6 });
      const card = new THREE.Mesh(new THREE.BoxGeometry(2.3, 3.2, .04), [edge, edge, edge, edge, cardFront, cardBack]); card.castShadow = false; cardGroup.add(card);

      // ── effects: additive glow sprites (seam, beam, halo, shockwave), a flash, and one particle pool ──
      const glowTex = (() => { const c = cv(128, 128), x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.25, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
      const beamTex = (() => { const c = cv(64, 256), x = c.getContext('2d'), g = x.createLinearGradient(0, 256, 0, 0); g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 256); const h = x.createLinearGradient(0, 0, 64, 0); h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(.5, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)'); x.globalCompositeOperation = 'destination-out'; x.fillStyle = h; x.fillRect(0, 0, 64, 256); return new THREE.CanvasTexture(c); })();
      const ringTex = (() => { const c = cv(256, 256), x = c.getContext('2d'), g = x.createRadialGradient(128, 128, 70, 128, 128, 128); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.75, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c); })();
      const add = (map, w, h) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); m.renderOrder = 5; m.visible = false; return m; };
      const seam = add(glowTex, 1, .5); pg.add(seam); seam.position.set(0, tearY, PD / 2 + .03);
      const beam = add(beamTex, PW * 1.1, 5.5); beam.position.set(0, .5 + tearY + 2.2, -.3); scene.add(beam);
      const halo = add(glowTex, 6, 6); halo.position.set(0, .5, -.6); scene.add(halo);
      const ring = add(ringTex, 1, 1); ring.position.set(0, .5, .1); scene.add(ring);
      const flash = add(glowTex, 30, 30); flash.position.set(0, .5, 2.5); scene.add(flash);
      const N = 520, pGeo = new THREE.BufferGeometry(), pPos = new Float32Array(N * 3), pCol = new Float32Array(N * 3), pBase = new Float32Array(N * 3), pVel = new Float32Array(N * 3), pLife = new Float32Array(N), pMax = new Float32Array(N);
      pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
      const parts = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: .085, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); parts.frustumCulled = false; scene.add(parts);
      let pNext = 0; const tmpC = new THREE.Color();
      const emit = (x, y, z, vx, vy, vz, col, life) => { const i = pNext; pNext = (pNext + 1) % N; pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z; pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz; tmpC.set(col); pBase[i * 3] = tmpC.r; pBase[i * 3 + 1] = tmpC.g; pBase[i * 3 + 2] = tmpC.b; pLife[i] = life; pMax[i] = life; };
      const stepParts = dt => { for (let i = 0; i < N; i++) { if (pLife[i] <= 0) { pCol[i * 3] = pCol[i * 3 + 1] = pCol[i * 3 + 2] = 0; continue; } pLife[i] -= dt; const k = Math.max(0, pLife[i] / pMax[i]);
          pVel[i * 3 + 1] -= 2.2 * dt; pVel[i * 3] *= .985; pVel[i * 3 + 2] *= .985; pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
          pCol[i * 3] = pBase[i * 3] * k; pCol[i * 3 + 1] = pBase[i * 3 + 1] * k; pCol[i * 3 + 2] = pBase[i * 3 + 2] * k; }
        pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true; };
      const burst = (n, col, speed, y) => { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, el = (Math.random() - .3) * 1.2, s = speed * (.35 + Math.random() * .9);
        emit((Math.random() - .5) * .6, y + (Math.random() - .5) * .8, .2, Math.cos(a) * Math.cos(el) * s, Math.sin(el) * s + speed * .35, Math.sin(a) * Math.cos(el) * s * .6 + .4, Math.random() < .3 ? '#ffffff' : col, .9 + Math.random() * 1.1); } };

      // ── smoke: shader quads (domain-warped noise), so it swirls with soft edges instead of overlapping sprite blobs.
      // mode 0 = a cloud that grows from the center, 1 = a plume rising from the bottom edge, 2 = the backdrop haze ──
      const SMOKE_VS = 'uniform vec2 uCenter, uSize; uniform float uDepth; varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(uCenter + position.xy * 2.0 * uSize, uDepth, 1.0); }';
      const SMOKE_FS = `uniform float uTime, uAlpha, uGrow, uSeed, uMode; uniform vec3 uColA, uColB; varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
        float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }
        void main(){
          vec2 p = vUv * 2.0 - 1.0; float t = uTime;
          vec2 flow = uMode > 0.5 && uMode < 1.5 ? vec2(0.0, -t * 0.9) : vec2(t * 0.04, -t * 0.12);
          vec2 q = vec2(fbm(p * 1.5 + uSeed + flow), fbm(p * 1.5 + uSeed + vec2(5.2, 1.3) + flow * 1.1));
          float n = fbm(p * 2.1 + 2.2 * q + flow * 1.3);
          float mask;
          if (uMode < 0.5) { float r = length(p) / max(0.05, uGrow); mask = smoothstep(1.0, 0.25, r + (n - 0.5) * 0.7); }
          else if (uMode < 1.5) { float w = mix(0.22, 0.95, vUv.y); mask = smoothstep(w, w * 0.15, abs(p.x) + (n - 0.5) * 0.55) * smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.45, vUv.y); }
          else { mask = smoothstep(1.25, 0.15, length(p * vec2(0.75, 1.1))); }
          float d = smoothstep(0.32, 0.85, n) * mask;
          vec3 tint = mix(uColA, uColB, smoothstep(0.25, 0.8, q.x));
          float light = uMode > 1.5 ? 0.75 : clamp(1.25 - length(p) * 0.85, 0.0, 1.0);
          vec3 body = mix(vec3(0.05, 0.05, 0.07), tint, 0.25 + 0.75 * light) * (0.5 + 0.8 * n);
          vec3 rim = mix(uColB, uColA, q.y) * pow(1.0 - smoothstep(0.32, 0.85, n), 1.5) * light * 1.4;
          float a = d * uAlpha;
          gl_FragColor = vec4((body + rim) * a, a * 0.92);
        }`;
      const smokeQuad = (w, h, mode, seed) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.ShaderMaterial({ vertexShader: SMOKE_VS, fragmentShader: SMOKE_FS, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, premultipliedAlpha: true,
          uniforms: { uCenter: { value: new THREE.Vector2() }, uSize: { value: new THREE.Vector2(1, 1) }, uDepth: { value: .9999 }, uTime: { value: 0 }, uAlpha: { value: 0 }, uGrow: { value: 1 }, uSeed: { value: seed }, uMode: { value: mode }, uColA: { value: new THREE.Color() }, uColB: { value: new THREE.Color() } } }));
        m.visible = false; m.renderOrder = 3; m.frustumCulled = false; scene.add(m); return m; };
      // where a smoke layer sits on screen: centered on a world point, sized in world units, a bit behind (dz > 0) or in front of it
      const ssPlace = (m, world, w, h, dz) => { const u = m.material.uniforms, v = world.clone().project(camera), hh = camera.position.distanceTo(world) * Math.tan(camera.fov * Math.PI / 360);
        u.uCenter.value.set(v.x, v.y); u.uSize.value.set(w / 2 / hh / camera.aspect, h / 2 / hh); u.uDepth.value = Math.min(.9999, Math.max(-1, v.z + dz)); };
      const backdrop = smokeQuad(1, 1, 2, 3.1); backdrop.renderOrder = 0; // full screen, behind everything
      const plume = smokeQuad(1, 1, 1, 7.7); plume.renderOrder = 2;
      const clouds = [smokeQuad(1, 1, 0, 1.3), smokeQuad(1, 1, 0, 4.9), smokeQuad(1, 1, 0, 9.4)]; clouds[0].renderOrder = clouds[1].renderOrder = 2; clouds[2].renderOrder = 7;
      const CLOUD = [[-.5, .2, 8, 8, .003], [.6, -.2, 10, 7, .006], [0, -.1, 6, 6, -.004]], tmpV = new THREE.Vector3();
      const smokeSet = (m, a, colA, colB, t) => { const u = m.material.uniforms; m.visible = a > .002; u.uAlpha.value = a; u.uTime.value = t; if (colA) u.uColA.value.set(colA); if (colB) u.uColB.value.set(colB); };
      ground.visible = false; // no floor shadow (and nothing to cut the haze behind it)
      // a pink counter-color makes it read as real colored smoke instead of a flat tint (like the reference)
      const ACCENT = { common: '#9CC8FF', uncommon: '#3FA8FF', rare: '#FF4F8B', epic: '#FF4F8B', legendary: '#FF7A3D' };
      let revealAt = -1;
      const stageA = new THREE.Color('#E8B23A'), stageB = new THREE.Color('#2EC5FF'), fogC = new THREE.Color();

      // ── the P lights up: as the pack charges, the badge on its front glows hotter and hotter with each heartbeat,
      // light rays turning behind it, until the pack tears. Layers cut from the badge image itself, so they match it. ──
      // just the P: the dark strokes of the badge (the letter cut into the metal), as a white mask
      const letter = (() => { const W = 420, H = Math.round(W * 160 / 168), c = cv(W, H), x = c.getContext('2d');
        try { if (!badge) throw 0; x.drawImage(badge, 0, 0, W, H); const d = x.getImageData(0, 0, W, H), a = d.data;
          for (let i = 0; i < a.length; i += 4) { const lum = (a[i] * .3 + a[i + 1] * .59 + a[i + 2] * .11) / 255, m = a[i + 3] > 128 ? Math.max(0, Math.min(1, (.32 - lum) / .14)) : 0; a[i] = a[i + 1] = a[i + 2] = 255; a[i + 3] = m * 255; }
          x.putImageData(d, 0, 0); } catch (e) { x.clearRect(0, 0, W, H); x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = 'italic 700 300px "Clash Display"'; x.fillText('P', W / 2, H / 2 + 10); }
        return c; })();
      // ── the P lights up: the letter is an emissive part of the pack's own front material (bloom makes it glow), so it
      // lights like a real light behind the foil instead of a flat sticker on top ──
      const bodyFront = body.material[4];
      { const H = Math.round(AH * (1 - TEAR)), c = cv(AW, H), x = c.getContext('2d'), bw = 410, bh = bw * 160 / 168, bx = AW / 2 - bw / 2, by = 340 - AH * TEAR;
        x.fillStyle = '#000'; x.fillRect(0, 0, AW, H); x.filter = 'blur(10px)'; x.globalAlpha = .35; x.drawImage(letter, bx, by, bw, bh); x.filter = 'none'; x.globalAlpha = 1; x.drawImage(letter, bx, by, bw, bh);
        const em = tex(c); bodyFront.emissiveMap = em; bodyFront.emissive = new THREE.Color('#FFD36A'); bodyFront.emissiveIntensity = 0; bodyFront.needsUpdate = true; }
      const stepLogo = (t, k, color) => { if (k <= .01) { bodyFront.emissiveIntensity = 0; return 0; }
        const pulse = .6 + .4 * Math.pow(Math.abs(Math.sin(t * (4 + 10 * k))), 3);
        bodyFront.emissive.set(color || '#FFD36A'); bodyFront.emissiveIntensity = k * (POST ? 3.2 : 2.2) * pulse; return pulse; };

      // ── real light: bloom (a lens glow around anything brighter than white) and volumetric god rays from a light
      // source the pack and card really block, so the shafts come around their actual edges from any angle.
      // Only on big stages (atmosphere); the lobby packs keep the cheap path. ──
      let composer = null, bloom = null, grPass = null, occRT = null; const sunScene = new THREE.Scene(), sunMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        // a soft light with turning streaks, so the shafts break up like light through smoke instead of solid wedges
        fragmentShader: `uniform float uTime; varying vec2 vUv;
          float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float n(vec2 p){ vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
          void main(){ vec2 p = vUv * 2.0 - 1.0; float r = length(p), a = atan(p.y, p.x);
            float streak = 0.35 + 0.65 * n(vec2(a * 5.0 + uTime * 0.15, r * 1.5 - uTime * 0.4)) * n(vec2(a * 11.0 - uTime * 0.1, 3.0));
            float v = smoothstep(1.0, 0.15, r) * streak; gl_FragColor = vec4(vec3(v), 1.0); }` });
      const sun = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), sunMat); sunScene.add(sun);
      const blackMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
      if (POST) {
        scene.background = new THREE.Color('#0F6B45');
        composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
        bloom = new UnrealBloomPass(new THREE.Vector2(w0(), h0()), .45, .5, 1.05); // only true light sources (brighter than white) bloom composer.addPass(bloom);
        occRT = new THREE.WebGLRenderTarget(Math.round(w0() / 2), Math.round(h0() / 2));
        grPass = new ShaderPass({
          uniforms: { tDiffuse: { value: null }, tOcc: { value: null }, uLight: { value: new THREE.Vector2(.5, .5) }, uExposure: { value: 0 }, uColor: { value: new THREE.Color('#FFD36A') } },
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: `uniform sampler2D tDiffuse, tOcc; uniform vec2 uLight; uniform float uExposure; uniform vec3 uColor; varying vec2 vUv;
            void main(){ vec4 base = texture2D(tDiffuse, vUv); if (uExposure <= 0.001) { gl_FragColor = base; return; }
              vec2 d = (vUv - uLight) * (0.94 / 96.0); float j = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
              vec2 c = vUv - d * j; float illum = 1.0; vec3 acc = vec3(0.0); // dithered start: no stair-step banding
              for (int i = 0; i < 96; i++) { c -= d; acc += texture2D(tOcc, c).rgb * illum * 0.55; illum *= 0.974; }
              gl_FragColor = vec4(base.rgb + acc * uExposure * uColor, base.a); }`,
        }); grPass.uniforms.tOcc.value = occRT.texture; composer.addPass(grPass); // set after: ShaderPass clones its uniforms and drops render-target textures
        composer.addPass(new OutputPass());
        // a real studio HDRI for the foil and card reflections (CC0, Poly Haven), instead of the generic room
        new RGBELoader().load('/hdri/studio_1k.hdr', (hdr) => { if (this._dead) return; hdr.mapping = THREE.EquirectangularReflectionMapping; scene.environment = pmrem.fromEquirectangular(hdr).texture; hdr.dispose(); }, undefined, () => undefined);
      }
      const sunV = new THREE.Vector3();
      // the god-ray source: where the light is, how strong, what color
      // the light stays put behind what it hides; the shafts fade while the card is tilted away from the front
      const setSun = (x, y, z, size, exposure, color) => { sun.position.set(x, y, z); sun.scale.setScalar(size); sun.quaternion.copy(camera.quaternion); sunMat.uniforms.uTime.value = clock.getElapsedTime();
        if (grPass) { grPass.uniforms.uExposure.value = exposure * (1 - Math.min(1, Math.abs(tilt.y) * 1.3) * .75); if (color) grPass.uniforms.uColor.value.set(color); } };
      const renderFrame = (fx) => {
        if (!composer) { renderer.render(scene, camera); return; }
        if (grPass.uniforms.uExposure.value > .001) {
          // occlusion: the light alone, then every solid object in black on top of it (the effects are hidden)
          sunV.copy(sun.position).project(camera); grPass.uniforms.uLight.value.set(sunV.x * .5 + .5, sunV.y * .5 + .5);
          const was = fx.map(m => m.visible); fx.forEach(m => { m.visible = false; });
          const bg = scene.background; scene.background = null; renderer.setRenderTarget(occRT); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(sunScene, camera);
          scene.overrideMaterial = blackMat; renderer.autoClear = false; renderer.render(scene, camera); renderer.autoClear = true; scene.overrideMaterial = null; scene.background = bg;
          renderer.setRenderTarget(null); renderer.setClearColor(0x000000, 0); fx.forEach((m, i) => { m.visible = was[i]; });
        }
        composer.render(); };

      // Tuning (the /lab page edits these live): durations in seconds, strengths as multipliers.
      const T = () => Object.assign({ charge: 3.0, tear: .95, rise: 1.0, hold: .55, flip: .75, shake: 1, sparks: 1, burst: 1, camera: 1, speed: 1, smoke: 0, glow: 1, fog: 0, flash: 1 }, this._tuning || {});
      const RCOL = { common: '#CFF5E0', uncommon: '#5BE3AE', rare: '#3FD08A', epic: '#7BE0A8', legendary: '#FFD36A' };
      const rarityOf = () => { const r = String(this._card.rarity || '').toLowerCase(); return r.includes('legend') ? 'legendary' : r.includes('epic') ? 'epic' : r.includes('uncommon') ? 'uncommon' : r.includes('rare') ? 'rare' : r.includes('common') ? 'common' : 'rare'; };
      const big = r => (r === 'legendary' ? 2.2 : r === 'epic' ? 1.6 : r === 'rare' ? 1.15 : r === 'uncommon' ? .9 : .7);
      const d0 = this._distance || 10.6;
      const clock = new THREE.Clock(); let ph = 'idle', t0 = 0, last = 0, tune = T(), rar = 'rare', col = RCOL.rare;
      const restore = m => { m.geometry.attributes.position.array.set(m.userData.rest); m.geometry.attributes.position.needsUpdate = true; m.geometry.computeVertexNormals(); };
      const fadeAll = (m, o) => m.material.forEach(mt => { mt.transparent = o < 1; mt.opacity = o; });
      const reset = () => { cardGroup.visible = false; rig.visible = true; restore(strip); strip.position.set(0, strip.userData.cy, 0); strip.rotation.set(0, 0, 0); strip.visible = true; body.position.set(0, body.userData.cy, 0); body.rotation.set(0, 0, 0);
        fadeAll(strip, 1); fadeAll(body, 1); [seam, beam, halo, ring, flash].forEach(m => { m.visible = false; m.material.opacity = 0; }); pLife.fill(0); [plume, ...clouds].forEach(m => { m.visible = false; m.material.uniforms.uAlpha.value = 0; }); revealAt = -1; stepLogo(0, 0); pg.scale.set(1, 1, 1); this._charged = false; setSun(0, 0, 0, 1, 0); if (bloom) bloom.strength = .55; glow.intensity = 0; camera.fov = 38; camera.updateProjectionMatrix(); };
      const go = p => {
        if (p === 'idle' || p === 'filling') { reset(); ph = 'idle'; return; }
        if (p === 'shake' && ph === 'idle') { ph = 'shake'; t0 = clock.getElapsedTime(); return; }
        if (p === 'open') { if (ph === 'idle') { ph = 'shake'; t0 = clock.getElapsedTime(); this._autoOpen = true; } else if (ph === 'shake') this._autoOpen = true; }
      };
      this._onPhase = go; go(this._phase);
      this._replay = () => { reset(); ph = 'shake'; t0 = clock.getElapsedTime(); this._autoOpen = true; }; // the lab page replays without remounting
      const ease = t => 1 - Math.pow(1 - t, 3), easeIO = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2), cl = v => Math.min(1, Math.max(0, v));
      const back = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
      const setCamZ = z => { const dir = camera.position.clone().sub(controls.target).normalize(); camera.position.copy(controls.target).addScaledVector(dir, z); };
      // peel: vertices left of the tear front lift and curl toward the camera, so the strip tears off progressively
      const peel = front => { const a = strip.geometry.attributes.position, r = strip.userData.rest; let anyLeft = false;
        for (let i = 0; i < a.count; i++) { const x = r[i * 3], y = r[i * 3 + 1], z = r[i * 3 + 2], d = front - (x + PW / 2);
          if (d <= 0) { a.setXYZ(i, x, y, z); anyLeft = true; continue; }
          const ang = Math.min(d * 1.35, 2.1), lift = (y + SH / 2);
          a.setXYZ(i, x + d * .04, y + Math.sin(ang) * (.15 + d * .18) + lift * (Math.cos(ang) - 1) * .4, z + (1 - Math.cos(ang)) * (.25 + d * .3)); }
        a.needsUpdate = true; strip.geometry.computeVertexNormals(); return anyLeft; };
      const tick = () => {
        if (this._dead) return;
        if (this._cardDirty) { drawCard(cardCanvas, this._card, this._cardImg); cardTex.needsUpdate = true; this._cardDirty = false; }
        const t = clock.getElapsedTime(), dt = Math.min(.05, t - last); last = t; const S = Math.max(.2, tune.speed), e = (t - t0) * S;
        if (ph === 'idle') { tune = T(); pg.position.set(0, Math.sin(t * 1.3) * .12, 0); pg.rotation.y = Math.sin(t * .55) * .36 * (1 - Math.min(1, Math.abs(tilt.y) * 2)) + (this._yaw || 0) + tilt.y; pg.rotation.x = tilt.x; pg.rotation.z = Math.sin(t * .8) * .03; glow.intensity = this._progress * 14; }
        else if (ph === 'shake') {
          if (!this._charged) { this._charged = true; tune = T(); rar = rarityOf(); col = RCOL[rar]; this.dispatchEvent(new CustomEvent('charge', { bubbles: true, detail: { seconds: tune.charge / Math.max(.2, tune.speed), rarity: rar, death: /DEATH/i.test(this._sub || '') } })); }
          // charge: the shake builds, the camera leans in, the seam starts to glow
          const k = cl(e / tune.charge), kk = k * k, amp = tune.shake * (.03 + kk * .16);
          pg.position.x = (Math.random() - .5) * amp; pg.position.y = (Math.random() - .5) * amp * .8; pg.rotation.z = (Math.random() - .5) * amp * 1.1; pg.rotation.y *= .9;
          glow.color.set(col); glow.intensity = 8 + kk * 16; seam.visible = true; seam.material.color.set(col); seam.material.opacity = kk * .9; seam.scale.set(PW * (.2 + kk * .5), .25 + kk * .3, 1); seam.position.x = -PW * .35;
          setCamZ(d0 * (1 - .12 * tune.camera * ease(k)));
          // pressure: the pack swells with each heartbeat as the P glows hotter
          const beat = stepLogo(t, Math.min(1, k * 1.15) * tune.glow, col); pg.scale.set(1 + .02 * kk * beat, 1 + .01 * kk * beat, 1 + .14 * kk * beat);
          setSun(0, .5, -1.4, 2.2 + kk * .6, kk * (.5 + .3 * beat) * tune.glow, col); // light behind the pack: shafts break around its edges
          if (k >= 1 && this._autoOpen) { this._autoOpen = false; ph = 'tear'; t0 = t; this.dispatchEvent(new CustomEvent('tear', { bubbles: true })); }
        }
        else if (ph === 'tear') {
          // rip: the tear front runs left to right; sparks fly off the front, the seam lights up behind it
          const k = cl(e / tune.tear), q = easeIO(k), front = q * PW * 1.25;
          pg.position.set((Math.random() - .5) * .03, (Math.random() - .5) * .03, 0); pg.rotation.set(0, 0, (Math.random() - .5) * .02);
          peel(front);
          const fx = -PW / 2 + Math.min(front, PW), wx = pg.localToWorld(new THREE.Vector3(fx, tearY, PD / 2)) ;
          for (let i = 0; i < Math.round(9 * tune.sparks); i++) emit(wx.x, wx.y, wx.z + .05, (Math.random() - .2) * 2.4, Math.random() * 2.8 + .6, Math.random() * 1.6 + .2, Math.random() < .55 ? '#FFE9A8' : Math.random() < .5 ? '#ffffff' : col, .4 + Math.random() * .6);
          stepLogo(t, (1 - q) * tune.glow, col); pg.scale.set(1, 1, 1);
          setSun(-PW / 2 + Math.min(front, PW) * .5, .5 + tearY + .05, -.05, .55 + q * .5, .55 + q * .35, col); // the light escapes along the tear
          seam.material.opacity = 1; seam.scale.set(Math.max(.3, Math.min(front, PW) * 1.15), .5 + q * .4, 1); seam.position.x = -PW / 2 + Math.min(front, PW) / 2;
          glow.intensity = 60 + q * 40; setCamZ(d0 * (1 - .12 * tune.camera));
          if (k >= 1) { ph = 'rise'; t0 = t; this.dispatchEvent(new CustomEvent('cue', { bubbles: true, detail: { hitIn: (tune.rise + tune.hold + tune.flip * .45) / Math.max(.2, tune.speed), rarity: rar } })); stepLogo(t, 0); cardGroup.visible = true; card.rotation.set(0, Math.PI, 0); cardGroup.rotation.set(0, 0, 0); cardGroup.scale.setScalar(.93); cardGroup.position.set(0, .5 - .2, 0);
            this._stripV = [1.6 + Math.random(), 3.2, 1.4]; burst(Math.round(40 * tune.sparks), '#FFE9A8', 2.4, .5 + tearY); }
        }
        else if (ph === 'rise') {
          // the strip flies off; the card slides up out of the opened pack, light pours out, the pack drops away
          const k = cl(e / tune.rise), q = ease(k), v = this._stripV;
          strip.position.x += v[0] * dt * S; strip.position.y += v[1] * dt * S; strip.position.z += v[2] * dt * S; v[1] -= 6 * dt * S; strip.rotation.z -= 4 * dt * S; strip.rotation.x -= 2 * dt * S; fadeAll(strip, 1 - cl(e / .6));
          beam.visible = true; beam.material.color.set(col); beam.material.opacity = Math.sin(Math.min(1, k * 1.4) * Math.PI) * .9; beam.scale.y = .4 + q;
          seam.material.opacity = 1 - q;
          const drop = cl((e - tune.rise * .6) / (tune.rise * .4)), dq = ease(drop);
          // inside the pack (behind its face) while it slides up; it only comes forward once the pack falls away
          cardGroup.position.y = .3 + q * .85; cardGroup.position.z = dq * .6; cardGroup.scale.setScalar(.93 + dq * .07);
          body.position.y = body.userData.cy - dq * 3.4; body.rotation.x = dq * .5; fadeAll(body, 1 - dq);
          const mouth = .5 + body.position.y + BH / 2;
          ssPlace(plume, tmpV.set(0, mouth + 2.4, 0), 3.4, 5.2, .002); setSun(0, mouth + .05, -.05, 1.1, .95 * (1 - dq * .35), col); // pouring out of the opening smokeSet(plume, Math.min(1, k * 2.2) * (1 - dq * .5) * 1.4 * tune.smoke, col, ACCENT[rar], t);
          glow.intensity = 70; setCamZ(d0 * (1 - .12 * tune.camera + .05 * q));
          if (k >= 1) { ph = 'hold'; t0 = t; rig.visible = false; }
        }
        else if (ph === 'hold') {
          // tension: the card, still face down, settles to the center; its rarity light leaks around the edges
          const k = cl(e / tune.hold), q = easeIO(k);
          cardGroup.position.y = 1.15 - q * .65; cardGroup.position.z = .6 + q * .2; cardGroup.rotation.z = Math.sin(t * 22) * .012 * (1 + k);
          halo.visible = true; halo.material.color.set(col); halo.material.opacity = q * .55 * Math.min(1.4, big(rar)); halo.scale.setScalar(.8 + q * .25 + Math.sin(t * 9) * .03);
          beam.material.opacity *= .9; glow.color.set(col); glow.intensity = 40 + q * 30;
          smokeSet(plume, (1 - q) * .6 * tune.smoke, null, null, t); setSun(0, cardGroup.position.y, -.8, 2.5, .6, col);
          if (k >= 1) { ph = 'flip'; t0 = t; this._flipped = false; }
        }
        else if (ph === 'flip') {
          // reveal: the card flips to its face with a flash, a shockwave and a burst the size of its rarity
          const k = cl(e / tune.flip), b = big(rar) * tune.burst;
          card.rotation.y = Math.PI * (1 - back(k)); cardGroup.position.y = .5; cardGroup.rotation.z = 0; cardGroup.scale.setScalar(1 + Math.sin(k * Math.PI) * .12);
          if (!this._flipped && k > .45) { this._flipped = true; revealAt = t; smokeSet(plume, 0, null, null, t); burst(Math.round(160 * b), col, 3.4 * Math.sqrt(b), .5); ring.visible = true; flash.visible = true; this.dispatchEvent(new CustomEvent('flip', { bubbles: true, detail: { rarity: rar } })); }
          setSun(0, .5, -.8, 2.6 + (this._flipped ? (1 - cl((k - .45) / .55)) * .8 : 0), this._flipped ? .45 + (1 - cl((k - .45) / .55)) * 1.1 : .6, col);
          if (this._flipped) { const f = cl((k - .45) / .55); if (bloom) bloom.strength = .55 + (1 - f) * 1.3 * tune.flash; ring.material.color.set(col); ring.material.opacity = (1 - f) * .9; ring.scale.setScalar(1 + f * 9 * Math.sqrt(b));
            flash.material.color.set(f < .25 ? '#ffffff' : col); flash.material.opacity = Math.min(1, Math.pow(1 - f, 1.6) * (.45 + .3 * b) * tune.flash) * (POST ? .45 : 1); camera.fov = 38 + (1 - f) * 4 * tune.camera; camera.updateProjectionMatrix(); }
          halo.material.opacity = .55 + .2 * Math.min(1.5, b); glow.intensity = 80 * (1 - k * .5);
          setCamZ(d0 * (1 - .07 * tune.camera * (1 - ease(k))));
          if (k >= 1) { ph = 'done'; ring.visible = false; flash.visible = false; camera.fov = 38; camera.updateProjectionMatrix(); this.dispatchEvent(new CustomEvent('revealed', { bubbles: true })); }
        }
        else if (ph === 'done') { setSun(0, cardGroup.position.y, -.8, 2.55, .3 + Math.sin(t * 1.6) * .05, col); cardGroup.rotation.y = Math.sin(t * .7) * .42 * (1 - Math.min(1, Math.abs(tilt.y) * 2)) + tilt.y; cardGroup.rotation.x = tilt.x; card.rotation.y = 0; cardGroup.scale.setScalar(1); cardGroup.position.y = .5 + Math.sin(t * 1.2) * .07; halo.material.opacity = .35 + Math.sin(t * 2) * .08; glow.intensity = 22 + Math.sin(t * 2) * 4;
          if (Math.random() < .25 * big(rar)) emit((Math.random() - .5) * 2.6, .5 + (Math.random() - .5) * 3.2, .3, 0, .4, 0, Math.random() < .5 ? col : '#ffffff', 1.2); }
        stepParts(dt * S);
        if (revealAt >= 0) { const e2 = (t - revealAt) * S, b2 = Math.min(1.6, big(rar));
          clouds.forEach((m, i) => { const c = CLOUD[i]; ssPlace(m, tmpV.set(c[0], cardGroup.position.y + c[1], 0), c[2], c[3], c[4]); m.material.uniforms.uGrow.value = .25 + .85 * ease(Math.min(1, e2 / (1.1 + i * .3)));
            const a = (i === 2 ? .35 : .75) * Math.min(1, e2 * 4) * (.22 + .78 * Math.exp(-e2 * .55)) * b2 * tune.smoke; smokeSet(m, a, i === 1 ? ACCENT[rar] : col, i === 1 ? col : ACCENT[rar], t + i * 3); }); }
        { const on = this._atmosphere ? tune.fog : 0, lit = revealAt >= 0 ? 1.7 : ph === 'idle' ? 1 : 1.25;
          fogC.copy(stageA).lerp(stageB, .5 + .5 * Math.sin(t * .2)); smokeSet(backdrop, .5 * on * lit, revealAt >= 0 ? col : fogC, revealAt >= 0 ? ACCENT[rar] : stageB, t * .6); }
        [halo, ring, flash].forEach(m => m.quaternion.copy(camera.quaternion)); beam.visible = false; if (POST) halo.visible = false;
        stepTilt();
        // big stages: no fill light (its reflection read as a light bulb on the glossy card)
        if (this._visible && !document.hidden) { controls.update(); const gi = glow.intensity; if (POST) glow.intensity = 0; renderFrame([backdrop, plume, ...clouds, parts, seam, beam, halo, ring, flash]); glow.intensity = gi; } requestAnimationFrame(tick);
      };
      this._ro = new ResizeObserver(() => { camera.aspect = w0() / h0(); camera.updateProjectionMatrix(); renderer.setSize(w0(), h0()); if (composer) { composer.setSize(w0(), h0()); occRT.setSize(Math.round(w0() / 2), Math.round(h0() / 2)); } }); this._ro.observe(host);
      tick();
    }
  }
  customElements.define('ample-pack-3d-v9', AmplePack3D);
})();
