'use client';
// GachaPack3D.tsx — the 3D "rip" spectacle for Gacha Pooled Packs: idle float, shake, then the
// pack bursts open with a confetti/gold particle burst. No click, no in-3D card reveal — see the
// header comment further down for why both were removed. The actual revealed card is shown by
// the separate, DOM-based <GachaCard> component once this fires onOpened; this component's job
// ends at "the pack is now open."
//
// Ported from the design handoff at `/gacha/Gacha Pack 3D (standalone).html` (a plain-Three.js
// prototype reusing Mystery Pack's own pouch/foil pack rig, reskinned with the Gacha pack art —
// see gachaArt.ts) and re-architected to match this codebase's real production pattern for this
// exact kind of component: apps/frontend/src/components/megapot/MegapotPack.tsx. Same shape —
// refs for every prop (the mount effect below runs once; a stale closure over changing props
// would silently freeze them), a phase state machine driven by requestAnimationFrame.
//
// Two real differences from both the handoff and MegapotPack:
//  1. No click-to-open. A Gacha room opens for every participant at once, once everyone marks
//     themselves ready (see the room page's `mark_ready`/`room:all_ready` websocket flow) — there
//     is no single "the person who taps this pack" the way Mystery Pack's own real-money click
//     works. This component is driven entirely by the `autoOpen` prop instead: it flips true and
//     the shake/burst sequence starts on its own, in sync for everyone watching.
//  2. No in-3D card mesh/texture. Rendering a nicely swipeable, readable trading card inside a
//     WebGL scene (readable text, real cover-cropped artwork, drag-to-flip) duplicates real work
//     the DOM-based GachaCard component already does well with actual CSS 3D transforms — so the
//     3D scene's job stops at "the pack burst open," and the parent page swaps in <GachaCard> for
//     the actual reveal display right after onOpened fires.
//
// Trimmed relative to MegapotPack on purpose, to land this as a working first pass:
//  - No adaptive frame-time quality monitor (always renders at full quality/clearcoat).
//  - No sound effects (no Gacha-specific sound assets exist yet — see packSoundEffects.ts,
//    which is Megapot-branded).
//
//   <GachaPack3D autoOpen={allReady} resolveOpen={() => waitForRoomReveal(roomId)} onOpened={(r) => showCard(r)} />
//
// Client-only (touches window/WebGL) — import via next/dynamic with ssr:false.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { drawGachaPack, loadSvg, AW, AH } from './gachaArt';

const GOLD_L = '#FFE9A8', GOLD_M = '#E8B23A';

export type GachaRarity = 'common' | 'uncommon' | 'rare' | 'epic';
export interface GachaNftAttribute {
  trait_type: string;
  value: string;
}
export interface GachaOpenResult {
  nftMetadata: {
    name?: string;
    /** Front (recto) real card scan. */
    image?: string;
    /** Back (verso) real card scan. */
    backImage?: string;
    insuredValueUsdc?: number;
    attributes?: GachaNftAttribute[];
  } | null;
  rarity: GachaRarity;
}

export default function GachaPack3D({
  autoOpen,
  resolveOpen,
  onOpened,
  onError,
  className,
  displayFont = 'Clash Display',
  bodyFont = 'Clash Grotesk',
  idleLabel = '',
  idleSubtitle = 'Pool up, then rip the pack together',
  openingLabel = 'Opening…',
  hintTop = 22,
  assets = {},
}: {
  /** Flips true once everyone watching is ready — starts the shake/burst sequence. Never reset
   *  to false by this component; the parent unmounts/replaces it once onOpened fires. */
  autoOpen: boolean;
  resolveOpen: () => Promise<GachaOpenResult>;
  onOpened?: (result: GachaOpenResult) => void;
  onError?: (err: unknown) => void;
  className?: string;
  displayFont?: string;
  bodyFont?: string;
  idleLabel?: string;
  idleSubtitle?: string;
  openingLabel?: string;
  hintTop?: string | number;
  assets?: { logoWhite?: string };
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const uiRef = useRef<{ lbl: HTMLDivElement | null; sub: HTMLDivElement | null }>({ lbl: null, sub: null });
  const resolveOpenRef = useRef(resolveOpen);
  const onOpenedRef = useRef(onOpened);
  const onErrorRef = useRef(onError);
  const autoOpenRef = useRef(autoOpen);
  useEffect(() => { resolveOpenRef.current = resolveOpen; }, [resolveOpen]);
  useEffect(() => { onOpenedRef.current = onOpened; }, [onOpened]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { autoOpenRef.current = autoOpen; }, [autoOpen]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    /* ---------- renderer / scene ---------- */
    let W = host.clientWidth || window.innerWidth, H = host.clientHeight || window.innerHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 100);
    camera.position.set(0, 0.4, 10.6);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.enablePan = false;
    controls.minDistance = 6.5; controls.maxDistance = 16; controls.target.set(0, 0.5, 0);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.add(new THREE.HemisphereLight(0xfff6e6, 0x141014, 0.6));
    const key = new THREE.DirectionalLight(0xfffaf0, 2.6); key.position.set(1.6, 6.2, 2.6);
    key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 5;
    key.shadow.camera.near = 1; key.shadow.camera.far = 16; key.shadow.bias = -0.0012;
    key.shadow.camera.left = -3.4; key.shadow.camera.right = 3.4;
    key.shadow.camera.top = 4; key.shadow.camera.bottom = -4;
    key.shadow.camera.updateProjectionMatrix(); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffcf7a, 1.7); rim.position.set(-4.2, 1.8, -3.2); scene.add(rim);
    const glowLight = new THREE.PointLight(0xffd98a, 0, 14); glowLight.position.set(0, 0.5, 1.4); scene.add(glowLight);

    const ground = new THREE.Mesh(new THREE.CircleGeometry(10, 64), new THREE.ShadowMaterial({ opacity: 0.26 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -1.42; ground.receiveShadow = true; scene.add(ground);

    /* ---------- textures ---------- */
    function cv(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
    function tex(c: HTMLCanvasElement) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }

    let logoWhiteImg: HTMLImageElement | null = null;
    let _full: Partial<Record<'front' | 'back', HTMLCanvasElement>> = {};
    function fullArt(face: 'front' | 'back') {
      if (!_full[face]) {
        const c = cv(AW, AH);
        drawGachaPack(c.getContext('2d')!, face, { logoWhite: logoWhiteImg });
        _full[face] = c;
      }
      return _full[face]!;
    }
    function slice(face: 'front' | 'back', part: 'top' | 'bot') {
      const c = cv(AW, AH / 2), x = c.getContext('2d')!;
      x.drawImage(fullArt(face), 0, part === 'top' ? 0 : AH / 2, AW, AH / 2, 0, 0, AW, AH / 2);
      return tex(c);
    }
    function edgeTex() {
      const c = cv(64, 560), x = c.getContext('2d')!;
      const g = x.createLinearGradient(0, 0, 64, 0);
      g.addColorStop(0, '#CFC9BA'); g.addColorStop(0.45, '#FFFFFF'); g.addColorStop(1, '#D9D3C4');
      x.fillStyle = g; x.fillRect(0, 0, 64, 560);
      return tex(c);
    }
    function tornTex() {
      const c = cv(760, 64), x = c.getContext('2d')!;
      x.fillStyle = '#B9B2A2'; x.fillRect(0, 0, 760, 64);
      x.fillStyle = '#FFFDF7'; x.beginPath(); x.moveTo(0, 64);
      for (let i = 0; i <= 38; i++) x.lineTo(i * 20, i % 2 ? 18 : 44);
      x.lineTo(760, 64); x.closePath(); x.fill();
      return tex(c);
    }
    function crinkle() {
      const S = 1024, c = cv(S, S), x = c.getContext('2d')!;
      x.fillStyle = '#808080'; x.fillRect(0, 0, S, S);
      for (let i = 0; i < 22; i++) {
        x.save(); x.translate(Math.random() * S, Math.random() * S); x.rotate((Math.random() - 0.5) * 1.1);
        const g = x.createLinearGradient(0, -26, 0, 26);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.42, 'rgba(255,255,255,.7)');
        g.addColorStop(0.52, 'rgba(0,0,0,.66)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.fillRect(-S, -26, S * 2, 52); x.restore();
      }
      for (let i = 0; i < 52; i++) {
        x.save(); x.translate(Math.random() * S, Math.random() * S); x.rotate(Math.random() * Math.PI);
        const len = 60 + Math.random() * 170;
        const g = x.createLinearGradient(0, -9, 0, 9);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.45, 'rgba(255,255,255,.5)');
        g.addColorStop(0.55, 'rgba(0,0,0,.46)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.fillRect(-len / 2, -9, len, 18); x.restore();
      }
      return tex(c);
    }

    /* ---------- pouch geometry (unchanged from the handoff — pillow-pouch foil shaping) ---------- */
    const PW = 2.32, PH = (PW * AH) / AW, PD = 0.4;
    function hash2(i: number, j: number) { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); }
    function vnoise(x: number, y: number) {
      const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
      const t = a + (b - a) * sx;
      return t + (c + (d - c) * sx - t) * sy;
    }
    function pouch(geo: THREE.BoxGeometry, part: 'top' | 'bot', amt = 0.006) {
      const p = geo.attributes.position, n = geo.attributes.normal;
      const hy = PH / 2, yOff = part === 'top' ? PH / 4 : -PH / 4;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const u = Math.min(1, Math.abs(x) / (PW / 2));
        const v = Math.min(1, Math.abs(y + yOff) / hy);
        const prof = Math.max(0.3, Math.pow((1 - Math.pow(u, 4)) * (1 - Math.pow(v, 6)), 0.45));
        const w = (vnoise(x * 3.7 + 11.3, y * 3.1 + 5.9) - 0.5) * 2
          + (vnoise(x * 8.3 - 3.1, y * 7.1 + 17.7) - 0.5) * 1.1
          + (vnoise(x * 19.7 + 2.3, y * 16.1 - 8.9) - 0.5) * 0.45;
        const d = w * amt, seal = 1 - 0.055 * Math.pow(v, 6);
        p.setXYZ(i, x * seal + n.getX(i) * d, y + n.getY(i) * d, z * prof + n.getZ(i) * d * 1.7);
      }
      p.needsUpdate = true; geo.computeVertexNormals(); return geo;
    }

    const crinkleT = crinkle(), edgeT = edgeTex(), tornT = tornTex();
    function foilMat(map: THREE.Texture) {
      return new THREE.MeshPhysicalMaterial({
        map, metalness: 0.18, roughness: 0.16,
        clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.25,
        bumpMap: crinkleT, bumpScale: 0.07, side: THREE.FrontSide,
      });
    }

    const packRig = new THREE.Group(); packRig.position.y = 0.5; scene.add(packRig);
    const packGroup = new THREE.Group(); packRig.add(packGroup);

    function makeHalf(part: 'top' | 'bot') {
      const hh = PH / 2;
      const geo = pouch(new THREE.BoxGeometry(PW, hh, PD, 40, 30, 3), part);
      const side = foilMat(edgeT);
      const cut = new THREE.MeshPhysicalMaterial({ map: tornT, metalness: 0.05, roughness: 0.7 });
      const mats = [side, side,
        part === 'top' ? side : cut, part === 'top' ? cut : side,
        foilMat(slice('front', part)), foilMat(slice('back', part))];
      const m = new THREE.Mesh(geo, mats);
      m.castShadow = true; m.receiveShadow = true;
      m.position.y = part === 'top' ? hh / 2 : -hh / 2;
      return m;
    }
    const topHalf = makeHalf('top'), botHalf = makeHalf('bot');
    packGroup.add(topHalf, botHalf);

    /* confetti */
    const P = 150, pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(P * 3), pCol = new Float32Array(P * 3);
    const pVel: THREE.Vector3[] = [];
    const palette = [new THREE.Color(GOLD_M), new THREE.Color(GOLD_L), new THREE.Color('#ffffff'), new THREE.Color('#FF6A00')];
    for (let i = 0; i < P; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.5) * 1.5, s = 0.06 + Math.random() * 0.13;
      pVel.push(new THREE.Vector3(Math.cos(a) * s, Math.abs(Math.sin(e)) * s * 1.5 + 0.05, Math.sin(a) * s));
      const c = palette[i % palette.length]; pCol[i * 3] = c.r; pCol[i * 3 + 1] = c.g; pCol[i * 3 + 2] = c.b;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
    const parts = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.1, vertexColors: true, transparent: true, depthWrite: false }));
    parts.visible = false; parts.position.y = 0.5; scene.add(parts);

    /* ---------- state ---------- */
    let phase: 'idle' | 'shake' | 'burst' | 'done' = 'idle';
    let t0 = 0, raf = 0;
    const clock = new THREE.Clock();
    // Same "keep shaking until it lands" pattern as MegapotPack — except here resolveOpen isn't
    // starting a purchase, it's waiting for the room's ALREADY-IN-FLIGHT purchase/open to finish
    // (see the room page's implementation), so a slower shake-through is just as correct.
    let pendingResult: GachaOpenResult | null = null;
    let pendingError: unknown = null;
    const ui = uiRef.current;

    function startOpen() {
      if (phase !== 'idle') return;
      phase = 'shake'; t0 = clock.getElapsedTime();
      pendingResult = null; pendingError = null;
      if (ui.lbl) ui.lbl.textContent = openingLabel;
      if (ui.sub) ui.sub.textContent = '';
      resolveOpenRef.current()
        .then((result) => { pendingResult = result; })
        .catch((err) => { pendingError = err ?? new Error('Failed to open pack'); });
    }

    /* ---------- loop ---------- */
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    function tick() {
      const t = clock.getElapsedTime(), e = t - t0;

      if (phase === 'idle') {
        packGroup.position.y = Math.sin(t * 1.3) * 0.13;
        packGroup.rotation.y = Math.sin(t * 0.55) * 0.34;
        packGroup.rotation.z = Math.sin(t * 0.8) * 0.035;
        if (autoOpenRef.current) startOpen();
      } else if (phase === 'shake') {
        const k = Math.min(e / 1.2, 1);
        packGroup.position.x = (Math.random() - 0.5) * 0.14 * k;
        packGroup.position.y = (Math.random() - 0.5) * 0.11 * k;
        packGroup.rotation.z = (Math.random() - 0.5) * 0.14 * k;
        packGroup.rotation.y *= 0.93;
        glowLight.intensity = k * 70;
        if (pendingError) {
          onErrorRef.current?.(pendingError);
          phase = 'done';
        } else if (e > 1.2 && pendingResult) {
          phase = 'burst'; t0 = t; parts.visible = true;
          const p = parts.geometry.attributes.position as THREE.BufferAttribute;
          for (let i = 0; i < P; i++) { p.array[i * 3] = 0; p.array[i * 3 + 1] = 0; p.array[i * 3 + 2] = 0; }
          p.needsUpdate = true;
        }
      } else if (phase === 'burst') {
        const k = Math.min(e / 0.85, 1), q = ease(k);
        topHalf.position.y = PH / 4 + q * 3.1; topHalf.rotation.x = -q * 1.5; topHalf.rotation.z = -q * 0.5;
        botHalf.position.y = -PH / 4 - q * 3.1; botHalf.rotation.x = q * 1.5; botHalf.rotation.z = q * 0.5;
        (topHalf.material as THREE.Material[]).forEach((mt) => { mt.transparent = true; mt.opacity = 1 - q; });
        (botHalf.material as THREE.Material[]).forEach((mt) => { mt.transparent = true; mt.opacity = 1 - q; });
        packGroup.position.set(0, 0, 0); packGroup.rotation.set(0, 0, 0);
        const p = parts.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < P; i++) {
          p.array[i * 3] += pVel[i].x * 0.55;
          p.array[i * 3 + 1] += pVel[i].y * 0.55 - e * 0.012;
          p.array[i * 3 + 2] += pVel[i].z * 0.55;
        }
        p.needsUpdate = true;
        (parts.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - e / 1.5);
        glowLight.intensity = 70 * (1 - k * 0.55);
        if (e > 1.5 && pendingResult) {
          phase = 'done';
          packRig.visible = false; parts.visible = false;
          onOpenedRef.current?.(pendingResult);
        }
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
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(host);
    onResize();

    (async () => {
      try { await (document as any).fonts?.ready; } catch { /* fonts optional */ }
      logoWhiteImg = await loadSvg(assets.logoWhite ?? '/loofta_white.svg');
      _full = {};
      topHalf.material[4].map = slice('front', 'top'); topHalf.material[5].map = slice('back', 'top');
      botHalf.material[4].map = slice('front', 'bot'); botHalf.material[5].map = slice('back', 'bot');
      (topHalf.material as THREE.Material[]).forEach((m) => (m.needsUpdate = true));
      (botHalf.material as THREE.Material[]).forEach((m) => (m.needsUpdate = true));
    })();

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      controls.dispose();
      pmrem.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', background: '#111114', overflow: 'hidden' }}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', top: hintTop, left: 0, right: 0, textAlign: 'center', fontSize: 14, color: '#6f6c66', letterSpacing: '.14em', textTransform: 'uppercase', pointerEvents: 'none', zIndex: 2 }}>
        drag to orbit
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 8, textAlign: 'center', pointerEvents: 'none', zIndex: 2 }}>
        <div ref={(el) => { uiRef.current.lbl = el; }}
          style={{ fontFamily: `'${displayFont}', sans-serif`, fontWeight: 500, fontSize: 'clamp(24px,3.6vw,36px)', letterSpacing: '-.02em', color: '#fff', textShadow: '0 4px 30px rgba(0,0,0,.6)' }}>
          {idleLabel}
        </div>
        <div ref={(el) => { uiRef.current.sub = el; }}
          style={{ fontFamily: `'${bodyFont}', sans-serif`, fontSize: 16, color: '#c9c5be', marginTop: 6, textShadow: '0 2px 14px rgba(8,6,10,.95)' }}>
          {idleSubtitle}
        </div>
      </div>
    </div>
  );
}
