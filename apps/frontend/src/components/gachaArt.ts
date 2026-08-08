// gachaArt.ts — Loofta Gacha Pack + collectible-card artwork.
// Classic white/black/gold gacha booster layout, Loofta brand, pokéball medallion.
// Single source of truth: GachaPack.tsx, GachaPack3D.tsx and GachaCard.tsx all draw from here.
// Ported from the design handoff at /react/gachaArt.js.txt (superset of the earlier /gacha/
// handoff — adds the card-drawing functions), with two adaptations:
//  - RARITIES uses this app's real 4-tier scale (common/uncommon/rare/epic, matching
//    Collectorcrypt's own tiers and the RARITY_STYLE badges already used on the room page)
//    instead of the handoff's generic 3-tier common/rare/legendary.
//  - drawCardFront drops the Megapot-specific "entries" pip and "$1.1M daily prize pool" footer
//    copy (neither concept exists in Gacha — there's no entries, no nightly draw) in favor of a
//    plain rarity-only footer. The user asked to use this component for the opening experience
//    now and wire real NFT metadata into it later — this only touches copy, not structure.

export const AW = 760;
export const AH = 1120;
// trading-card artwork (2.5 : 3.5 ratio, the real card proportion)
export const CW = 800;
export const CH = 1120;

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic';
export const RARITIES: Record<Rarity, { label: string; ink: string; a: string; b: string }> = {
  common: { label: 'COMMON', ink: '#6B6B78', a: '#C9C4B6', b: '#F2EEE4' },
  uncommon: { label: 'UNCOMMON', ink: '#065F46', a: '#34D399', b: '#A7F3D0' },
  rare: { label: 'RARE', ink: '#4C1D95', a: '#A78BFA', b: '#DDD6FE' },
  epic: { label: 'EPIC', ink: '#7A3A00', a: '#E8B23A', b: '#FFE9A8' },
};

const RED = '#FF1301';
const ORG = '#FF6A00';
const YEL = '#EAB308';
const GOLD_L = '#FFE9A8';
const GOLD_M = '#E8B23A';
const GOLD_D = '#9A6B12';
const INK = '#0B0B0F';
const PAPER = '#FFFDF7';

export function loadSvg(url: string): Promise<HTMLImageElement | null> {
  return fetch(url)
    .then((r) => r.text())
    .then(
      (t) =>
        new Promise<HTMLImageElement | null>((res) => {
          const uri = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(t)));
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = () => res(null);
          i.src = uri;
        }),
    )
    .catch(() => null);
}

/** Load any raster/vector image URL (for real card art). Tries CORS-anonymous first (needed so
 *  the canvas stays "clean" for renderGachaPackPNG's toDataURL export), but real Collector Crypt
 *  card scans (nft-dev.collectorcrypt.com, redirecting through CloudFront) send no
 *  Access-Control-Allow-Origin header at all on ANY hop — confirmed via curl against the live
 *  redirect chain — so `crossOrigin: 'anonymous'` is guaranteed to fail for these specifically,
 *  every time. Skip straight to a plain load for them: these scans commonly run 1-4MB+
 *  (full-resolution PSA vault photos), so the guaranteed-doomed CORS attempt was silently
 *  doubling load time for every card. Falls back to a plain (non-CORS) load on failure regardless
 *  of host: drawImage() onto a canvas works fine with a tainted source, it only blocks LATER pixel
 *  readback (toDataURL/getImageData) on that canvas — which only the share-image export needs,
 *  not simply displaying the card. Logs if even the plain load fails, so a genuinely dead/expired
 *  URL shows up in the console instead of silently rendering the blank "ARTWORK" placeholder. */
export function loadImage(url?: string | null): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    if (!url) { res(null); return; }
    const knownNoCors = /collectorcrypt\.com/.test(url);
    const tryLoad = (withCors: boolean) => {
      const i = new Image();
      if (withCors) i.crossOrigin = 'anonymous';
      i.onload = () => res(i);
      i.onerror = () => {
        if (withCors) { tryLoad(false); return; }
        console.error(`[gachaArt] loadImage failed (network error or dead URL, CORS already ruled out): ${url}`);
        res(null);
      };
      i.src = url;
    };
    tryLoad(!knownNoCors);
  });
}

function goldGrad(x: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  const g = x.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, GOLD_D);
  g.addColorStop(0.22, GOLD_M);
  g.addColorStop(0.5, GOLD_L);
  g.addColorStop(0.78, GOLD_M);
  g.addColorStop(1, GOLD_D);
  return g;
}
function brandGrad(x: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  const g = x.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, RED);
  g.addColorStop(0.55, ORG);
  g.addColorStop(1, YEL);
  return g;
}
function star(x: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  x.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 ? r * 0.44 : r;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = cx + Math.cos(a) * rad;
    const py = cy + Math.sin(a) * rad;
    i ? x.lineTo(px, py) : x.moveTo(px, py);
  }
  x.closePath();
}
function crimp(x: CanvasRenderingContext2D, y: number, h: number, dir: number) {
  x.save();
  x.fillStyle = INK;
  x.globalAlpha = 0.9;
  x.fillRect(0, y, AW, h);
  x.globalAlpha = 0.16;
  x.fillStyle = '#fff';
  for (let i = 0; i < AW; i += 9) x.fillRect(i, y, 3, h);
  x.globalAlpha = 0.9;
  x.fillStyle = INK;
  const teeth = 30;
  const tw = AW / teeth;
  const base = dir > 0 ? y + h : y;
  const tip = base + dir * 14;
  x.beginPath();
  x.moveTo(0, base);
  for (let i = 0; i < teeth; i++) {
    x.lineTo(i * tw + tw / 2, tip);
    x.lineTo((i + 1) * tw, base);
  }
  x.closePath();
  x.fill();
  x.restore();
}

/** Pokéball-style medallion: brand-gradient dome, cream base, black band, mystery button. */
function medallion(x: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  x.save();
  x.beginPath();
  x.arc(cx, cy, r, 0, 7);
  x.fillStyle = goldGrad(x, cx - r, cy - r, cx + r, cy + r);
  x.fill();
  x.lineWidth = 3;
  x.strokeStyle = GOLD_D;
  x.stroke();

  const ri = r - 26;
  x.save();
  x.beginPath();
  x.arc(cx, cy, ri, Math.PI, 0);
  x.closePath();
  x.clip();
  x.fillStyle = brandGrad(x, cx - ri, cy - ri, cx + ri, cy);
  x.fillRect(cx - ri, cy - ri, ri * 2, ri);
  x.globalAlpha = 0.28;
  x.fillStyle = '#fff';
  x.beginPath();
  x.ellipse(cx - ri * 0.3, cy - ri * 0.55, ri * 0.42, ri * 0.22, -0.5, 0, 7);
  x.fill();
  x.restore();
  x.save();
  x.beginPath();
  x.arc(cx, cy, ri, 0, Math.PI);
  x.closePath();
  x.clip();
  const lg = x.createLinearGradient(0, cy, 0, cy + ri);
  lg.addColorStop(0, '#FFFFFF');
  lg.addColorStop(1, '#E4DFD3');
  x.fillStyle = lg;
  x.fillRect(cx - ri, cy, ri * 2, ri);
  x.restore();
  x.save();
  x.beginPath();
  x.arc(cx, cy, ri, 0, 7);
  x.clip();
  x.fillStyle = INK;
  x.fillRect(cx - ri, cy - ri * 0.135, ri * 2, ri * 0.27);
  x.fillStyle = goldGrad(x, cx - ri, 0, cx + ri, 0);
  x.fillRect(cx - ri, cy - ri * 0.152, ri * 2, 4);
  x.fillRect(cx - ri, cy + ri * 0.135, ri * 2, 4);
  x.restore();
  const br = r * 0.3;
  x.beginPath();
  x.arc(cx, cy, br + 12, 0, 7);
  x.fillStyle = goldGrad(x, cx - br, cy - br, cx + br, cy + br);
  x.fill();
  x.beginPath();
  x.arc(cx, cy, br, 0, 7);
  x.fillStyle = PAPER;
  x.fill();
  x.lineWidth = 3;
  x.strokeStyle = GOLD_D;
  x.stroke();
  x.textAlign = 'center';
  x.fillStyle = brandGrad(x, cx - br, cy - br, cx + br, cy + br);
  x.font = `500 ${Math.round(br * 1.5)}px "Clash Display"`;
  x.fillText('?', cx, cy + br * 0.53);
  x.restore();
}

export interface GachaPackImages {
  logoWhite: HTMLImageElement | null;
}

/** Draw the pack onto a 2D context sized AW×AH. */
export function drawGachaPack(x: CanvasRenderingContext2D, face: 'front' | 'back' = 'front', imgs: Partial<GachaPackImages> = {}) {
  const { logoWhite } = imgs;
  x.clearRect(0, 0, AW, AH);

  const base = x.createLinearGradient(0, 0, AW, AH);
  base.addColorStop(0, '#FFFFFF');
  base.addColorStop(0.44, '#F4F1E9');
  base.addColorStop(0.7, '#FFFFFF');
  base.addColorStop(1, '#E9E5DA');
  x.fillStyle = base;
  x.fillRect(0, 0, AW, AH);
  x.save();
  x.translate(AW / 2, AH / 2);
  x.rotate(-0.62);
  x.globalAlpha = 0.5;
  const sh = x.createLinearGradient(-AW, 0, AW, 0);
  sh.addColorStop(0, 'rgba(255,255,255,0)');
  sh.addColorStop(0.5, 'rgba(255,255,255,.85)');
  sh.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = sh;
  x.fillRect(-AW, -170, AW * 2, 340);
  x.restore();

  x.fillStyle = INK;
  x.beginPath();
  x.moveTo(0, 0);
  x.lineTo(AW, 0);
  x.lineTo(AW, 132);
  x.bezierCurveTo(AW * 0.64, 322, AW * 0.3, 292, 0, 196);
  x.closePath();
  x.fill();
  x.beginPath();
  x.moveTo(0, AH);
  x.lineTo(AW, AH);
  x.lineTo(AW, AH - 248);
  x.bezierCurveTo(AW * 0.6, AH - 430, AW * 0.26, AH - 392, 0, AH - 286);
  x.closePath();
  x.fill();

  x.lineWidth = 6;
  x.strokeStyle = goldGrad(x, 0, 0, AW, 0);
  x.beginPath();
  x.moveTo(AW, 152);
  x.bezierCurveTo(AW * 0.64, 342, AW * 0.3, 312, 0, 216);
  x.stroke();
  x.beginPath();
  x.moveTo(AW, AH - 268);
  x.bezierCurveTo(AW * 0.6, AH - 450, AW * 0.26, AH - 412, 0, AH - 306);
  x.stroke();

  const cx = AW / 2;
  const cy = face === 'front' ? 556 : 470;
  const r = face === 'front' ? 186 : 120;
  x.lineWidth = 5;
  x.strokeStyle = goldGrad(x, cx - 330, 0, cx + 330, 0);
  x.beginPath();
  x.arc(cx, cy, r + 92, 2.55, 3.95);
  x.stroke();
  x.beginPath();
  x.arc(cx, cy, r + 92, -0.6, 0.8);
  x.stroke();
  x.globalAlpha = 0.5;
  x.beginPath();
  x.arc(cx, cy, r + 118, 2.7, 3.8);
  x.stroke();
  x.beginPath();
  x.arc(cx, cy, r + 118, -0.45, 0.65);
  x.stroke();
  x.globalAlpha = 1;

  x.textAlign = 'center';
  if (logoWhite) {
    const w = 300;
    const h = (w * logoWhite.height) / logoWhite.width;
    x.drawImage(logoWhite, (AW - w) / 2, 126, w, h);
  }

  medallion(x, cx, cy, r);

  if (face === 'front') {
    const sy = 826;
    const gap = 96;
    for (let i = 0; i < 5; i++) {
      const sx = AW / 2 + (i - 2) * gap;
      x.save();
      x.shadowColor = 'rgba(154,107,18,.45)';
      x.shadowBlur = 10;
      x.shadowOffsetY = 3;
      star(x, sx, sy, 34);
      x.fillStyle = goldGrad(x, sx - 34, sy - 34, sx + 34, sy + 34);
      x.fill();
      x.restore();
      x.lineWidth = 2;
      x.strokeStyle = GOLD_D;
      star(x, sx, sy, 34);
      x.stroke();
    }
    const ly = AH - 128;
    x.font = '500 62px "Clash Display"';
    const gw = x.measureText('GACHA').width;
    const pad = 22;
    const bw = gw + pad * 2;
    const bx = AW / 2 - bw - 16;
    x.beginPath();
    if (x.roundRect) x.roundRect(bx, ly - 52, bw, 74, 10);
    else x.rect(bx, ly - 52, bw, 74);
    x.fillStyle = goldGrad(x, bx, ly - 52, bx + bw, ly + 22);
    x.fill();
    x.fillStyle = INK;
    x.textAlign = 'center';
    x.fillText('GACHA', bx + bw / 2, ly);
    x.textAlign = 'left';
    x.fillStyle = '#fff';
    x.fillText('PACK', AW / 2 + 4, ly);
    x.fillStyle = goldGrad(x, 0, 0, 0, AH);
    x.fillRect(AW / 2 - 10, ly - 46, 3, 62);
  }

  crimp(x, 0, 46, 1);
  crimp(x, AH - 46, 46, -1);
  x.save();
  x.globalAlpha = 0.55;
  x.fillStyle = '#3A3A44';
  x.beginPath();
  x.ellipse(AW / 2, 74, 30, 13, 0, 0, 7);
  x.fill();
  x.restore();
}

/* ============================ COLLECTIBLE CARD ============================
   Trading-card face (800 × 1120). `art` is a real image drawn into the frame
   window — pass an <img> from loadImage(url). Everything else is brand chrome. */

function roundPath(x: CanvasRenderingContext2D, rx: number, ry: number, w: number, h: number, r: number) {
  x.beginPath();
  x.moveTo(rx + r, ry);
  x.arcTo(rx + w, ry, rx + w, ry + h, r);
  x.arcTo(rx + w, ry + h, rx, ry + h, r);
  x.arcTo(rx, ry + h, rx, ry, r);
  x.arcTo(rx, ry, rx + w, ry, r);
  x.closePath();
}

/** Draw an image cover-cropped into a rect (never squashed, but crops whatever overflows). */
function drawCover(x: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, rx: number, ry: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  x.drawImage(img, rx + (w - dw) / 2, ry + (h - dh) / 2, dw, dh);
}

/** Draw an image contain-fit into a rect (the WHOLE image always visible, never cropped) —
 *  letterboxed with `bg` on whichever axis doesn't match the frame's aspect ratio. PSA slab
 *  photos run a noticeably different ratio than the 2.5:3.5 trading-card frame, so cover-cropping
 *  them (drawCover) was cutting off real parts of the actual scan — the whole point of a real
 *  card reveal is showing the real thing, not a uniformly-shaped crop of it. */
function drawContain(x: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, rx: number, ry: number, w: number, h: number, bg: string) {
  x.fillStyle = bg;
  x.fillRect(rx, ry, w, h);
  const s = Math.min(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  x.drawImage(img, rx + (w - dw) / 2, ry + (h - dh) / 2, dw, dh);
}

/** Paint an image as the ENTIRE card face (for real card scans) — genuinely edge-to-edge, no
 *  colored rim showing (a real scan doesn't need Loofta's brand frame around it), and the full
 *  photo always visible rather than cropped to the trading-card aspect ratio. `matColor` (a light
 *  rarity/brand tint) fills whichever letterbox margin the photo's own aspect ratio leaves, so it
 *  reads as an intentional mat rather than a cropped-off gap. */
function drawFullFace(x: CanvasRenderingContext2D, img: HTMLImageElement, matColor: string) {
  roundPath(x, 0, 0, CW, CH, 44);
  x.save();
  x.clip();
  drawContain(x, img, 0, 0, CW, CH, matColor);
  x.restore();
}

export interface CardFrontOptions {
  name?: string;
  rarity?: Rarity;
  art?: HTMLImageElement | null;
  faceImage?: HTMLImageElement | null;
  logoDark?: HTMLImageElement | null;
}

/**
 * Card front. `art` is drawn into the framed Loofta card's art window; `faceImage` makes the
 * image the whole card face (a real, owned card scan) with the frame skipped entirely.
 */
export function drawCardFront(x: CanvasRenderingContext2D, opts: CardFrontOptions = {}) {
  const { name = 'Mystery', rarity = 'common', art = null, faceImage = null, logoDark = null } = opts;
  if (faceImage) {
    const Rf = RARITIES[rarity] || RARITIES.common;
    x.clearRect(0, 0, CW, CH);
    drawFullFace(x, faceImage, Rf.b);
    return;
  }
  const R = RARITIES[rarity] || RARITIES.common;
  x.clearRect(0, 0, CW, CH);

  const ob = x.createLinearGradient(0, 0, CW, CH);
  ob.addColorStop(0, R.a);
  ob.addColorStop(0.42, R.b);
  ob.addColorStop(0.72, R.a);
  ob.addColorStop(1, R.b);
  roundPath(x, 0, 0, CW, CH, 44);
  x.fillStyle = ob;
  x.fill();

  const m = 26;
  roundPath(x, m, m, CW - m * 2, CH - m * 2, 30);
  const body = x.createLinearGradient(0, m, 0, CH - m);
  body.addColorStop(0, '#FFFFFF');
  body.addColorStop(1, '#EFEBE0');
  x.fillStyle = body;
  x.fill();
  x.lineWidth = 3;
  x.strokeStyle = 'rgba(11,11,15,.14)';
  x.stroke();

  x.save();
  roundPath(x, m, m, CW - m * 2, CH - m * 2, 30);
  x.clip();
  x.fillStyle = INK;
  x.fillRect(m, m, CW - m * 2, 118);
  x.fillStyle = goldGrad(x, m, 0, CW - m, 0);
  x.fillRect(m, m + 118, CW - m * 2, 5);
  x.restore();

  x.textAlign = 'left';
  x.fillStyle = '#fff';
  x.font = '500 60px "Clash Display"';
  x.fillText(name, 62, 122);

  const ax = 62;
  const ay = 178;
  const aw = CW - 124;
  const ah = 596;
  x.save();
  roundPath(x, ax, ay, aw, ah, 18);
  x.clip();
  if (art) {
    drawCover(x, art, ax, ay, aw, ah);
  } else {
    const ph = x.createLinearGradient(ax, ay, ax + aw, ay + ah);
    ph.addColorStop(0, R.b);
    ph.addColorStop(1, R.a);
    x.fillStyle = ph;
    x.fillRect(ax, ay, aw, ah);
    x.fillStyle = 'rgba(11,11,15,.35)';
    x.textAlign = 'center';
    x.font = '600 26px "Clash Grotesk"';
    (x as any).letterSpacing = '8px';
    x.fillText('ARTWORK', ax + aw / 2, ay + ah / 2 + 9);
    (x as any).letterSpacing = '0px';
  }
  x.globalAlpha = 0.16;
  const hs = x.createLinearGradient(ax, ay, ax + aw, ay + ah);
  hs.addColorStop(0, 'rgba(255,255,255,0)');
  hs.addColorStop(0.45, '#fff');
  hs.addColorStop(0.55, 'rgba(255,255,255,0)');
  x.fillStyle = hs;
  x.fillRect(ax, ay, aw, ah);
  x.globalAlpha = 1;
  x.restore();
  x.lineWidth = 5;
  x.strokeStyle = goldGrad(x, ax, ay, ax + aw, ay + ah);
  roundPath(x, ax, ay, aw, ah, 18);
  x.stroke();

  // rarity plate
  x.save();
  const pw = 300;
  const px = (CW - pw) / 2;
  const py = 812;
  roundPath(x, px, py, pw, 64, 14);
  const rp = x.createLinearGradient(px, py, px + pw, py + 64);
  rp.addColorStop(0, R.a);
  rp.addColorStop(0.5, R.b);
  rp.addColorStop(1, R.a);
  x.fillStyle = rp;
  x.fill();
  x.lineWidth = 2.5;
  x.strokeStyle = 'rgba(11,11,15,.28)';
  x.stroke();
  x.fillStyle = R.ink;
  x.textAlign = 'center';
  x.font = '600 27px "Clash Grotesk"';
  (x as any).letterSpacing = '9px';
  x.fillText(R.label, CW / 2 + 4, py + 42);
  (x as any).letterSpacing = '0px';
  x.restore();

  // footer: pokéball + brand mark — no entries pip / jackpot copy, neither concept applies here
  medallion(x, 128, 962, 62);
  if (logoDark) {
    const w = 220;
    const h = (w * logoDark.height) / logoDark.width;
    x.drawImage(logoDark, CW / 2 - w / 2 + 24, 934, w, h);
  }
  x.textAlign = 'center';
  x.fillStyle = '#6B6B78';
  x.font = '500 21px "Clash Grotesk"';
  (x as any).letterSpacing = '4px';
  x.fillText('POOLED PACK · LOOFTA', CW / 2, 1046);
  (x as any).letterSpacing = '0px';
}

export interface CardBackOptions {
  logoWhite?: HTMLImageElement | null;
  backImage?: HTMLImageElement | null;
}

/** Card back. `backImage` uses a real card back full-bleed; otherwise brand pattern + pokéball. */
export function drawCardBack(x: CanvasRenderingContext2D, opts: CardBackOptions = {}) {
  const { logoWhite = null, backImage = null } = opts;
  x.clearRect(0, 0, CW, CH);
  if (backImage) {
    drawFullFace(x, backImage, GOLD_L);
    return;
  }

  const ob = x.createLinearGradient(0, 0, CW, CH);
  ob.addColorStop(0, GOLD_D);
  ob.addColorStop(0.4, GOLD_M);
  ob.addColorStop(0.7, GOLD_L);
  ob.addColorStop(1, GOLD_M);
  roundPath(x, 0, 0, CW, CH, 44);
  x.fillStyle = ob;
  x.fill();

  const m = 26;
  x.save();
  roundPath(x, m, m, CW - m * 2, CH - m * 2, 30);
  x.clip();
  const body = x.createLinearGradient(0, m, CW, CH);
  body.addColorStop(0, '#141018');
  body.addColorStop(0.5, '#241826');
  body.addColorStop(1, '#120E14');
  x.fillStyle = body;
  x.fillRect(0, 0, CW, CH);

  x.save();
  x.translate(CW / 2, CH / 2);
  x.rotate(-Math.PI / 4);
  x.globalAlpha = 0.07;
  x.fillStyle = '#fff';
  for (let i = -20; i < 20; i++) x.fillRect(i * 58, -CH, 16, CH * 2);
  x.restore();

  x.lineWidth = 5;
  x.strokeStyle = goldGrad(x, 0, 0, CW, 0);
  x.globalAlpha = 0.55;
  const corners: Array<[number, number, number]> = [
    [m + 90, m + 90, Math.PI],
    [CW - m - 90, m + 90, -Math.PI / 2],
    [m + 90, CH - m - 90, Math.PI / 2],
    [CW - m - 90, CH - m - 90, 0],
  ];
  for (const [cx2, cy2, a0] of corners) {
    x.beginPath();
    x.arc(cx2, cy2, 74, a0, a0 + Math.PI / 2);
    x.stroke();
  }
  x.globalAlpha = 1;
  x.restore();

  medallion(x, CW / 2, CH / 2 - 46, 196);

  if (logoWhite) {
    const w = 250;
    const h = (w * logoWhite.height) / logoWhite.width;
    x.drawImage(logoWhite, (CW - w) / 2, CH - 300, w, h);
  }
  x.textAlign = 'center';
  x.fillStyle = GOLD_L;
  x.font = '600 25px "Clash Grotesk"';
  (x as any).letterSpacing = '11px';
  x.fillText('GACHA', CW / 2 + 5, CH - 176);
  (x as any).letterSpacing = '0px';
}
