'use client';
// MegapotPack.tsx — 3D gacha pack opening for Next.js.
// Adapted from the designer handoff (handoff 2/nextjs/MegapotPack.tsx.txt) for the real Mystery
// Pack feature: the handoff's local `ODDS`/`roll()` determined the prize entirely client-side —
// here the click instead calls `resolveOpen`, which the page wires to a real, authenticated
// POST /lottery/packs/open. The visual/animation code (pack geometry, canvas artwork, confetti,
// state machine) is otherwise unchanged from the handoff.
//
//   npm i three
//
//   <MegapotPack
//     resolveOpen={() => openPack(accessToken)}
//     onOpened={(r) => showResult(r)}
//     assets={{ logo: '/loofta.svg', logoWhite: '/loofta_white.svg', megapotDark: '/images/megapot/logo.svg' }}
//   />
//
// Client-only (touches window/WebGL) — import via next/dynamic with ssr:false.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const RED = '#FF1301', ORG = '#FF6A00', YEL = '#EAB308', PAPER = '#FFFDF7', INK = '#0B0B0F';

export type PackRarity = 'common' | 'uncommon' | 'rare' | 'epic';
export interface PackOpenResult { ticketsAwarded: number; rarity: PackRarity }

// Confetti recolors only once a pack is actually opened and the rarity is known — the sealed
// pack itself always looks like the same brand mystery foil, so nothing spoils the reveal.
const RARITY_HUES: Record<PackRarity, number[]> = {
  common: [220, 0, 45],
  uncommon: [160, 190, 45],
  rare: [270, 220, 45],
  epic: [45, 15, 330],
};

export type PackAssets = { logo?: string; logoWhite?: string; megapotDark?: string };

export default function MegapotPack({
  assets = {},
  resolveOpen,
  onOpened,
  onError,
  className,
  displayFont = 'Clash Display',
  bodyFont = 'Clash Grotesk',
  jackpotLabel = '$1.1M',
  idleLabel = 'Click the pack to open',
  idleSubtitle = 'You always win at least 1 ticket — never a loss',
  openingLabel = 'Opening…',
  hintTop = 22,
  canOpen = true,
}: {
  assets?: PackAssets;
  /** Called when the sealed pack is clicked — must resolve with the real, server-rolled prize. */
  resolveOpen: () => Promise<PackOpenResult>;
  onOpened?: (result: PackOpenResult) => void;
  onError?: (err: unknown) => void;
  className?: string;
  displayFont?: string;
  bodyFont?: string;
  jackpotLabel?: string;
  idleLabel?: string;
  idleSubtitle?: string;
  openingLabel?: string;
  /** Top offset for the "drag to orbit · click the pack to open" hint — override when the host
   *  page has its own header chrome overlaid on the canvas, so the hint sits below it instead
   *  of colliding with it. Accepts any CSS `top` value (px number or a string like a calc()). */
  hintTop?: string | number;
  /** Gates the click-to-open interaction — e.g. while a required payment hasn't been confirmed
   *  yet. Dragging/orbiting the pack always still works; only the open action is blocked. */
  canOpen?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const uiRef = useRef<{ lbl: HTMLDivElement | null; sub: HTMLDivElement | null; btn: HTMLButtonElement | null }>({ lbl: null, sub: null, btn: null });
  const resolveOpenRef = useRef(resolveOpen);
  const onOpenedRef = useRef(onOpened);
  const onErrorRef = useRef(onError);
  const canOpenRef = useRef(canOpen);
  useEffect(() => { resolveOpenRef.current = resolveOpen; }, [resolveOpen]);
  useEffect(() => { onOpenedRef.current = onOpened; }, [onOpened]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { canOpenRef.current = canOpen; }, [canOpen]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const A = {
      logo: assets.logo ?? '/brand/loofta.svg',
      logoWhite: assets.logoWhite ?? '/brand/loofta_white.svg',
      megapotDark: assets.megapotDark ?? '/brand/megapot-black.svg',
    };

    let W = host.clientWidth || window.innerWidth;
    let H = host.clientHeight || window.innerHeight;

    /* ---------- renderer / scene ---------- */
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 100);
    // Pulled back further than the original handoff (11.6) — at 11.6 the pack halves' peak
    // fly-apart position sits right at the edge of (and on some aspect ratios just past) the
    // vertical frustum, which read as the ticket/pack "getting stuck" off-screen. The extra
    // distance gives real margin regardless of container size.
    camera.position.set(0, 0.5, 13.2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 8;
    controls.maxDistance = 20;
    controls.target.set(0, 0.55, 0);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.add(new THREE.HemisphereLight(0xffe9d6, 0x120a06, 0.55));

    const key = new THREE.DirectionalLight(0xfff2e0, 3.1);
    key.position.set(3.4, 5, 4.6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1; key.shadow.camera.far = 22; key.shadow.bias = -0.0005;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff5a1e, 2.2); rim.position.set(-4.4, 1.6, -3.4); scene.add(rim);
    const fill = new THREE.PointLight(0xEAB308, 26, 14); fill.position.set(0, -1.6, 3); scene.add(fill);
    const glowLight = new THREE.PointLight(0xffa03c, 0, 12); glowLight.position.set(0, 0.55, 1.2); scene.add(glowLight);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(9, 64), new THREE.ShadowMaterial({ opacity: 0.42 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -2.55; ground.receiveShadow = true; scene.add(ground);

    /* ---------- canvas helpers ---------- */
    const cv = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const grad = (x: CanvasRenderingContext2D, w: number, h: number) => {
      const g = x.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, RED); g.addColorStop(0.55, ORG); g.addColorStop(1, YEL); return g;
    };
    const tex = (c: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };

    let logoImg: HTMLImageElement | null = null, logoWhiteImg: HTMLImageElement | null = null, megapotDarkImg: HTMLImageElement | null = null;
    // never rejects — a failed load just means type-only artwork
    const loadImg = (url: string) => new Promise<HTMLImageElement | null>(r => {
      const i = new Image(); i.crossOrigin = 'anonymous';
      i.onload = () => r(i); i.onerror = () => r(null); i.src = url;
    });

    /* ---------- crease map ---------- */
    function crinkle() {
      const S = 1024, c = cv(S, S), x = c.getContext('2d')!;
      x.fillStyle = '#808080'; x.fillRect(0, 0, S, S);
      for (let i = 0; i < 26; i++) {
        x.save(); x.translate(Math.random() * S, Math.random() * S); x.rotate((Math.random() - 0.5) * 1.1);
        const g = x.createLinearGradient(0, -26, 0, 26);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.42, 'rgba(255,255,255,.72)');
        g.addColorStop(0.52, 'rgba(0,0,0,.7)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.fillRect(-S, -26, S * 2, 52); x.restore();
      }
      for (let i = 0; i < 70; i++) {
        x.save(); x.translate(Math.random() * S, Math.random() * S); x.rotate(Math.random() * Math.PI);
        const len = 60 + Math.random() * 180;
        const g = x.createLinearGradient(0, -9, 0, 9);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.45, 'rgba(255,255,255,.55)');
        g.addColorStop(0.55, 'rgba(0,0,0,.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.fillRect(-len / 2, -9, len, 18); x.restore();
      }
      const t = tex(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
    }
    const crinkleT = crinkle();

    /* ---------- gacha artwork (one 760x1120 sheet, sliced in half) ---------- */
    const AW = 760, AH = 1120;
    function sparkle(x: CanvasRenderingContext2D, cx: number, cy: number, r: number, a = 1) {
      x.save(); x.translate(cx, cy); x.globalAlpha = a; x.fillStyle = '#fff';
      x.beginPath(); x.moveTo(0, -r);
      x.quadraticCurveTo(r * 0.16, -r * 0.16, r, 0); x.quadraticCurveTo(r * 0.16, r * 0.16, 0, r);
      x.quadraticCurveTo(-r * 0.16, r * 0.16, -r, 0); x.quadraticCurveTo(-r * 0.16, -r * 0.16, 0, -r);
      x.fill(); x.restore();
    }
    function crimp(x: CanvasRenderingContext2D, y0: number, h: number, dir: number) {
      x.save();
      x.globalAlpha = 0.28; x.fillStyle = '#4A0C02'; x.fillRect(0, y0, AW, h); x.globalAlpha = 1;
      x.globalAlpha = 0.18; x.fillStyle = '#fff';
      for (let i = 0; i < AW; i += 9) x.fillRect(i, y0, 3, h);
      x.globalAlpha = 1;
      const teeth = 30, tw = AW / teeth, base = dir > 0 ? y0 + h : y0, tip = base + dir * 15;
      x.beginPath(); x.moveTo(0, base);
      for (let i = 0; i < teeth; i++) { x.lineTo(i * tw + tw / 2, tip); x.lineTo((i + 1) * tw, base); }
      x.closePath(); x.globalAlpha = 0.28; x.fillStyle = '#4A0C02'; x.fill(); x.globalAlpha = 1;
      x.restore();
    }
    function packArt() {
      const c = cv(AW, AH), x = c.getContext('2d')!;
      const g = x.createLinearGradient(0, 0, AW, AH);
      g.addColorStop(0, '#FF1301'); g.addColorStop(0.42, '#FF6A00');
      g.addColorStop(0.72, '#EAB308'); g.addColorStop(1, '#FF3D00');
      x.fillStyle = g; x.fillRect(0, 0, AW, AH);
      for (const [rot, alpha, off] of [[-0.72, 0.16, -200], [0.55, 0.12, 260], [-0.3, 0.1, 620]] as const) {
        x.save(); x.translate(AW / 2, AH / 2 + off * 0.2); x.rotate(rot);
        x.globalCompositeOperation = 'screen';
        const hg = x.createLinearGradient(-AW, 0, AW, 0);
        for (let i = 0; i <= 8; i++) hg.addColorStop(i / 8, `hsla(${i * 44},95%,62%,${alpha})`);
        x.fillStyle = hg; x.fillRect(-AW, -190, AW * 2, 380); x.restore();
      }
      x.globalCompositeOperation = 'source-over';
      const cx = AW / 2, cy = 800;
      x.save(); x.translate(cx, cy);
      for (let i = 0; i < 28; i++) {
        x.rotate(Math.PI * 2 / 28); if (i % 2) continue;
        x.globalAlpha = 0.14; x.fillStyle = '#fff';
        x.beginPath(); x.moveTo(0, 0);
        x.lineTo(Math.cos(-0.055) * 900, Math.sin(-0.055) * 900);
        x.lineTo(Math.cos(0.055) * 900, Math.sin(0.055) * 900);
        x.closePath(); x.fill();
      }
      x.restore();
      crimp(x, 0, 52, 1); crimp(x, AH - 52, 52, -1);
      x.save(); x.globalAlpha = 0.34; x.fillStyle = '#4A0C02';
      x.beginPath(); x.ellipse(cx, 90, 34, 17, 0, 0, 7); x.fill(); x.restore();

      x.textAlign = 'center';
      if (logoWhiteImg) {
        const w = 300, hh = w * logoWhiteImg.height / logoWhiteImg.width;
        x.save(); x.shadowColor = '#5A1002'; x.shadowBlur = 22;
        for (let i = 0; i < 3; i++) x.drawImage(logoWhiteImg, (AW - w) / 2, 150, w, hh);
        x.restore(); x.drawImage(logoWhiteImg, (AW - w) / 2, 150, w, hh);
      }
      x.font = `500 104px "${displayFont}"`; (x as any).letterSpacing = '-3px';
      x.lineWidth = 13; x.strokeStyle = '#5A1002'; x.lineJoin = 'round';
      x.strokeText('MYSTERY', AW / 2, 340); x.fillStyle = '#fff'; x.fillText('MYSTERY', AW / 2, 340);
      x.strokeText('PACK', AW / 2, 436); x.fillText('PACK', AW / 2, 436);
      sparkle(x, 120, 250, 26, 0.9); sparkle(x, 650, 206, 20, 0.8); sparkle(x, 90, 430, 15, 0.7);
      sparkle(x, 676, 404, 28, 0.85); sparkle(x, 150, 540, 12, 0.6);

      const rg = x.createRadialGradient(cx - 40, cy - 52, 10, cx, cy, 168);
      rg.addColorStop(0, '#FFF6D8'); rg.addColorStop(0.55, '#FFD349'); rg.addColorStop(1, '#E08A00');
      x.beginPath(); x.arc(cx, cy, 150, 0, 7); x.fillStyle = rg; x.fill();
      x.lineWidth = 12; x.strokeStyle = '#FFFDF7'; x.stroke();
      x.beginPath(); x.arc(cx, cy, 124, 0, 7); x.lineWidth = 4; x.strokeStyle = 'rgba(122,58,0,.45)'; x.stroke();
      x.fillStyle = '#B23A00'; x.font = `500 196px "${displayFont}"`; (x as any).letterSpacing = '0px';
      x.fillText('?', cx, cy + 70);
      sparkle(x, cx - 186, cy - 118, 32, 0.95); sparkle(x, cx + 196, cy + 96, 24, 0.9);
      sparkle(x, cx + 150, cy - 150, 17, 0.8); sparkle(x, cx - 160, cy + 150, 20, 0.75);
      if (megapotDarkImg) {
        const mw = 210, mh = mw * megapotDarkImg.height / megapotDarkImg.width;
        x.save(); x.globalAlpha = 0.92;
        const bw = 270, bh = mh + 34, bx = (AW - bw) / 2, by = 1000;
        x.beginPath();
        if ((x as any).roundRect) (x as any).roundRect(bx, by, bw, bh, 18); else x.rect(bx, by, bw, bh);
        x.fillStyle = '#FFFDF7'; x.fill();
        x.globalAlpha = 1; x.drawImage(megapotDarkImg, (AW - mw) / 2, by + 17, mw, mh);
        x.restore();
      }
      return c;
    }
    let _art: HTMLCanvasElement | null = null;
    function packFace(part: 'top' | 'bot') {
      if (!_art) _art = packArt();
      const c = cv(AW, AH / 2), x = c.getContext('2d')!;
      x.drawImage(_art, 0, part === 'top' ? 0 : AH / 2, AW, AH / 2, 0, 0, AW, AH / 2);
      return tex(c);
    }
    function packBackFace() {
      const c = cv(AW, AH / 2), x = c.getContext('2d')!;
      const g = x.createLinearGradient(0, 0, AW, AH / 2);
      g.addColorStop(0, '#FF1301'); g.addColorStop(0.5, '#FF6A00'); g.addColorStop(1, '#EAB308');
      x.fillStyle = g; x.fillRect(0, 0, AW, AH / 2);
      x.save(); x.translate(AW / 2, AH / 4); x.rotate(-0.6); x.globalCompositeOperation = 'screen';
      const hg = x.createLinearGradient(-AW, 0, AW, 0);
      for (let i = 0; i <= 8; i++) hg.addColorStop(i / 8, `hsla(${i * 44},95%,62%,.1)`);
      x.fillStyle = hg; x.fillRect(-AW, -150, AW * 2, 300); x.restore();
      x.globalAlpha = 0.28; x.fillStyle = '#4A0C02';
      x.fillRect(0, 0, AW, 26); x.fillRect(0, AH / 2 - 26, AW, 26);
      return tex(c);
    }
    function packEdge() {
      const c = cv(64, 560), x = c.getContext('2d')!;
      x.fillStyle = grad(x, 64, 560); x.fillRect(0, 0, 64, 560);
      x.globalAlpha = 0.22; x.fillStyle = '#000'; x.fillRect(0, 0, 10, 560); x.fillRect(54, 0, 10, 560);
      return tex(c);
    }
    function tornEdge() {
      const c = cv(760, 64), x = c.getContext('2d')!;
      x.fillStyle = '#C9410B'; x.fillRect(0, 0, 760, 64);
      x.fillStyle = '#F6E4C9'; x.beginPath(); x.moveTo(0, 64);
      for (let i = 0; i <= 38; i++) x.lineTo(i * 20, (i % 2 ? 18 : 44));
      x.lineTo(760, 64); x.closePath(); x.fill();
      return tex(c);
    }

    /* ---------- ticket textures ---------- */
    function ticketFront(entries: number) {
      const TW = 560, TH = 1160, c = cv(TW, TH), x = c.getContext('2d')!;
      x.fillStyle = PAPER; x.fillRect(0, 0, TW, TH);
      x.fillStyle = grad(x, TW, 60); x.fillRect(0, 0, TW, 20);
      if (logoImg) { const w = 250, hh = w * logoImg.height / logoImg.width; x.drawImage(logoImg, (TW - w) / 2, 140, w, hh); }
      x.textAlign = 'center';
      x.fillStyle = INK; x.font = `500 340px "${displayFont}"`; (x as any).letterSpacing = '-18px';
      x.fillText(String(entries).padStart(2, '0'), TW / 2, 585);
      const g = x.createLinearGradient(TW / 2 - 80, 0, TW / 2 + 80, 0);
      g.addColorStop(0, RED); g.addColorStop(1, YEL);
      x.fillStyle = g; x.fillRect(TW / 2 - 80, 645, 160, 11);
      x.fillStyle = '#6B6B78'; x.font = `600 27px "${bodyFont}"`; (x as any).letterSpacing = '10px';
      x.fillText(entries === 1 ? 'ENTRY' : 'ENTRIES', TW / 2, 740);
      x.strokeStyle = 'rgba(11,11,15,.22)'; x.lineWidth = 4; x.setLineDash([12, 15]);
      x.beginPath(); x.moveTo(28, 852); x.lineTo(TW - 28, 852); x.stroke(); x.setLineDash([]);
      x.fillStyle = grad(x, TW, TH); x.fillRect(0, 852, TW, TH - 852);
      x.fillStyle = '#fff'; x.font = `500 94px "${displayFont}"`; (x as any).letterSpacing = '-3px';
      x.fillText(jackpotLabel, TW / 2, 1035);
      return tex(c);
    }
    function ticketBack() {
      const TW = 560, TH = 1160, c = cv(TW, TH), x = c.getContext('2d')!;
      x.fillStyle = INK; x.fillRect(0, 0, TW, TH);
      x.fillStyle = grad(x, TW, 60); x.fillRect(0, 0, TW, 20);
      x.textAlign = 'center';
      if (logoWhiteImg) { const w = 300, hh = w * logoWhiteImg.height / logoWhiteImg.width; x.drawImage(logoWhiteImg, (TW - w) / 2, 360, w, hh); }
      const g = x.createLinearGradient(TW / 2 - 80, 0, TW / 2 + 80, 0);
      g.addColorStop(0, RED); g.addColorStop(1, YEL);
      x.fillStyle = g; x.fillRect(TW / 2 - 80, 500, 160, 11);
      x.fillStyle = '#7D7B76'; x.font = `600 27px "${bodyFont}"`; (x as any).letterSpacing = '10px';
      x.fillText('MEGAPOT', TW / 2, 596);
      x.strokeStyle = 'rgba(255,255,255,.3)'; x.lineWidth = 4; x.setLineDash([12, 15]);
      x.beginPath(); x.moveTo(28, 852); x.lineTo(TW - 28, 852); x.stroke(); x.setLineDash([]);
      x.fillStyle = PAPER; let px = 130;
      [5, 2, 7, 2, 4, 8, 2, 5, 3, 7, 2, 5, 8, 2, 6, 3, 7, 2, 5, 8, 2, 5, 3, 7].forEach(w => { x.fillRect(px, 950, w, 110); px += w + 7; });
      return tex(c);
    }

    /* ---------- geometry ---------- */
    const PW = 2.35, PH = 3.6, PD = 0.34;
    function hash2(i: number, j: number) { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); }
    function vnoise(x: number, y: number) {
      const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
      const top = a + (b - a) * sx, bot = c + (d - c) * sx;
      return top + (bot - top) * sy;
    }
    // displacement must be a pure function of position or the mesh tears
    function crumple(geo: THREE.BufferGeometry, amt = 0.011) {
      const p = geo.attributes.position, n = geo.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const w = (vnoise(x * 3.7 + 11.3, y * 3.1 + 5.9) - 0.5) * 2
          + (vnoise(x * 8.3 - 3.1, y * 7.1 + 17.7) - 0.5) * 1.1
          + (vnoise(x * 19.7 + 2.3, y * 16.1 - 8.9) - 0.5) * 0.45;
        const d = w * amt, edge = Math.sin(y * 9.1 + x * 5.3) * amt * 0.35;
        p.setXYZ(i, x + n.getX(i) * d + edge * Math.sign(x) * 0.5, y + n.getY(i) * d, z + n.getZ(i) * d * 1.7);
      }
      (p as THREE.BufferAttribute).needsUpdate = true; geo.computeVertexNormals(); return geo;
    }
    const foilMat = (map: THREE.Texture) => new THREE.MeshPhysicalMaterial({
      map, metalness: 0.42, roughness: 0.16,
      clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.5,
      bumpMap: crinkleT, bumpScale: 0.16, side: THREE.FrontSide,
    });
    const edgeT = packEdge(), tornT = tornEdge();

    const packRig = new THREE.Group(); packRig.position.y = 0.55; scene.add(packRig);
    const packGroup = new THREE.Group(); packRig.add(packGroup);

    function makeHalf(part: 'top' | 'bot') {
      const hh = PH / 2;
      // BoxGeometry keeps per-face 0..1 UVs so artwork maps upright
      const geo = crumple(new THREE.BoxGeometry(PW, hh, PD, 30, 22, 2));
      const cut = new THREE.MeshPhysicalMaterial({ map: tornT, metalness: 0.2, roughness: 0.6 });
      const side = foilMat(edgeT);
      const m = new THREE.Mesh(geo, [
        side, side,
        part === 'top' ? side : cut, part === 'top' ? cut : side,
        foilMat(packFace(part)), foilMat(packBackFace()),
      ]);
      m.castShadow = true; m.receiveShadow = true;
      m.position.y = part === 'top' ? hh / 2 : -hh / 2;
      return m;
    }
    const topHalf = makeHalf('top'), botHalf = makeHalf('bot');
    packGroup.add(topHalf, botHalf);

    const ticketGroup = new THREE.Group(); ticketGroup.visible = false; scene.add(ticketGroup);
    const frontMat = new THREE.MeshPhysicalMaterial({ map: ticketFront(1), roughness: 0.52, metalness: 0.05, clearcoat: 0.35 });
    const backMat = new THREE.MeshPhysicalMaterial({ map: ticketBack(), roughness: 0.52, metalness: 0.05, clearcoat: 0.35 });
    const paperEdge = new THREE.MeshStandardMaterial({ color: 0xEDE6D6, roughness: 0.85 });
    const ticket = new THREE.Mesh(new THREE.BoxGeometry(2.1, 4.35, 0.045, 2, 2, 1),
      [paperEdge, paperEdge, paperEdge, paperEdge, frontMat, backMat]);
    ticket.castShadow = true; ticketGroup.add(ticket);

    /* ---------- confetti ---------- */
    const P = 150;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(P * 3), pCol = new Float32Array(P * 3);
    const pVel: THREE.Vector3[] = [];
    for (let i = 0; i < P; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.5) * 1.5, s = 0.06 + Math.random() * 0.13;
      pVel.push(new THREE.Vector3(Math.cos(a) * s, Math.abs(Math.sin(e)) * s * 1.5 + 0.05, Math.sin(a) * s));
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
    const parts = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.11, vertexColors: true, transparent: true, depthWrite: false }));
    parts.visible = false; parts.position.y = 0.55; scene.add(parts);

    function paintConfetti(rarity: PackRarity) {
      const hues = RARITY_HUES[rarity];
      const c = new THREE.Color();
      for (let i = 0; i < P; i++) {
        c.setHSL(hues[i % hues.length] / 360, 0.75, i % 3 === 0 ? 0.92 : 0.58);
        pCol[i * 3] = c.r; pCol[i * 3 + 1] = c.g; pCol[i * 3 + 2] = c.b;
      }
      pGeo.attributes.color.needsUpdate = true;
    }
    paintConfetti('common');

    /* ---------- state ---------- */
    let phase: 'idle' | 'shake' | 'burst' | 'reveal' | 'done' = 'idle';
    let t0 = 0, entries = 1, raf = 0;
    const clock = new THREE.Clock();
    // Set by resolveOpen() once the real backend roll lands — the shake phase (1.2s) gives a
    // normal network round trip time to finish before the tear ever reveals the ticket, so the
    // number printed on it is always the true, already-known result. If it's still pending when
    // the shake timer would otherwise flip to burst, the shake just continues (reads as "still
    // opening"); on error we bail back to idle rather than reveal a fabricated number.
    let pendingResult: PackOpenResult | null = null;
    let pendingError: unknown = null;
    const ui = uiRef.current;

    const rayc = new THREE.Raycaster(), ptr = new THREE.Vector2();
    function onClick(ev: MouseEvent) {
      // Dragging/orbiting (OrbitControls) is untouched by this gate — only the open action
      // itself is blocked while a required payment hasn't been confirmed yet.
      if (phase !== 'idle' || !canOpenRef.current) return;
      const r = renderer.domElement.getBoundingClientRect();
      ptr.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
      ptr.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
      rayc.setFromCamera(ptr, camera);
      if (rayc.intersectObjects([topHalf, botHalf], true).length) {
        phase = 'shake'; t0 = clock.getElapsedTime();
        pendingResult = null; pendingError = null;
        if (ui.lbl) ui.lbl.textContent = openingLabel;
        if (ui.sub) ui.sub.textContent = 'Good luck';
        resolveOpenRef.current()
          .then(result => {
            pendingResult = result;
            paintConfetti(result.rarity);
            if (frontMat.map) frontMat.map.dispose();
            frontMat.map = ticketFront(result.ticketsAwarded); frontMat.needsUpdate = true;
          })
          .catch(err => { pendingError = err ?? new Error('Failed to open pack'); });
      }
    }
    renderer.domElement.addEventListener('click', onClick);

    function reset() {
      phase = 'idle';
      if (ui.btn) ui.btn.style.visibility = 'hidden';
      ticketGroup.visible = false; parts.visible = false;
      topHalf.position.set(0, PH / 4, 0); topHalf.rotation.set(0, 0, 0);
      botHalf.position.set(0, -PH / 4, 0); botHalf.rotation.set(0, 0, 0);
      [topHalf, botHalf].forEach(m => (m.material as THREE.Material[]).forEach(mt => { mt.opacity = 1; mt.transparent = false; }));
      packRig.visible = true; packGroup.visible = true; glowLight.intensity = 0;
      if (ui.lbl) ui.lbl.textContent = idleLabel;
      if (ui.sub) ui.sub.textContent = idleSubtitle;
    }
    ui.btn?.addEventListener('click', reset);

    /* ---------- loop ---------- */
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    function tick() {
      const t = clock.getElapsedTime(), e = t - t0;
      if (phase === 'idle') {
        packGroup.position.y = Math.sin(t * 1.3) * 0.13;
        packGroup.rotation.y = Math.sin(t * 0.55) * 0.34;
        packGroup.rotation.z = Math.sin(t * 0.8) * 0.035;
      } else if (phase === 'shake') {
        const k = Math.min(e / 1.2, 1);
        packGroup.position.x = (Math.random() - 0.5) * 0.14 * k;
        packGroup.position.y = (Math.random() - 0.5) * 0.11 * k;
        packGroup.rotation.z = (Math.random() - 0.5) * 0.14 * k;
        packGroup.rotation.y *= 0.93;
        glowLight.intensity = k * 70;
        if (pendingError) {
          onErrorRef.current?.(pendingError);
          reset();
        } else if (e > 1.2 && pendingResult) {
          entries = pendingResult.ticketsAwarded;
          phase = 'burst'; t0 = t; parts.visible = true;
          const p = parts.geometry.attributes.position as THREE.BufferAttribute;
          for (let i = 0; i < P; i++) { p.array[i * 3] = 0; p.array[i * 3 + 1] = 0; p.array[i * 3 + 2] = 0; }
          p.needsUpdate = true; ticketGroup.visible = true;
        }
      } else if (phase === 'burst' || phase === 'reveal') {
        const k = Math.min(e / 0.85, 1), q = ease(k);
        topHalf.position.y = PH / 4 + q * 3.1; topHalf.rotation.x = -q * 1.5; topHalf.rotation.z = -q * 0.5;
        botHalf.position.y = -PH / 4 - q * 3.1; botHalf.rotation.x = q * 1.5; botHalf.rotation.z = q * 0.5;
        [topHalf, botHalf].forEach(m => (m.material as THREE.Material[]).forEach(mt => { mt.transparent = true; mt.opacity = 1 - q; }));
        packGroup.position.set(0, 0, 0); packGroup.rotation.set(0, 0, 0);
        const p = parts.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < P; i++) {
          p.array[i * 3] += pVel[i].x * 0.55;
          p.array[i * 3 + 1] += pVel[i].y * 0.55 - e * 0.012;
          p.array[i * 3 + 2] += pVel[i].z * 0.55;
        }
        p.needsUpdate = true;
        (parts.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - e / 1.5);
        const rk = Math.min(Math.max((e - 0.15) / 1.15, 0), 1), rq = ease(rk);
        ticketGroup.position.y = -1.2 + rq * 1.75;
        ticketGroup.rotation.y = (1 - rq) * Math.PI * 2.4;
        ticketGroup.scale.setScalar(0.5 + rq * 0.36);
        glowLight.intensity = 70 * (1 - k * 0.55);
        if (k >= 1 && phase === 'burst') phase = 'reveal';
        if (e > 1.5 && phase === 'reveal' && pendingResult) {
          phase = 'done';
          packRig.visible = false; parts.visible = false;
          if (ui.lbl) ui.lbl.textContent = `${entries} free ${entries === 1 ? 'ticket' : 'tickets'}`;
          if (ui.sub) ui.sub.textContent = "Added to today's Megapot draw";
          if (ui.btn) ui.btn.style.visibility = 'visible';
          onOpenedRef.current?.(pendingResult);
        }
      } else {
        ticketGroup.rotation.y = Math.sin(t * 0.7) * 0.42;
        ticketGroup.position.y = 0.55 + Math.sin(t * 1.2) * 0.07;
        glowLight.intensity = 26 + Math.sin(t * 2) * 5;
      }
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    }
    tick(); // start immediately — never gate the loop on asset loads

    const onResize = () => {
      W = host.clientWidth || window.innerWidth; H = host.clientHeight || window.innerHeight;
      if (!W || !H) return;
      camera.aspect = W / H; camera.updateProjectionMatrix(); renderer.setSize(W, H);
    };
    // A plain window 'resize' listener misses container-driven size changes (e.g. mobile
    // address-bar collapse/expand, a full-screen host whose height comes from dvh/flex layout
    // rather than the window itself) — those never fire 'resize' but do change host.clientHeight,
    // which is what actually drives the canvas/camera here.
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(host);
    onResize();

    // brand assets load in the background, then artwork is rebuilt
    (async () => {
      try { await (document as any).fonts?.ready; } catch { }
      [logoImg, logoWhiteImg, megapotDarkImg] = await Promise.all([
        loadImg(A.logo), loadImg(A.logoWhite), loadImg(A.megapotDark),
      ]);
      _art = null;
      topHalf.material[4].map = packFace('top'); topHalf.material[5].map = packBackFace();
      botHalf.material[4].map = packFace('bot'); botHalf.material[5].map = packBackFace();
      (topHalf.material as THREE.Material[]).forEach(m => (m.needsUpdate = true));
      (botHalf.material as THREE.Material[]).forEach(m => (m.needsUpdate = true));
      frontMat.map = ticketFront(1); frontMat.needsUpdate = true;
      backMat.map = ticketBack(); backMat.needsUpdate = true;
    })();

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('click', onClick);
      ui.btn?.removeEventListener('click', reset);
      controls.dispose();
      pmrem.dispose();
      scene.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach(x => x.dispose()); else mat?.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', background: '#08060A', overflow: 'hidden' }}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', top: hintTop, left: 0, right: 0, textAlign: 'center', fontSize: 14, color: '#6f6c66', letterSpacing: '.14em', textTransform: 'uppercase', pointerEvents: 'none', zIndex: 2 }}>
        drag to orbit · click the pack to open
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 8, textAlign: 'center', pointerEvents: 'none', zIndex: 2 }}>
        <div ref={el => { uiRef.current.lbl = el; }}
          style={{ fontFamily: `'${displayFont}', sans-serif`, fontWeight: 500, fontSize: 'clamp(24px,3.6vw,36px)', letterSpacing: '-.02em', color: '#fff', textShadow: '0 4px 30px rgba(0,0,0,.6)' }}>
          {idleLabel}
        </div>
        <div ref={el => { uiRef.current.sub = el; }}
          style={{ fontFamily: `'${bodyFont}', sans-serif`, fontSize: 16, color: '#c9c5be', marginTop: 6, textShadow: '0 2px 14px rgba(8,6,10,.95)' }}>
          {idleSubtitle}
        </div>
        <button ref={el => { uiRef.current.btn = el; }}
          style={{ pointerEvents: 'auto', fontFamily: `'${displayFont}', sans-serif`, fontWeight: 500, fontSize: 17, padding: '15px 32px', border: 'none', borderRadius: 999, cursor: 'pointer', background: 'linear-gradient(90deg,#FF1301,#EAB308)', color: '#fff', marginTop: 10, visibility: 'hidden' }}>
          Open another
        </button>
      </div>
    </div>
  );
}
