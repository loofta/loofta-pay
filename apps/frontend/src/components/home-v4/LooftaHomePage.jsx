'use client';
import React from 'react';
import { SendWidget, useBalanceDeepLinkRedirect } from '@/app/home-v3/HomeV3Content';
import { jetbrainsMono, manrope, sora } from './fonts';
import './loofta-home.css';

const SORA = 'var(--font-home-sora), system-ui, sans-serif';
const MONO = 'var(--font-home-mono), ui-monospace, monospace';
const PAJ_CASH_ENABLED = process.env.NEXT_PUBLIC_PAJ_CASH_ENABLED === 'true';

/** Mobile / reduced-motion: skip WebGL, float rAF, and the 3D pay-in entrance. */
function prefersLiteMotion() {
  if (typeof window === 'undefined') return true;
  return (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    window.matchMedia('(max-width: 768px)').matches
  );
}

export default function LooftaHomePage() {
  useBalanceDeepLinkRedirect();
  return <HomePage />;
}

class HomePage extends React.Component {
  entr = ['@satoshi', '@mira.eth', '@kofi', '@ana_b', '@dev0x', '@lena', '@tunde', '@yuki', '@marco', '@zara', '@obi', '@ines'];

  constructor(props) {
    super(props);
    // SSR + first client paint both start lite so markup matches; desktop upgrades in didMount.
    this._lite = true;
    this.state = {
      typed: '', emailOn: false, caret: true, drawing: false, hi: -1, winner: -1,
      shield: true, now: null, tilesOut: true, menuOpen: false, lite: true,
      // Production app domain by default (matches SSR); swapped to the local app on localhost in didMount.
      appUrl: 'https://pay.loofta.com',
    };
  }

  // Desktop only: lazy-mount Three.js when the giveaways visual nears the viewport.
  heroRef = el => {
    if (el === this._heroEl) return;
    this.disposeScene();
    this._sceneIO?.disconnect();
    this._heroEl = el;
    this._armScene(el);
  };

  _armScene(el) {
    if (!el || this._lite || !this._mounted) return;
    this._sceneIO = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      this._sceneIO?.disconnect();
      this._sceneIO = null;
      this.initScene(el);
    }, { rootMargin: '160px' });
    this._sceneIO.observe(el);
  }
  tilt = e => {
    if (this._lite) return;
    const el = e.currentTarget, r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(1000px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg)`;
  };
  untilt = e => { if (!this._lite) e.currentTarget.style.transform = ''; };

  componentDidMount() {
    this._mounted = true;
    const lite = prefersLiteMotion();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._lite = lite;
    const host = window.location.hostname;
    const appUrl = host === 'localhost' || host === '127.0.0.1' ? `${window.location.origin}/app` : this.state.appUrl;
    this.setState({ now: Date.now(), lite, tilesOut: lite, appUrl });
    this.startTypewriter(reduce || lite);
    this._clockT = setInterval(() => this.setState({ now: Date.now() }), 1000);

    // Float loop + pointer parallax are desktop-only — continuous rAF is the main mobile cost.
    if (lite) return;

    this._tilesT = setTimeout(this.hideTiles, 3400);
    this._armScene(this._heroEl);

    this._onMove = e => { this._px = e.clientX; this._py = e.clientY; };
    window.addEventListener('pointermove', this._onMove);
    const io = this._io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting && !e.target._inT) e.target._inT = performance.now() + Math.random() * 180; }), { threshold: 0.15 });
    const scan = () => document.querySelectorAll('[data-float]').forEach(el => { if (el._f) return; const m = (el.getAttribute('style') || '').match(/rotate\((-?[\d.]+)deg\)/); el._f = { rot: m ? parseFloat(m[1]) : 0, ph: Math.random() * 6.28, tx: 0, ty: 0, s: 1 }; io.observe(el); });
    scan(); this._scanT = setInterval(scan, 1200);
    const back = x => 1 + 2.4 * Math.pow(x - 1, 3) + 1.4 * Math.pow(x - 1, 2);
    const loop = now => {
      const t = now / 1000, motion = this.props.motion ?? true, vh = window.innerHeight;
      document.querySelectorAll('[data-float]').forEach(el => {
        const fl = el._f; if (!fl) return;
        const r = el.getBoundingClientRect(); if (r.bottom < -80 || r.top > vh + 80) return;
        let dx = 0, dy = 0, near = 0;
        if (this._px != null) { dx = (this._px - (r.left + r.width / 2)) / 320; dy = (this._py - (r.top + r.height / 2)) / 320; near = Math.max(0, 1 - Math.hypot(dx, dy)); }
        fl.tx += (dx * near * 26 - fl.tx) * 0.1; fl.ty += (dy * near * 26 - fl.ty) * 0.1; fl.s += (1 + near * 0.08 - fl.s) * 0.1;
        const hero = el.hasAttribute('data-hero-tile');
        const k = hero ? 1 : (el._inT ? Math.max(0, Math.min(1, (now - el._inT) / 750)) : 0);
        const sc = k < 1 ? 0.55 + 0.45 * back(k) : 1;
        const amp = motion ? Math.max(1.5, r.height * 0.05) : 0;
        if (!hero) el.style.opacity = String(Math.min(1, k * 2));
        el.style.transform = `perspective(700px) translateY(${Math.sin(t * 1.5 + fl.ph) * amp + (1 - k) * 24}px) rotate(${fl.rot * (0.4 + 0.6 * k) + (motion ? Math.sin(t * 1.1 + fl.ph) * 2.5 : 0) + (1 - k) * -14}deg) rotateY(${fl.tx}deg) rotateX(${-fl.ty}deg) scale(${fl.s * sc})`;
      });
      this._fraf = requestAnimationFrame(loop);
    };
    this._fraf = requestAnimationFrame(loop);
  }
  hideTiles = () => { if (!this.state.tilesOut) this.setState({ tilesOut: true }); };
  onPayIn = e => {
    if (this._lite || e.animationName !== 'lh-pay-in') return;
    clearTimeout(this._tilesT);
    this._tilesT = setTimeout(this.hideTiles, 2200);
  };

  componentWillUnmount() {
    clearTimeout(this._tilesT);
    cancelAnimationFrame(this._fraf);
    clearInterval(this._scanT);
    this._io?.disconnect();
    this._sceneIO?.disconnect();
    clearTimeout(this._wordT);
    this._typeStop = true;
    clearInterval(this._clockT);
    clearTimeout(this._dt);
    if (this._onMove) window.removeEventListener('pointermove', this._onMove);
    this.disposeScene();
  }

  startTypewriter(reduce) {
    const word = 'username';
    if (reduce) {
      this.setState({ typed: word, emailOn: true, caret: false });
      return;
    }
    let len = 0;
    const tick = () => {
      if (this._typeStop) return;
      len += 1;
      const done = len >= word.length;
      this.setState({ typed: word.slice(0, len), caret: !done });
      if (done) {
        this._wordT = setTimeout(() => { if (!this._typeStop) this.setState({ emailOn: true }); }, 280);
        return;
      }
      this._wordT = setTimeout(tick, 78);
    };
    this._wordT = setTimeout(tick, 480);
  }

  disposeScene() {
    const s = this._scene; this._scene = null; this._gen = (this._gen || 0) + 1;
    if (!s) return;
    cancelAnimationFrame(s.raf); s.ro.disconnect(); s.cleanup();
    s.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    s.renderer.dispose(); s.renderer.domElement.remove();
  }

  async initScene(el) {
    if (this._lite) return;
    const gen = this._gen = (this._gen || 0) + 1;
    window.__looftaThree = window.__looftaThree || Promise.all([
      import('three'),
      import('three/examples/jsm/environments/RoomEnvironment.js'),
      import('three/examples/jsm/geometries/RoundedBoxGeometry.js')
    ]);
    let mods; try { mods = await window.__looftaThree; } catch (e) { console.warn('three load failed', e); return; }
    if (gen !== this._gen || !el.isConnected || this._lite) return;
    try { this._build(el, mods); } catch (e) { console.error('hero scene failed', e); }
  }
  _build(el, mods) {
    const [THREE, { RoomEnvironment }, { RoundedBoxGeometry }] = mods;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    el.appendChild(renderer.domElement);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.82;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    Object.assign(renderer.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
    renderer.setSize(Math.max(2, el.clientWidth), Math.max(2, el.clientHeight), false);
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 5.2, 14.6); camera.lookAt(0, 1.15, 0);
    const key = new THREE.DirectionalLight(0xfff1e0, 2.6); key.position.set(3, 8, 5); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 }); key.shadow.radius = 6; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03; scene.add(key);
    const rimL = new THREE.DirectionalLight(0xffb070, 1.8); rimL.position.set(-3, 4, -7); scene.add(rimL);
    const fill = new THREE.DirectionalLight(0xff7a3a, 1.2); fill.position.set(-5, 1, 2); scene.add(fill);
    const inner = new THREE.PointLight(0xffa040, 0, 7, 1.4); inner.position.set(0, -0.2, 0); scene.add(inner);

    const pcv = document.createElement('canvas'); pcv.width = pcv.height = 512; const pg = pcv.getContext('2d');
    pg.fillStyle = '#E63A08'; pg.fillRect(0, 0, 512, 512);
    const img = pg.getImageData(0, 0, 512, 512), px = img.data; for (let i = 0; i < px.length; i += 4) { const nz = (Math.random() - 0.5) * 14; px[i] += nz; px[i + 1] += nz * 0.6; px[i + 2] += nz * 0.4; } pg.putImageData(img, 0, 0);
    pg.fillStyle = 'rgba(255,170,90,0.55)'; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { pg.beginPath(); pg.arc(32 + x * 64 + (y % 2) * 32, 32 + y * 64, 7, 0, 6.29); pg.fill(); }
    const paper = new THREE.CanvasTexture(pcv); paper.colorSpace = THREE.SRGBColorSpace; paper.wrapS = paper.wrapT = THREE.RepeatWrapping; paper.anisotropy = 8;
    const clay = new THREE.MeshPhysicalMaterial({ map: paper, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.45, envMapIntensity: 0.7, sheen: 0.3, sheenColor: new THREE.Color(0xFF9A5A) });
    const ribbon = new THREE.MeshPhysicalMaterial({ color: 0xF7E6CF, roughness: 0.3, sheen: 1, sheenRoughness: 0.25, sheenColor: new THREE.Color(0xFFFFFF), clearcoat: 0.5, clearcoatRoughness: 0.2, envMapIntensity: 0.9 });
    const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d');
    const gr = g.createRadialGradient(100, 90, 10, 128, 128, 128); gr.addColorStop(0, '#FFE9A0'); gr.addColorStop(0.6, '#F5B70C'); gr.addColorStop(1, '#C98204');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#9A5A00'; g.font = `800 160px ${sora.style.fontFamily}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', 128, 136);
    const face = new THREE.CanvasTexture(cv); face.colorSpace = THREE.SRGBColorSpace;
    const goldSide = new THREE.MeshStandardMaterial({ color: 0xE9A10A, metalness: 1, roughness: 0.25 });
    const goldFace = new THREE.MeshStandardMaterial({ map: face, metalness: 0.75, roughness: 0.3 });

    const root = new THREE.Group(); root.scale.setScalar(1.6); scene.add(root);
    const wt = 0.2, wall = (w, h, d, x, y, z, m = clay) => { const o = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, 0.09), m); o.position.set(x, y, z); root.add(o); return o; };
    wall(2, 0.22, 2, 0, -0.89, 0);
    wall(2, 1.6, wt, 0, -0.2, 1 - wt / 2); wall(2, 1.6, wt, 0, -0.2, -(1 - wt / 2));
    wall(wt, 1.6, 2 - wt * 2, 1 - wt / 2, -0.2, 0); wall(wt, 1.6, 2 - wt * 2, -(1 - wt / 2), -0.2, 0);
    wall(0.44, 1.64, 0.06, 0, -0.2, 1.01, ribbon); wall(0.44, 1.64, 0.06, 0, -0.2, -1.01, ribbon);
    wall(0.06, 1.64, 0.44, 1.01, -0.2, 0, ribbon); wall(0.06, 1.64, 0.44, -1.01, -0.2, 0, ribbon);
    const innerMat = new THREE.MeshStandardMaterial({ color: 0xFF7A2A, emissive: 0xFF6A1A, emissiveIntensity: 0, roughness: 0.6 });
    const innerFloor = new THREE.Mesh(new THREE.PlaneGeometry(1.58, 1.58), innerMat); innerFloor.rotation.x = -Math.PI / 2; innerFloor.position.y = -0.77; root.add(innerFloor);
    const gcv = document.createElement('canvas'); gcv.width = 4; gcv.height = 256; const gg = gcv.getContext('2d'); const lg = gg.createLinearGradient(0, 0, 0, 256); lg.addColorStop(0, 'rgba(255,200,120,0)'); lg.addColorStop(0.55, 'rgba(255,170,80,0.35)'); lg.addColorStop(1, 'rgba(255,220,150,0.95)'); gg.fillStyle = lg; gg.fillRect(0, 0, 4, 256);
    const beamTex = new THREE.CanvasTexture(gcv);
    const beamMat = new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const scv = document.createElement('canvas'); scv.width = scv.height = 256; const sg = scv.getContext('2d'); const rg = sg.createRadialGradient(128, 128, 0, 128, 128, 128); rg.addColorStop(0, 'rgba(255,220,150,1)'); rg.addColorStop(0.3, 'rgba(255,150,60,0.45)'); rg.addColorStop(1, 'rgba(255,90,20,0)'); sg.fillStyle = rg; sg.fillRect(0, 0, 256, 256);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(scv), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); halo.scale.set(3.6, 3.6, 1); halo.position.y = 1.0; root.add(halo);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xFFD49A, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), glowMat); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.58; root.add(glow);
    const sparkG = new THREE.BufferGeometry(); const SP = 60, sp = new Float32Array(SP * 3), seeds = [];
    for (let i = 0; i < SP; i++) seeds.push([Math.random() * 1.4 - 0.7, Math.random(), Math.random() * 1.4 - 0.7, 0.4 + Math.random() * 0.6]);
    sparkG.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    const sparkMat = new THREE.PointsMaterial({ color: 0xFFE2A8, size: 0.06, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    root.add(new THREE.Points(sparkG, sparkMat));
    const pivot = new THREE.Group(); pivot.position.set(0, 0.6, -1.12); root.add(pivot);
    const lid = new THREE.Group(); lid.position.set(0, 0.24, 1.12); pivot.add(lid);
    lid.add(new THREE.Mesh(new RoundedBoxGeometry(2.26, 0.48, 2.26, 8, 0.22), clay));
    lid.add(new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.52, 2.3, 4, 0.12), ribbon));
    lid.add(new THREE.Mesh(new RoundedBoxGeometry(2.3, 0.52, 0.46, 4, 0.12), ribbon));
    const loopG = new THREE.TorusGeometry(0.36, 0.1, 24, 72);
    const l1 = new THREE.Mesh(loopG, ribbon); l1.position.set(-0.32, 0.5, 0); l1.rotation.set(0, 0.35, 0.55); l1.scale.set(1, 1, 0.42); lid.add(l1);
    const l2 = new THREE.Mesh(loopG, ribbon); l2.position.set(0.32, 0.5, 0); l2.rotation.set(0, -0.35, -0.55); l2.scale.set(1, 1, 0.42); lid.add(l2);
    [[-1, 0.5], [1, -0.5]].forEach(([sx, ry]) => { const tail = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.04, 0.8, 2, 0.015), ribbon); tail.position.set(sx * 0.22, 0.285, 0.42); tail.rotation.set(0.12, ry, 0); lid.add(tail); });
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.17, 32, 32), ribbon); knot.position.y = 0.3; lid.add(knot);
    const coinG = new THREE.CylinderGeometry(0.5, 0.5, 0.14, 64);
    const rimG = new THREE.TorusGeometry(0.5, 0.05, 12, 72);
    const coins = [0, 1, 2].map(i => { const c = new THREE.Mesh(coinG, [goldSide, goldFace, goldFace]); const rm = new THREE.Mesh(rimG, goldSide); rm.rotation.x = Math.PI / 2; c.add(rm); c.rotation.x = Math.PI / 2; c.scale.setScalar(0.001); root.add(c); return c; });
    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    [glow, innerFloor].forEach(o => { o.castShadow = false; });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.ShadowMaterial({ color: 0x1a0600, opacity: 0.55 })); ground.rotation.x = -Math.PI / 2; ground.position.set(0, -1.95, 0); ground.receiveShadow = true; scene.add(ground);
    const gglow = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({ map: halo.material.map, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); gglow.rotation.x = -Math.PI / 2; gglow.position.set(0, -1.94, 0); scene.add(gglow);

    const W = () => el.clientWidth, H = () => el.clientHeight; let lw = 0, lh = 0;
    const fit = () => { const w = W(), h = H(); if (w < 2 || h < 2) return; lw = w; lh = h; renderer.setSize(w, h, false); camera.aspect = w / h; camera.position.z = w / h < 1.15 ? 14.6 * 1.15 / (w / h) : 14.6; camera.updateProjectionMatrix(); };
    const ro = new ResizeObserver(fit); ro.observe(el); fit();
    let target = 0, open = 0, vel = 0, wig = 0, prevT = 0, t = 0, ry = 0, rx = 0, hover = false, auto = 0;
    const onClick = () => { target = target > 0.5 ? 0 : 1; auto = 0; };
    this._gift = { set: v => { target = v; auto = v ? -5 : -2; } };
    const onEnter = () => { hover = true; }, onLeave = () => { hover = false; };
    el.addEventListener('click', onClick); el.addEventListener('pointerenter', onEnter); el.addEventListener('pointerleave', onLeave);
    const clock = new THREE.Clock();
    const s = { renderer, scene, ro, raf: 0, cleanup: () => { el.removeEventListener('click', onClick); el.removeEventListener('pointerenter', onEnter); el.removeEventListener('pointerleave', onLeave); } };
    const ease = x => 1 - Math.pow(1 - x, 3);
    const tick = () => { try { tick2(); } catch (e) { if (!s.err) console.error('hero tick failed', e); s.err = true; } s.raf = requestAnimationFrame(tick); };
    const tick2 = () => {
      const dt = Math.min(clock.getDelta(), 0.05); t += dt; auto += dt;
      if (W() !== lw || H() !== lh) fit();
      if (!hover && !this.state.drawing && auto > (target > 0.5 ? 4.5 : 2.2)) { target = target > 0.5 ? 0 : 1; auto = 0; }
      if (hover && auto > 0.2) target = 1;
      if (target !== prevT) { if (target > 0.5) wig = 1; prevT = target; }
      wig *= 0.92;
      const delay = target > 0.5 && wig > 0.35;
      vel = vel * 0.84 + ((delay ? 0 : target) - open) * 0.03; open += vel;
      const r = el.getBoundingClientRect();
      let mx = 0, my = 0;
      if (this._px != null) { mx = Math.max(-1, Math.min(1, ((this._px - r.left) / r.width) * 2 - 1)); my = Math.max(-1, Math.min(1, ((this._py - r.top) / r.height) * 2 - 1)); }
      ry += ((-0.55 + mx * 0.45 + Math.sin(t * 0.5) * 0.08) - ry) * 0.05; rx += ((0.16 + my * 0.1) - rx) * 0.05;
      root.rotation.y = ry; root.rotation.x = rx; root.rotation.z = Math.sin(t * 42) * 0.045 * wig; root.position.y = Math.sin(t * 1.4) * 0.08 - 0.25 + wig * 0.06; root.scale.set(1.6 * (1 + wig * 0.03), 1.6 * (1 - wig * 0.05), 1.6 * (1 + wig * 0.03));
      pivot.rotation.x = -Math.max(0, open) * 1.95;
      const o = Math.min(1, Math.max(0, open));
      inner.intensity = o * 22; innerMat.emissiveIntensity = o * 1.6;
      halo.material.opacity = o * 0.85 * (0.88 + Math.sin(t * 3) * 0.12); glowMat.opacity = o * 0.9; gglow.material.opacity = o * 0.45;
      sparkMat.opacity = o;
      for (let i = 0; i < SP; i++) { const q = seeds[i], k = (q[1] + t * 0.25 * q[3]) % 1; sp[i * 3] = q[0] * (1 + k * 0.5); sp[i * 3 + 1] = -0.4 + k * 3.2; sp[i * 3 + 2] = q[2] * (1 + k * 0.5); }
      sparkG.attributes.position.needsUpdate = true;
      coins.forEach((c, i) => {
        const k = Math.max(0, Math.min(1, open * 1.6 - i * 0.25));
        const e = ease(k);
        c.scale.setScalar(Math.max(0.001, e));
        c.position.set((i - 1) * 0.75 * e, 0.2 + e * (1.5 + (i === 1 ? 0.45 : 0)), 0.15 * i);
        c.rotation.z = t * 2.2 + i + (1 - e) * 6; c.rotation.x = Math.PI / 2 + Math.sin(t * 2 + i) * 0.25;
      });
      renderer.render(scene, camera);
    };
    this._scene = s;
    try { tick2(); } catch (e) { console.error('hero first frame failed', e); }
    s.raf = requestAnimationFrame(tick);
  }

  draw = () => {
    if (this.state.drawing) return;
    const n = this.entr.length, win = Math.floor(Math.random() * n);
    let steps = 22 + win + n - (22 % n), i = 0, delay = 50;
    this.setState({ drawing: true, winner: -1 }); this._gift && this._gift.set(0);
    const step = () => {
      this.setState({ hi: i % n }); i++;
      if (i >= steps) { this.setState({ drawing: false, winner: (i - 1) % n, hi: (i - 1) % n }); this._gift && this._gift.set(1); return; }
      delay *= i > steps - 8 ? 1.28 : 1.02;
      this._dt = setTimeout(step, delay);
    };
    step();
  };

  renderVals() {
    const now = this.state.now;
    const next = new Date(now ?? 0); next.setUTCHours(24, 0, 0, 0);
    const d = Math.max(0, next - (now ?? 0)), p = n => String(n).padStart(2, '0');
    const ic = id => `url(https://s2.coinmarketcap.com/static/img/coins/128x128/${id}.png)`;
    const tokens = [
      { sym: 'USDC', bg: ic(3408), glow: 'radial-gradient(70% 55% at 50% 38%,rgba(39,117,202,0.38),rgba(39,117,202,0) 70%),#0D0F14' },
      { sym: 'SOL', bg: ic(5426), glow: 'radial-gradient(70% 55% at 50% 38%,rgba(153,69,255,0.32),rgba(153,69,255,0) 70%),#0F0D14' },
      { sym: 'ETH', bg: ic(1027), glow: 'radial-gradient(70% 55% at 50% 38%,rgba(130,140,240,0.3),rgba(130,140,240,0) 70%),#0E0E14' },
      { sym: 'BTC', bg: ic(1), glow: 'radial-gradient(70% 55% at 50% 38%,rgba(247,147,26,0.34),rgba(247,147,26,0) 70%),#130F0A' }
    ];
    const S = this.state, sh = S.shield;
    const tiles = [['#FFC79A,#FF5A1A 45%,#D23806', '#9C2802', '#fff'], ['#FFFFFF,#ECEAF0 45%,#BDBAC6', '#8C8898', '#16161C'], ['#FFE9A8,#F5B70C 45%,#C98A04', '#8E6002', '#3A2400']];
    const entrants = this.entr.map((h, i) => {
      const on = S.hi === i, won = S.winner === i && !S.drawing;
      const tl = tiles[i % 3];
      return { h, init: h[1].toUpperCase(), tile: `radial-gradient(120% 120% at 28% 18%,${tl[0]} 100%)`, rim: tl[1], ink: tl[2],
        bg: won ? 'linear-gradient(160deg,rgba(255,74,18,0.35),rgba(245,183,12,0.2))' : (on ? '#22222A' : '#15151A'),
        bd: won ? 'rgba(255,140,40,0.7)' : (on ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.06)'),
        tf: won ? 'translateY(-6px) scale(1.06)' : (on ? 'translateY(-3px)' : 'none') };
    });
    return {
      typed: S.typed, emailOn: S.emailOn, caret: S.caret, heroRef: this.heroRef, tilesOut: S.tilesOut, hideTiles: this.hideTiles, tilt: this.tilt, untilt: this.untilt, lite: S.lite,
      countdown: now == null ? '--:--:--' : `${p(Math.floor(d / 3.6e6))}:${p(Math.floor(d / 6e4) % 60)}:${p(Math.floor(d / 1e3) % 60)}`,
      tokens, entrants, draw: this.draw,
      drawLabel: S.drawing ? 'Drawing…' : (S.winner >= 0 ? 'Draw again' : 'Draw a winner'),
      drawOpacity: S.drawing ? 0.6 : 1,
      drawStatus: S.winner >= 0 && !S.drawing ? `${this.entr[S.winner]} wins. Paid from escrow.` : '1,284 entrants',
      togglePrivacy: () => this.setState(s => ({ shield: !s.shield })),
      pTrack: sh ? 'linear-gradient(90deg,#FF2D0A,#F5B70C)' : '#3A3A44', pKnob: sh ? 'translateX(24px)' : 'translateX(0px)',
      privGlow: sh ? 'rgba(255,90,26,0.28)' : 'rgba(255,255,255,0.06)',
      lockBg: sh ? 'radial-gradient(120% 120% at 28% 18%,#FFC79A 0%,#FF5A1A 45%,#D23806 100%)' : 'radial-gradient(120% 120% at 28% 18%,#FFFFFF 0%,#ECEAF0 45%,#BDBAC6 100%)',
      lockRim: sh ? '#9C2802' : '#8C8898', lockInk: sh ? '#FFFFFF' : '#16161C',
      lockPath: sh ? 'M8 11V8a4 4 0 0 1 8 0v3' : 'M8 11V8a4 4 0 0 1 7.5-2',
      trail: sh ? 'sender → ████ → recipient · amount hidden' : 'you → them · $50.00 USDC · public'
    };
  }

  render() {
    const v = this.renderVals();
    return (
      <div className={`loofta-home ${sora.variable} ${manrope.variable} ${jetbrainsMono.variable}`} style={{ position: "relative", minHeight: "100vh", overflowX: "hidden" }}>
      <nav className="lh-nav" style={{ position: "sticky", top: "0", zIndex: "60", background: "rgba(7,7,10,0.8)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}>
        <div className="lh-nav-bar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "20px", padding: "16px clamp(20px,4vw,64px)" }}>
          <a href="https://loofta.com/" style={{ display: "flex", alignItems: "center" }}>
            <img src="/loofta_white.svg" alt="loofta" style={{ height: "30px", display: "block" }} />
          </a>
          <div className="lh-nav-links" style={{ display: "flex", alignItems: "center", gap: "32px", fontSize: "16px", fontWeight: "500", justifyContent: "center" }}>
            <a href="#giveaways" style={{ color: "#C9C6CF" }}>Giveaways</a>
            <a href="#cashout" style={{ color: "#C9C6CF" }}>Cash out</a>
            <a href="#how" style={{ color: "#C9C6CF" }}>How it works</a>
            <a href="#send" style={{ color: "#C9C6CF" }}>Send</a>
            <a href="#business" style={{ color: "#C9C6CF" }}>Business</a>
          </div>
          <div className="lh-nav-actions" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <a className="lh-nav-cta" href={this.state.appUrl} style={{ padding: "13px 26px", borderRadius: "999px", background: "linear-gradient(90deg,#FF2D0A,#F5B70C)", color: "#fff", fontFamily: SORA, fontWeight: "600", fontSize: "15px", boxShadow: "0 8px 30px rgba(255,70,10,0.4)" }}>Open app</a>
            <button
              type="button"
              className="lh-nav-burger"
              aria-label={this.state.menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={this.state.menuOpen}
              aria-controls="lh-mobile-menu"
              onClick={() => this.setState(s => ({ menuOpen: !s.menuOpen }))}
            >
              {this.state.menuOpen ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              )}
            </button>
          </div>
        </div>
        {this.state.menuOpen ? (
          <div className="lh-mobile-menu" id="lh-mobile-menu" role="dialog" aria-modal="true" aria-label="Site menu">
            <a href="#giveaways" onClick={() => this.setState({ menuOpen: false })}>Giveaways</a>
            <a href="#cashout" onClick={() => this.setState({ menuOpen: false })}>Cash out</a>
            <a href="#how" onClick={() => this.setState({ menuOpen: false })}>How it works</a>
            <a href="#send" onClick={() => this.setState({ menuOpen: false })}>Send</a>
            <a href="#business" onClick={() => this.setState({ menuOpen: false })}>Business</a>
            <a className="lh-mobile-cta" href={this.state.appUrl} onClick={() => this.setState({ menuOpen: false })}>Open app</a>
          </div>
        ) : null}
      </nav>
      <section id="send" data-screen-label="Hero" style={{ position: "relative", maxWidth: "1520px", margin: "0 auto", padding: "72px clamp(24px,5vw,96px) 110px", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", gap: "72px 64px", alignItems: "start" }}>
        <div className="lh-hero-copy" style={{ position: "relative", display: "flex", flexDirection: "column", gap: "26px", minWidth: "0" }}>
          <h1 className="lh-hero-title" aria-label="Send money to any @username or email." style={{ margin: "0", fontFamily: SORA, fontWeight: "700", lineHeight: "1.02", letterSpacing: "-0.06em" }}>
            <span style={{ display: "block", color: "#F2EFE8" }}>Send money to</span>
            <span className="lh-nowrap" style={{ display: "block", color: "#F2EFE8" }}>
              any @{v.typed}{v.caret ? <span className="lh-caret" aria-hidden="true" /> : null}
            </span>
            <span className={v.emailOn ? "lh-email-line is-on" : "lh-email-line"}>or email.</span>
          </h1>
          <p style={{ margin: "0", maxWidth: "540px", fontSize: "clamp(17px,1.35vw,20px)", lineHeight: "1.55", color: "#A9A7B0", textWrap: "pretty" }}>They don't need a wallet. Type a handle, send, they cash out in their country — bank, Venmo, Cash App, or 150+ tokens.</p>
        </div>
        <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
          <div style={{ position: "absolute", inset: "-18% -14%", background: "radial-gradient(closest-side,rgba(255,80,20,0.24),rgba(255,80,20,0))", pointerEvents: "none" }}></div>
          <div className="lh-pay-cluster" onAnimationEnd={this.onPayIn} style={{ position: "relative", width: "100%", maxWidth: "500px" }}>
            {!v.lite ? (
            <div className="lh-hero-tiles" aria-hidden style={{ position: "absolute", inset: "0", pointerEvents: "none", transition: "opacity .55s ease, transform .55s ease", opacity: v.tilesOut ? 0 : 1, transform: v.tilesOut ? "scale(0.92)" : "none" }}>
            <span data-float="" data-hero-tile="" style={{ position: "absolute", top: "-30px", left: "-96px", zIndex: "0", width: "104px", height: "104px", borderRadius: "32px", transform: "rotate(-10deg)", background: "radial-gradient(120% 120% at 28% 18%,#FFFFFF 0%,#ECEAF0 45%,#BDBAC6 100%)", boxShadow: "inset 0 4px 7px rgba(255,255,255,0.55),inset 0 -8px 14px rgba(0,0,0,0.22),0 9px 0 #8C8898,0 30px 50px rgba(255,90,26,0.25)", display: "grid", placeItems: "center", pointerEvents: "none" }}>
              <svg width="50" height="50" viewBox="0 0 24 24" fill="none" stroke="#16161C" strokeWidth="2.4" strokeLinecap="round">
                <circle cx="12" cy="12" r="4"></circle>
                <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"></path>
              </svg>
            </span>
            <span data-float="" data-hero-tile="" style={{ position: "absolute", top: "-58px", right: "30px", zIndex: "0", width: "72px", height: "72px", borderRadius: "22px", transform: "rotate(12deg)", background: "radial-gradient(120% 120% at 28% 18%,#8DF5A6 0%,#00D632 45%,#00A326 100%)", boxShadow: "inset 0 4px 7px rgba(255,255,255,0.55),inset 0 -8px 14px rgba(0,0,0,0.22),0 6px 0 #00761C,0 30px 50px rgba(0,0,0,0.5)", display: "grid", placeItems: "center", pointerEvents: "none" }}>
              <span style={{ fontFamily: SORA, fontWeight: "800", fontSize: "42px", color: "#fff", textShadow: "0 2px 0 rgba(0,0,0,0.15)" }}>$</span>
            </span>
            <span data-float="" data-hero-tile="" style={{ position: "absolute", top: "34%", right: "-104px", zIndex: "0", width: "112px", height: "112px", borderRadius: "34px", transform: "rotate(8deg)", background: "radial-gradient(120% 120% at 28% 18%,#FFC79A 0%,#FF5A1A 45%,#D23806 100%)", boxShadow: "inset 0 4px 7px rgba(255,255,255,0.55),inset 0 -8px 14px rgba(0,0,0,0.22),0 9px 0 #9C2802,0 30px 50px rgba(255,70,10,0.35)", display: "grid", placeItems: "center", pointerEvents: "none" }}>
              <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="14" rx="3"></rect>
                <path d="m3.5 7 8.5 6 8.5-6"></path>
              </svg>
            </span>
            <span data-float="" data-hero-tile="" style={{ position: "absolute", bottom: "110px", left: "-92px", zIndex: "0", width: "92px", height: "92px", borderRadius: "46px", transform: "rotate(6deg)", background: "radial-gradient(120% 120% at 28% 18%,#FFF0B8 0%,#F5B70C 42%,#D17A04 100%)", boxShadow: "inset 0 4px 7px rgba(255,255,255,0.55),inset 0 -8px 14px rgba(0,0,0,0.22),0 8px 0 #8E5202,0 30px 50px rgba(245,150,12,0.3)", display: "grid", placeItems: "center", pointerEvents: "none" }}>
              <span style={{ fontFamily: SORA, fontWeight: "800", fontSize: "50px", color: "#7A3A04", textShadow: "0 1px 0 rgba(255,240,200,0.6)" }}>$</span>
            </span>
            <span data-float="" data-hero-tile="" style={{ position: "absolute", bottom: "-54px", right: "-60px", zIndex: "0", width: "96px", height: "96px", borderRadius: "30px", transform: "rotate(-7deg)", background: "radial-gradient(120% 120% at 28% 18%,#9AD4F5 0%,#3D95CE 45%,#1E6CA4 100%)", boxShadow: "inset 0 4px 7px rgba(255,255,255,0.55),inset 0 -8px 14px rgba(0,0,0,0.22),0 8px 0 #14507E,0 30px 50px rgba(0,0,0,0.5)", display: "grid", placeItems: "center", pointerEvents: "none" }}>
              <span style={{ fontFamily: SORA, fontWeight: "800", fontStyle: "italic", fontSize: "56px", color: "#fff", textShadow: "0 3px 0 rgba(0,0,0,0.15)" }}>V</span>
            </span>
            </div>
            ) : null}
            <div style={{ position: "relative", zIndex: "1" }} onPointerDownCapture={v.hideTiles} onFocusCapture={v.hideTiles}>
              <SendWidget still />
            </div>
          </div>
        </div>
      </section>
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "30px clamp(20px,4vw,64px)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "28px 48px", flexWrap: "wrap" }}>
        <img src="/images/home-v2/solana-wordmark.svg" alt="Solana" style={{ height: "22px", display: "block", opacity: "0.85" }} />
        <img src="/images/home-v2/magicblock-wordmark.svg" alt="MagicBlock" style={{ height: "24px", display: "block", opacity: "0.85" }} />
        <img src="/images/home-v2/blink-wordmark-white.png" alt="Blink" style={{ height: "24px", display: "block", opacity: "0.85" }} />
        <img src="/images/home-v2/megapot-wordmark.svg" alt="Megapot" style={{ height: "24px", display: "block", opacity: "0.85" }} />
        <img src="/images/home-v2/superteam-ireland-wordmark.svg" alt="Superteam Ireland" style={{ height: "28px", display: "block", opacity: "0.85" }} />
      </div>
      <section style={{ padding: "clamp(100px,12vw,180px) clamp(20px,6vw,140px)" }}>
        <p style={{ margin: "0", maxWidth: "1500px", fontFamily: SORA, fontWeight: "700", fontSize: "clamp(34px,4.6vw,76px)", lineHeight: "1.18", letterSpacing: "-0.045em", color: "#F2EFE8", textWrap: "pretty" }}>
          {"Loofta pays a handle or an email, and they cash out to "}
          <span data-float="" style={{ display: "inline-flex", verticalAlign: "middle", width: "1.05em", height: "1.05em", borderRadius: "0.3em", transform: "rotate(-6deg)", background: "radial-gradient(120% 120% at 28% 18%,#9AD4F5 0%,#3D95CE 45%,#1E6CA4 100%)", boxShadow: "inset 0 0.04em 0.06em rgba(255,255,255,0.6),inset 0 -0.06em 0.1em rgba(0,0,0,0.25),0 0.07em 0 #14507E,0 0.2em 0.4em rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", fontSize: "0.8em", fontWeight: "800", fontStyle: "italic", color: "#fff", textShadow: "0 0.04em 0 rgba(0,0,0,0.2)" }}>V</span>
          {" Venmo, "}
          <span data-float="" style={{ display: "inline-flex", verticalAlign: "middle", width: "1.05em", height: "1.05em", borderRadius: "0.3em", transform: "rotate(4deg)", background: "radial-gradient(120% 120% at 28% 18%,#8DF5A6 0%,#00D632 45%,#00A326 100%)", boxShadow: "inset 0 0.04em 0.06em rgba(255,255,255,0.6),inset 0 -0.06em 0.1em rgba(0,0,0,0.25),0 0.07em 0 #00761C,0 0.2em 0.4em rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", fontSize: "0.8em", fontWeight: "800", color: "#fff", textShadow: "0 0.04em 0 rgba(0,0,0,0.2)" }}>$</span>
          {" Cash App, "}
          <span data-float="" style={{ display: "inline-flex", verticalAlign: "middle", width: "1.05em", height: "1.05em", borderRadius: "0.3em", transform: "rotate(-3deg)", background: "radial-gradient(120% 120% at 28% 18%,#FFFFFF 0%,#ECEAF0 45%,#BDBAC6 100%)", boxShadow: "inset 0 0.04em 0.06em rgba(255,255,255,0.9),inset 0 -0.06em 0.1em rgba(0,0,0,0.18),0 0.07em 0 #8C8898,0 0.2em 0.4em rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", fontSize: "0.72em", fontWeight: "800", color: "#111" }}>R</span>
          {" Revolut, "}
          <span data-float="" style={{ display: "inline-flex", verticalAlign: "middle", width: "1.05em", height: "1.05em", borderRadius: "0.3em", transform: "rotate(5deg)", background: "radial-gradient(120% 120% at 28% 18%,#C49BFF 0%,#6D1ED4 50%,#4A0FA0 100%)", boxShadow: "inset 0 0.04em 0.06em rgba(255,255,255,0.5),inset 0 -0.06em 0.1em rgba(0,0,0,0.25),0 0.07em 0 #36087A,0 0.2em 0.4em rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", fontSize: "0.78em", fontWeight: "800", color: "#fff" }}>Z</span>
          {" Zelle, or "}
          <span data-float="" style={{ display: "inline-flex", verticalAlign: "middle", width: "1.05em", height: "1.05em", borderRadius: "0.3em", transform: "rotate(-5deg)", background: "radial-gradient(120% 120% at 28% 18%,#FFC79A 0%,#FF5A1A 45%,#D23806 100%)", boxShadow: "inset 0 0.04em 0.06em rgba(255,255,255,0.55),inset 0 -0.06em 0.1em rgba(0,0,0,0.25),0 0.07em 0 #9C2802,0 0.2em 0.4em rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" }}>
            <svg width="0.6em" height="0.6em" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round">
              <ellipse cx="12" cy="6" rx="7" ry="3"></ellipse>
              <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"></path>
            </svg>
          </span>
          {" 150+ "}
          <span style={{ color: "#66646E" }}>tokens. No crypto required.</span>
        </p>
      </section>
      <section id="privacy" data-screen-label="Privacy" style={{ padding: "0 clamp(20px,4vw,64px) clamp(100px,10vw,160px)" }}>
        <div style={{ maxWidth: "1440px", margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,440px),1fr))", gap: "56px", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
            <span style={{ fontFamily: MONO, fontSize: "14px", letterSpacing: "0.2em", color: "#FF6A2A" }}>PRIVACY, OPTIONAL</span>
            <h2 style={{ margin: "0", fontFamily: SORA, fontWeight: "700", fontSize: "clamp(46px,5.8vw,96px)", lineHeight: "0.98", letterSpacing: "-0.06em" }}>
              <span style={{ display: "block" }}>Send in private</span>
              <span style={{ display: "block", color: "#66646E" }}>whenever you choose.</span>
            </h2>
            <p style={{ margin: "0", maxWidth: "540px", fontSize: "18px", lineHeight: "1.6", color: "#A9A7B0", textWrap: "pretty" }}>Flip on Shielded mode and MagicBlock hides the link between sender and recipient. No one can trace who paid whom or how much. Leave it off for a normal transfer. The choice is yours, on every payment.</p>
          </div>
          <div style={{ borderRadius: "40px", background: `radial-gradient(70% 60% at 50% 30%,${v.privGlow},rgba(0,0,0,0) 70%),#0F0F13`, border: "1px solid rgba(255,255,255,0.07)", padding: "40px", display: "flex", flexDirection: "column", alignItems: "center", gap: "32px" }}>
            <span data-float="" style={{ marginTop: "12px", width: "150px", height: "150px", borderRadius: "46px", transform: "rotate(-5deg)", background: v.lockBg, boxShadow: `inset 0 6px 10px rgba(255,255,255,0.55),inset 0 -10px 18px rgba(0,0,0,0.22),0 12px 0 ${v.lockRim},0 40px 60px rgba(0,0,0,0.5)`, display: "grid", placeItems: "center", transition: "background .3s" }}>
              <svg width="70" height="70" viewBox="0 0 24 24" fill="none" stroke={v.lockInk} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4.5" y="11" width="15" height="10" rx="2.5"></rect>
                <path d={v.lockPath}></path>
              </svg>
            </span>
            <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderRadius: "20px", background: "#17171C", border: "1px solid rgba(255,255,255,0.08)" }}>
              <span style={{ fontWeight: "600", fontSize: "17px" }}>Shielded mode</span>
              <button onClick={v.togglePrivacy} aria-label="Shielded mode" style={{ position: "relative", width: "56px", height: "32px", border: "0", borderRadius: "999px", cursor: "pointer", background: v.pTrack, transition: "background .25s" }}>
                <span style={{ position: "absolute", top: "3px", left: "3px", width: "26px", height: "26px", borderRadius: "50%", background: "#fff", transition: "transform .25s", transform: v.pKnob }}></span>
              </button>
            </div>
            <div style={{ width: "100%", padding: "16px 20px", borderRadius: "20px", background: "#0A0A0D", fontFamily: MONO, fontSize: "14px", color: "#C9C6CF", textAlign: "center" }}>{v.trail}</div>
          </div>
        </div>
      </section>
      <section id="cashout" data-screen-label="Cash out" style={{ padding: "0 clamp(20px,4vw,64px) clamp(100px,10vw,160px)" }}>
        <div style={{ maxWidth: "1440px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "56px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "32px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <span style={{ fontFamily: MONO, fontSize: "14px", letterSpacing: "0.2em", color: "#FF6A2A" }}>CLAIM, YOUR WAY</span>
              <h2 style={{ margin: "0", fontFamily: SORA, fontWeight: "700", fontSize: "clamp(46px,6.4vw,104px)", lineHeight: "0.98", letterSpacing: "-0.06em" }}>
                <span style={{ display: "block" }}>Crypto or cash,</span>
                <span style={{ display: "block", color: "#66646E" }}>their call.</span>
              </h2>
            </div>
            <p style={{ margin: "0", maxWidth: "440px", fontSize: "18px", lineHeight: "1.6", color: "#A9A7B0", textWrap: "pretty" }}>{PAJ_CASH_ENABLED ? 'Claim in USDC or any crypto, or cash out to Venmo, Cash App, Revolut, Zelle, or PAJ Cash.' : 'Claim in USDC or any crypto, or cash out to Venmo, Cash App, Revolut, or Zelle.'}</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,260px),1fr))", gap: "20px" }}>
            <div onPointerMove={v.tilt} onPointerLeave={v.untilt} style={{ borderRadius: "32px", background: "radial-gradient(70% 55% at 50% 42%,rgba(61,149,206,0.35),rgba(61,149,206,0) 70%),#0D0F14", border: "1px solid rgba(255,255,255,0.07)", padding: "32px", display: "flex", flexDirection: "column", alignItems: "center", gap: "40px", transition: "transform .3s ease-out" }}>
              <span data-float="" style={{ marginTop: "28px", width: "150px", height: "150px", borderRadius: "44px", background: "radial-gradient(120% 120% at 28% 18%,#9AD4F5 0%,#3D95CE 45%,#1E6CA4 100%)", boxShadow: "inset 0 6px 10px rgba(255,255,255,0.55),inset 0 -10px 18px rgba(0,0,0,0.25),0 12px 0 #14507E,0 40px 60px rgba(0,0,0,0.5)", display: "grid", placeItems: "center", fontFamily: SORA, fontWeight: "800", fontStyle: "italic", fontSize: "92px", color: "#fff", textShadow: "0 4px 0 rgba(0,0,0,0.15)" }}>V</span>
              <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontFamily: SORA, fontWeight: "700", fontSize: "30px", letterSpacing: "-0.04em" }}>Venmo</span>
                <span style={{ fontFamily: MONO, fontSize: "13px", color: "#8A8893" }}>USD</span>
              </div>
            </div>
            <div onPointerMove={v.tilt} onPointerLeave={v.untilt} style={{ borderRadius: "32px", background: "radial-gradient(70% 55% at 50% 42%,rgba(0,214,50,0.3),rgba(0,214,50,0) 70%),#0C110D", border: "1px solid rgba(255,255,255,0.07)", padding: "32px", display: "flex", flexDirection: "column", alignItems: "center", gap: "40px", transition: "transform .3s ease-out" }}>
              <span data-float="" style={{ marginTop: "28px", width: "150px", height: "150px", borderRadius: "44px", background: "radial-gradient(120% 120% at 28% 18%,#8DF5A6 0%,#00D632 45%,#00A326 100%)", boxShadow: "inset 0 6px 10px rgba(255,255,255,0.55),inset 0 -10px 18px rgba(0,0,0,0.25),0 12px 0 #00761C,0 40px 60px rgba(0,0,0,0.5)", display: "grid", placeItems: "center", fontFamily: SORA, fontWeight: "800", fontSize: "92px", color: "#fff", textShadow: "0 4px 0 rgba(0,0,0,0.15)" }}>$</span>
              <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontFamily: SORA, fontWeight: "700", fontSize: "30px", letterSpacing: "-0.04em" }}>Cash App</span>
                <span style={{ fontFamily: MONO, fontSize: "13px", color: "#8A8893" }}>USD</span>
              </div>
            </div>
            <div onPointerMove={v.tilt} onPointerLeave={v.untilt} style={{ borderRadius: "32px", background: "radial-gradient(70% 55% at 50% 42%,rgba(255,255,255,0.16),rgba(255,255,255,0) 70%),#101013", border: "1px solid rgba(255,255,255,0.07)", padding: "32px", display: "flex", flexDirection: "column", alignItems: "center", gap: "40px", transition: "transform .3s ease-out" }}>
              <span data-float="" style={{ marginTop: "28px", width: "150px", height: "150px", borderRadius: "44px", background: "radial-gradient(120% 120% at 28% 18%,#FFFFFF 0%,#ECEAF0 45%,#BDBAC6 100%)", boxShadow: "inset 0 6px 10px rgba(255,255,255,0.9),inset 0 -10px 18px rgba(0,0,0,0.16),0 12px 0 #8C8898,0 40px 60px rgba(0,0,0,0.5)", display: "grid", placeItems: "center", fontFamily: SORA, fontWeight: "800", fontSize: "84px", color: "#111" }}>R</span>
              <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px" }}>
                <span style={{ fontFamily: SORA, fontWeight: "700", fontSize: "30px", letterSpacing: "-0.04em" }}>Revolut</span>
                <span style={{ fontFamily: MONO, fontSize: "13px", color: "#8A8893" }}>USD·EUR·GBP</span>
              </div>
            </div>
            <div onPointerMove={v.tilt} onPointerLeave={v.untilt} style={{ borderRadius: "32px", background: "radial-gradient(70% 55% at 50% 42%,rgba(109,30,212,0.4),rgba(109,30,212,0) 70%),#100C16", border: "1px solid rgba(255,255,255,0.07)", padding: "32px", display: "flex", flexDirection: "column", alignItems: "center", gap: "40px", transition: "transform .3s ease-out" }}>
              <span data-float="" style={{ marginTop: "28px", width: "150px", height: "150px", borderRadius: "44px", background: "radial-gradient(120% 120% at 28% 18%,#C49BFF 0%,#6D1ED4 50%,#4A0FA0 100%)", boxShadow: "inset 0 6px 10px rgba(255,255,255,0.45),inset 0 -10px 18px rgba(0,0,0,0.25),0 12px 0 #36087A,0 40px 60px rgba(0,0,0,0.5)", display: "grid", placeItems: "center", fontFamily: SORA, fontWeight: "800", fontSize: "92px", color: "#fff", textShadow: "0 4px 0 rgba(0,0,0,0.15)" }}>Z</span>
              <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontFamily: SORA, fontWeight: "700", fontSize: "30px", letterSpacing: "-0.04em" }}>Zelle</span>
                <span style={{ fontFamily: MONO, fontSize: "13px", color: "#8A8893" }}>To their bank</span>
              </div>
            </div>
            {PAJ_CASH_ENABLED && (
              <div onPointerMove={v.tilt} onPointerLeave={v.untilt} style={{ borderRadius: "32px", background: "radial-gradient(70% 55% at 50% 42%,rgba(0,135,81,0.35),rgba(0,135,81,0) 70%),#0C110E", border: "1px solid rgba(255,255,255,0.07)", padding: "32px", display: "flex", flexDirection: "column", alignItems: "center", gap: "40px", transition: "transform .3s ease-out" }}>
                <span data-float="" style={{ marginTop: "28px", width: "150px", height: "150px", borderRadius: "44px", background: "radial-gradient(120% 120% at 28% 18%,#9BF0C4 0%,#00A35C 45%,#00703F 100%)", boxShadow: "inset 0 6px 10px rgba(255,255,255,0.5),inset 0 -10px 18px rgba(0,0,0,0.25),0 12px 0 #00502D,0 40px 60px rgba(0,0,0,0.5)", display: "grid", placeItems: "center", fontFamily: SORA, fontWeight: "800", fontSize: "88px", color: "#fff", textShadow: "0 4px 0 rgba(0,0,0,0.15)" }}>₦</span>
                <div style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontFamily: SORA, fontWeight: "700", fontSize: "30px", letterSpacing: "-0.04em" }}>PAJ Cash</span>
                  <span style={{ fontFamily: MONO, fontSize: "13px", color: "#8A8893" }}>NGN</span>
                </div>
              </div>
            )}
          </div>
          <div style={{ borderRadius: "40px", background: "radial-gradient(60% 80% at 90% 10%,rgba(255,90,26,0.16),rgba(255,90,26,0) 70%),#0F0F13", border: "1px solid rgba(255,255,255,0.07)", padding: "clamp(28px,4vw,64px)", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", gap: "48px", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
              <span style={{ fontFamily: MONO, fontSize: "14px", letterSpacing: "0.2em", color: "#FF6A2A" }}>OR KEEP IT CRYPTO</span>
              <h3 style={{ margin: "0", fontFamily: SORA, fontWeight: "700", fontSize: "clamp(42px,5vw,80px)", lineHeight: "0.98", letterSpacing: "-0.06em" }}>
                <span style={{ display: "block" }}>USDC or</span>
                <span style={{ display: "block" }}>any token.</span>
                <span style={{ display: "block", color: "#66646E" }}>150+ of them.</span>
              </h3>
              <p style={{ margin: "0", maxWidth: "460px", fontSize: "18px", lineHeight: "1.6", color: "#A9A7B0" }}>USDC, SOL, ETH, BTC, and every major asset across Solana, Base, Arbitrum, Ethereum and more.</p>
              <div style={{ display: "flex" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 20px", borderRadius: "999px", background: "#17171C", border: "1px solid rgba(255,255,255,0.1)", fontSize: "15px" }}>
                  <span style={{ fontFamily: MONO, fontSize: "12px", letterSpacing: "0.16em", color: "#FF6A2A" }}>ANY CHAIN VIA</span>
                  NEAR Intents
                </span>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: "16px" }}>
              {(v.tokens || []).map((t, $index) => (<React.Fragment key={$index}>
                <div onPointerMove={v.tilt} onPointerLeave={v.untilt} style={{ borderRadius: "28px", background: t.glow, border: "1px solid rgba(255,255,255,0.07)", padding: "30px 16px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: "18px", transition: "transform .3s ease-out" }}>
                  <span data-float="" style={{ position: "relative", width: "96px", height: "96px", borderRadius: "50%", backgroundImage: t.bg, backgroundSize: "cover", boxShadow: "0 7px 0 rgba(0,0,0,0.45),0 24px 40px rgba(0,0,0,0.5)" }}>
                    <span style={{ position: "absolute", inset: "0", borderRadius: "50%", background: "radial-gradient(circle at 32% 24%,rgba(255,255,255,0.55),rgba(255,255,255,0) 32%),radial-gradient(circle at 50% 120%,rgba(0,0,0,0.35),rgba(0,0,0,0) 60%)", boxShadow: "inset 0 -6px 10px rgba(0,0,0,0.25)" }}></span>
                  </span>
                  <span style={{ fontFamily: SORA, fontWeight: "700", fontSize: "24px", letterSpacing: "-0.03em" }}>{t.sym}</span>
                </div>
              </React.Fragment>))}
            </div>
          </div>
        </div>
      </section>
      <section id="giveaways" data-screen-label="Giveaways" style={{ padding: "0 clamp(20px,4vw,64px) clamp(100px,10vw,160px)" }}>
        <div style={{ maxWidth: "1440px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "56px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", gap: "24px 48px", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
              <span style={{ fontFamily: MONO, fontSize: "14px", letterSpacing: "0.2em", color: "#FF6A2A" }}>GIVEAWAYS</span>
              <h2 style={{ margin: "0", fontFamily: SORA, fontWeight: "700", fontSize: "clamp(46px,5.6vw,96px)", lineHeight: "0.98", letterSpacing: "-0.06em" }}>
                <span style={{ display: "block" }}>Grow your community</span>
                <span style={{ display: "block", color: "#66646E" }}>with a giveaway.</span>
              </h2>
              <p style={{ margin: "0", maxWidth: "480px", fontSize: "18px", lineHeight: "1.6", color: "#A9A7B0", textWrap: "pretty" }}>Fund a prize, share one link, let people enter. The draw is on-chain and the prize is already in escrow. Nothing to manually pay out, nothing to argue about after.</p>
              <div style={{ display: "flex" }}>
                <a href="/rewards-rail" style={{ padding: "18px 30px", borderRadius: "999px", background: "linear-gradient(90deg,#FF2D0A,#F5B70C)", color: "#fff", fontFamily: SORA, fontWeight: "600", fontSize: "17px", boxShadow: "0 14px 40px rgba(255,70,10,0.35)" }}>Launch a giveaway</a>
              </div>
            </div>
            <div style={{ position: "relative", width: "100%", height: "clamp(380px,36vw,540px)" }}>
              <div style={{ position: "absolute", inset: "10% 5%", background: "radial-gradient(closest-side,rgba(255,80,20,0.22),rgba(255,80,20,0))", pointerEvents: "none" }}></div>
              {/* Mobile / reduced-motion: static gift. Desktop mounts WebGL into the ref below. */}
              {v.lite ? (
                <div className="lh-gift-static" aria-hidden style={{ position: "absolute", inset: "0", display: "grid", placeItems: "center", pointerEvents: "none" }}>
                  <div style={{ width: "min(52%,220px)", aspectRatio: "1", borderRadius: "28%", background: "radial-gradient(120% 120% at 28% 18%,#FFC79A 0%,#FF5A1A 45%,#D23806 100%)", boxShadow: "inset 0 6px 10px rgba(255,255,255,0.45),inset 0 -10px 18px rgba(0,0,0,0.28),0 14px 0 #9C2802,0 36px 60px rgba(255,70,10,0.35)", display: "grid", placeItems: "center", transform: "rotate(-6deg)" }}>
                    <svg width="42%" height="42%" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="8" width="18" height="13" rx="2" />
                      <path d="M12 8v13M3 12h18" />
                      <path d="M12 8c-1.5-3-4-4-6-3.5S4 8 6.5 9.5 12 8 12 8zM12 8c1.5-3 4-4 6-3.5S20 8 17.5 9.5 12 8 12 8z" />
                    </svg>
                  </div>
                </div>
              ) : (
                <div ref={v.heroRef} title="Click to open" style={{ position: "absolute", inset: "0", cursor: "pointer" }}></div>
              )}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))", gap: "20px" }}>
            <div onPointerMove={v.tilt} onPointerLeave={v.untilt} style={{ borderRadius: "32px", background: "radial-gradient(80% 60% at 30% 25%,rgba(255,90,26,0.22),rgba(255,90,26,0) 70%),#0F0F13", border: "1px solid rgba(255,255,255,0.07)", padding: "40px", display: "flex", flexDirection: "column", gap: "18px", minHeight: "380px", transition: "transform .3s ease-out" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <span data-float="" style={{ width: "96px", height: "96px", borderRadius: "30px", transform: "rotate(-6deg)", background: "radial-gradient(120% 120% at 28% 18%,#FFC79A 0%,#FF5A1A 45%,#D23806 100%)", boxShadow: "inset 0 4px 6px rgba(255,255,255,0.5),inset 0 -6px 12px rgba(0,0,0,0.25),0 8px 0 #9C2802,0 24px 40px rgba(255,70,10,0.35)", display: "grid", placeItems: "center" }}>
                  <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4.5" y="11" width="15" height="10" rx="2.5"></rect>
                    <path d="M8 11V8a4 4 0 0 1 8 0v3"></path>
                  </svg>
                </span>
                <span style={{ fontFamily: MONO, fontSize: "14px", color: "#6E6C78" }}>01</span>
              </div>
              <div style={{ flex: "1" }}></div>
              <h3 style={{ margin: "0", fontFamily: SORA, fontWeight: "700", fontSize: "32px", letterSpacing: "-0.04em" }}>Escrow-funded</h3>
              <p style={{ margin: "0", fontSize: "17px", lineHeight: "1.55", color: "#A9A7B0" }}>Prize sits in escrow the moment you launch it, nothing to trust after that.</p>
            </div>
            <div onPointerMove={v.tilt} onPointerLeave={v.untilt} style={{ borderRadius: "32px", background: "radial-gradient(80% 60% at 30% 25%,rgba(245,183,12,0.18),rgba(245,183,12,0) 70%),#0F0F13", border: "1px solid rgba(255,255,255,0.07)", padding: "40px", display: "flex", flexDirection: "column", gap: "18px", minHeight: "380px", transition: "transform .3s ease-out" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <span data-float="" style={{ width: "96px", height: "96px", borderRadius: "30px", transform: "rotate(5deg)", background: "radial-gradient(120% 120% at 28% 18%,#FFE9A8 0%,#F5B70C 45%,#C98A04 100%)", boxShadow: "inset 0 4px 6px rgba(255,255,255,0.6),inset 0 -6px 12px rgba(0,0,0,0.2),0 8px 0 #8E6002,0 24px 40px rgba(245,183,12,0.3)", display: "grid", placeItems: "center" }}>
                  <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#3A2400" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="4" width="16" height="16" rx="4"></rect>
                    <circle cx="9" cy="9" r="0.6" fill="#3A2400"></circle>
                    <circle cx="15" cy="15" r="0.6" fill="#3A2400"></circle>
                    <circle cx="15" cy="9" r="0.6" fill="#3A2400"></circle>
                    <circle cx="9" cy="15" r="0.6" fill="#3A2400"></circle>
                  </svg>
                </span>
                <span style={{ fontFamily: MONO, fontSize: "14px", color: "#6E6C78" }}>02</span>
              </div>
              <div style={{ flex: "1" }}></div>
              <h3 style={{ margin: "0", fontFamily: SORA, fontWeight: "700", fontSize: "32px", letterSpacing: "-0.04em" }}>Winners paid automatically</h3>
              <p style={{ margin: "0", fontSize: "17px", lineHeight: "1.55", color: "#A9A7B0" }}>Drawn on-chain and paid straight from escrow, nothing to send manually.</p>
            </div>
            <div onPointerMove={v.tilt} onPointerLeave={v.untilt} style={{ borderRadius: "32px", background: "radial-gradient(80% 60% at 30% 25%,rgba(255,255,255,0.1),rgba(255,255,255,0) 70%),#0F0F13", border: "1px solid rgba(255,255,255,0.07)", padding: "40px", display: "flex", flexDirection: "column", gap: "18px", minHeight: "380px", transition: "transform .3s ease-out" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <span data-float="" style={{ width: "96px", height: "96px", borderRadius: "30px", transform: "rotate(-4deg)", background: "radial-gradient(120% 120% at 28% 18%,#FFFFFF 0%,#ECEAF0 45%,#BDBAC6 100%)", boxShadow: "inset 0 4px 6px rgba(255,255,255,0.9),inset 0 -6px 12px rgba(0,0,0,0.16),0 8px 0 #8C8898,0 24px 40px rgba(255,90,26,0.25)", display: "grid", placeItems: "center" }}>
                  <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#16161C" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="8" width="18" height="4" rx="1"></rect>
                    <path d="M5 12v9h14v-9M12 8v13M12 8S10.5 3 8 4.5 9 8 12 8zm0 0s1.5-5 4-3.5S15 8 12 8z"></path>
                  </svg>
                </span>
                <span style={{ fontFamily: MONO, fontSize: "14px", color: "#6E6C78" }}>03</span>
              </div>
              <div style={{ flex: "1" }}></div>
              <h3 style={{ margin: "0", fontFamily: SORA, fontWeight: "700", fontSize: "32px", letterSpacing: "-0.04em" }}>Easy to list</h3>
              <p style={{ margin: "0", fontSize: "17px", lineHeight: "1.55", color: "#A9A7B0" }}>Live in minutes, no code required.</p>
            </div>
          </div>
        </div>
      </section>
      <section id="how" data-screen-label="How it works" style={{ padding: "0 clamp(20px,4vw,64px) clamp(100px,10vw,160px)" }}>
        <div style={{ maxWidth: "1440px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "56px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <span style={{ fontFamily: MONO, fontSize: "14px", letterSpacing: "0.2em", color: "#FF6A2A" }}>HOW IT WORKS</span>
            <h2 style={{ margin: "0", fontFamily: SORA, fontWeight: "700", fontSize: "clamp(46px,6.4vw,104px)", lineHeight: "0.98", letterSpacing: "-0.06em" }}>
              <span style={{ display: "block" }}>Three taps,</span>
              <span style={{ display: "block", color: "#66646E" }}>done.</span>
            </h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))", gap: "20px" }}>
            <div onPointerMove={v.tilt} onPointerLeave={v.untilt} style={{ borderRadius: "32px", background: "#0F0F13", border: "1px solid rgba(255,255,255,0.07)", padding: "40px", display: "flex", flexDirection: "column", gap: "14px", transition: "transform .3s ease-out" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
                <span data-float="" style={{ width: "88px", height: "88px", borderRadius: "28px", transform: "rotate(-6deg)", background: "radial-gradient(120% 120% at 28% 18%,#FFFFFF 0%,#ECEAF0 45%,#BDBAC6 100%)", boxShadow: "inset 0 4px 6px rgba(255,255,255,0.9),inset 0 -6px 12px rgba(0,0,0,0.16),0 7px 0 #8C8898,0 24px 44px rgba(255,90,26,0.28)", display: "grid", placeItems: "center" }}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#16161C" strokeWidth="2.4" strokeLinecap="round">
                    <circle cx="12" cy="12" r="4"></circle>
                    <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"></path>
                  </svg>
                </span>
                <span style={{ fontFamily: MONO, fontSize: "14px", color: "#6E6C78" }}>01</span>
              </div>
              <h3 style={{ margin: "0", fontFamily: SORA, fontWeight: "700", fontSize: "30px", lineHeight: "1.1", letterSpacing: "-0.04em" }}>Type an email or @handle</h3>
              <p style={{ margin: "0", fontSize: "17px", lineHeight: "1.6", color: "#A9A7B0" }}>Or a Solana wallet. No sign-in needed, just connect your wallet and pay.</p>
            </div>
            <div onPointerMove={v.tilt} onPointerLeave={v.untilt} style={{ borderRadius: "32px", background: "#0F0F13", border: "1px solid rgba(255,255,255,0.07)", padding: "40px", display: "flex", flexDirection: "column", gap: "14px", transition: "transform .3s ease-out" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
                <span data-float="" style={{ width: "88px", height: "88px", borderRadius: "28px", transform: "rotate(5deg)", background: "radial-gradient(120% 120% at 28% 18%,#FFFFFF 0%,#ECEAF0 45%,#BDBAC6 100%)", boxShadow: "inset 0 4px 6px rgba(255,255,255,0.9),inset 0 -6px 12px rgba(0,0,0,0.16),0 7px 0 #8C8898,0 24px 44px rgba(255,90,26,0.28)", display: "grid", placeItems: "center" }}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#16161C" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"></path>
                    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"></path>
                  </svg>
                </span>
                <span style={{ fontFamily: MONO, fontSize: "14px", color: "#6E6C78" }}>02</span>
              </div>
              <h3 style={{ margin: "0", fontFamily: SORA, fontWeight: "700", fontSize: "30px", lineHeight: "1.1", letterSpacing: "-0.04em" }}>They get a claim link</h3>
              <p style={{ margin: "0", fontSize: "17px", lineHeight: "1.6", color: "#A9A7B0" }}>Sent instantly by email or DM. Recipients don't need an account yet.</p>
            </div>
            <div onPointerMove={v.tilt} onPointerLeave={v.untilt} style={{ borderRadius: "32px", background: "#0F0F13", border: "1px solid rgba(255,255,255,0.07)", padding: "40px", display: "flex", flexDirection: "column", gap: "14px", transition: "transform .3s ease-out" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "28px" }}>
                <span data-float="" style={{ width: "88px", height: "88px", borderRadius: "28px", transform: "rotate(-3deg)", background: "radial-gradient(120% 120% at 28% 18%,#FFC79A 0%,#FF5A1A 45%,#D23806 100%)", boxShadow: "inset 0 4px 6px rgba(255,255,255,0.5),inset 0 -6px 12px rgba(0,0,0,0.25),0 7px 0 #9C2802,0 24px 44px rgba(255,70,10,0.35)", display: "grid", placeItems: "center" }}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9"></circle>
                    <path d="m8 12 3 3 5-6"></path>
                  </svg>
                </span>
                <span style={{ fontFamily: MONO, fontSize: "14px", color: "#6E6C78" }}>03</span>
              </div>
              <h3 style={{ margin: "0", fontFamily: SORA, fontWeight: "700", fontSize: "30px", lineHeight: "1.1", letterSpacing: "-0.04em" }}>Claim in crypto or cash</h3>
              <p style={{ margin: "0", fontSize: "17px", lineHeight: "1.6", color: "#A9A7B0" }}>{PAJ_CASH_ENABLED ? 'USDC, any crypto, or cash to Venmo, Cash App, Revolut, Zelle, or PAJ Cash.' : 'USDC, any crypto, or cash to Venmo, Cash App, Revolut, or Zelle.'}</p>
            </div>
          </div>
        </div>
      </section>
      <section id="business" data-screen-label="Business" style={{ padding: "0 clamp(20px,4vw,64px) clamp(100px,10vw,160px)" }}>
        <div style={{ maxWidth: "1440px", margin: "0 auto", borderRadius: "40px", background: "#0F0F13", border: "1px solid rgba(255,255,255,0.07)", padding: "clamp(32px,5vw,80px)", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,440px),1fr))", gap: "48px", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
            <span style={{ fontFamily: MONO, fontSize: "14px", letterSpacing: "0.2em", color: "#FF6A2A" }}>FOR BUSINESS</span>
            <h2 style={{ margin: "0", fontFamily: SORA, fontWeight: "700", fontSize: "clamp(40px,4.6vw,72px)", lineHeight: "1", letterSpacing: "-0.055em" }}>
              <span style={{ display: "block" }}>Onboard the next generation</span>
              <span style={{ display: "block", color: "#66646E" }}>of crypto users.</span>
            </h2>
            <p style={{ margin: "0", fontSize: "18px", lineHeight: "1.6", color: "#A9A7B0", textWrap: "pretty" }}>Integrate Loofta and let anyone pay or get paid with nothing but an email, no wallet setup, no drop-off. One SDK, and your users are live.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "16px", fontWeight: "600", color: "#D9D6DE" }}>
              <span>Payouts to email, social handle, wallet, or cash</span>
              <span>150+ settlement tokens with automatic swaps</span>
              <span>{"Drop-in SDK & hosted checkout, live in a day"}</span>
            </div>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              <a href="/partners" style={{ padding: "18px 30px", borderRadius: "999px", background: "#F2EFE8", color: "#0B0B10", fontFamily: SORA, fontWeight: "600", fontSize: "17px" }}>Talk to sales</a>
              <a href="/docs" style={{ padding: "18px 30px", borderRadius: "999px", background: "#17171C", border: "1px solid rgba(255,255,255,0.1)", fontFamily: SORA, fontWeight: "600", fontSize: "17px" }}>Read more</a>
            </div>
          </div>
          <div onPointerMove={v.tilt} onPointerLeave={v.untilt} style={{ borderRadius: "28px", background: "#0A0A0D", border: "1px solid rgba(255,255,255,0.08)", padding: "28px 32px 34px", boxShadow: "0 40px 80px rgba(0,0,0,0.5),0 0 80px rgba(255,74,18,0.12)", fontFamily: MONO, fontSize: "15px", lineHeight: "1.9", overflowX: "auto", transition: "transform .3s ease-out" }}>
            <div style={{ color: "#6E6C78" }}>// send with just an email</div>
            <div>
              <span style={{ color: "#F5B70C" }}>await</span>
              {" loofta."}
              <span style={{ color: "#FF8A4A" }}>send</span>
              {"({"}
            </div>
            <div style={{ paddingLeft: "20px" }}>
              {"to: "}
              <span style={{ color: "#86EFAC" }}>"satoshi@gmail.com"</span>
              ,
            </div>
            <div style={{ paddingLeft: "20px" }}>
              {"amount: "}
              <span style={{ color: "#FF8A4A" }}>50</span>
              ,
            </div>
            <div style={{ paddingLeft: "20px" }}>
              {"token: "}
              <span style={{ color: "#86EFAC" }}>"USDC"</span>
              ,
            </div>
            <div style={{ paddingLeft: "20px" }}>
              {"rewards: "}
              <span style={{ color: "#FF8A4A" }}>true</span>
            </div>
            <div>{"});"}</div>
            <div style={{ color: "#6E6C78", marginTop: "16px" }}>{"// -> recipient claims, no wallet needed"}</div>
          </div>
        </div>
      </section>
      <section id="megapot" data-screen-label="Megapot" style={{ padding: "0 clamp(20px,4vw,64px) clamp(100px,10vw,160px)" }}>
        <div style={{ maxWidth: "1440px", margin: "0 auto", borderRadius: "40px", background: "radial-gradient(50% 90% at 15% 50%,rgba(245,183,12,0.2),rgba(245,183,12,0) 70%),#0F0F13", border: "1px solid rgba(255,255,255,0.07)", padding: "clamp(32px,5vw,72px)", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,360px),1fr))", gap: "48px", alignItems: "center" }}>
          <div style={{ display: "grid", placeItems: "center", minHeight: "300px" }}>
            <span data-float="" style={{ width: "200px", height: "200px", borderRadius: "60px", transform: "rotate(-8deg)", background: "radial-gradient(120% 120% at 28% 18%,#FFF0B8 0%,#F5B70C 42%,#D17A04 100%)", boxShadow: "inset 0 8px 12px rgba(255,255,255,0.6),inset 0 -14px 24px rgba(120,60,0,0.35),0 16px 0 #8E5202,0 50px 80px rgba(245,150,12,0.35)", display: "grid", placeItems: "center" }}>
              <svg width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="#5A3200" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"></path>
              </svg>
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
            <span style={{ fontFamily: MONO, fontSize: "14px", letterSpacing: "0.2em", color: "#F5B70C" }}>REWARDS · MEGAPOT</span>
            <h2 style={{ margin: "0", fontFamily: SORA, fontWeight: "700", fontSize: "clamp(44px,5.4vw,88px)", lineHeight: "0.98", letterSpacing: "-0.06em" }}>
              <span style={{ display: "block" }}>A jackpot,</span>
              <span style={{ display: "block", color: "#66646E" }}>drawn every day.</span>
            </h2>
            <p style={{ margin: "0", maxWidth: "480px", fontSize: "18px", lineHeight: "1.6", color: "#A9A7B0" }}>Loofta is plugged into Megapot's daily prize pool. Enter from your Loofta wallet and the draw settles on-chain every day.</p>
            <div style={{ display: "flex", gap: "40px", flexWrap: "wrap", paddingTop: "6px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontFamily: MONO, fontSize: "12px", letterSpacing: "0.16em", color: "#8A8893" }}>TODAY'S JACKPOT</span>
                <span style={{ fontFamily: SORA, fontWeight: "700", fontSize: "40px", letterSpacing: "-0.04em" }}>$1,000,000</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontFamily: MONO, fontSize: "12px", letterSpacing: "0.16em", color: "#8A8893" }}>NEXT DRAW</span>
                <span style={{ fontFamily: MONO, fontWeight: "500", fontSize: "36px" }}>{v.countdown}</span>
              </div>
            </div>
            <div style={{ display: "flex" }}>
              <a href="/app/rewards/megapot" style={{ padding: "18px 30px", borderRadius: "999px", background: "linear-gradient(90deg,#FF2D0A,#F5B70C)", color: "#fff", fontFamily: SORA, fontWeight: "600", fontSize: "17px", boxShadow: "0 14px 40px rgba(255,70,10,0.35)" }}>Enter today's draw</a>
            </div>
          </div>
        </div>
      </section>
      <footer style={{ padding: "40px clamp(20px,4vw,64px) 60px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "20px", flexWrap: "wrap", borderTop: "1px solid rgba(255,255,255,0.07)", color: "#8A8893", fontSize: "14px" }}>
        <img src="/loofta_white.svg" alt="loofta" style={{ height: "24px", opacity: "0.8" }} />
        <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
          <a href="/docs" style={{ color: "#8A8893" }}>Docs</a>
          <a href="https://twitter.com/looftapay" target="_blank" rel="noopener noreferrer" style={{ color: "#8A8893" }}>Twitter</a>
          <a href="https://t.me/looftapay" target="_blank" rel="noopener noreferrer" style={{ color: "#8A8893" }}>Telegram</a>
          <a href="/terms" style={{ color: "#8A8893" }}>Terms</a>
          <a href="/privacy" style={{ color: "#8A8893" }}>Privacy</a>
        </div>
        <span>© 2026 Loofta. All rights reserved.</span>
      </footer>
    </div>
    );
  }
}
