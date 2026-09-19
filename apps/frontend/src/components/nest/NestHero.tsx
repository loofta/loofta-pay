"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { packEggPositions } from "@/components/nest/nestEggPacking";

export type NestStock = {
  ticker: string;      // "MSFTx"
  domain: string;      // favicon domain, e.g. "microsoft.com"
  weight: number;      // 0..1 — egg size
  price: string;       // "$512.40"
  change: string;      // "+15%"
  risk: "low" | "med" | "high"; // egg material
  color: number;       // hex, e.g. 0xaaa9a0
  position: [number, number, number];
  news?: boolean;      // event-hit: pulses, label always on
};

const DEFAULT_STOCK_DATA: Omit<NestStock, "position">[] = [
  { ticker: "MSFTx", domain: "microsoft.com", weight: 0.24, price: "$512.40", change: "+15%", risk: "low", color: 0xaaa9a0 },
  { ticker: "AAPLx", domain: "apple.com", weight: 0.20, price: "$228.50", change: "+8%", risk: "low", color: 0x8a97a0 },
  { ticker: "NVDAx", domain: "nvidia.com", weight: 0.18, price: "$188.10", change: "+4%", risk: "high", color: 0x66865f },
  { ticker: "HPEx", domain: "hpe.com", weight: 0.14, price: "$24.86", change: "+36%", risk: "med", color: 0x9d8056 },
  { ticker: "UNHx", domain: "unitedhealthgroup.com", weight: 0.13, price: "$402.30", change: "\u221220%", risk: "med", color: 0x9b746b },
  { ticker: "MRNAx", domain: "modernatx.com", weight: 0.11, price: "$61.22", change: "+61%", risk: "high", color: 0x7d927f, news: true },
];

const DEFAULT_POSITIONS = packEggPositions(DEFAULT_STOCK_DATA.map(s => s.weight));

export const DEFAULT_STOCKS: NestStock[] = DEFAULT_STOCK_DATA.map((s, i) => ({ ...s, position: DEFAULT_POSITIONS[i] }));

export default function NestHero({ stocks = DEFAULT_STOCKS, height = 470, labelScale = 1 }: { stocks?: NestStock[]; height?: number; labelScale?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current!, canvas = canvasRef.current!;
    let raf = 0, disposed = false;
    let seed = 821731;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const range = (a: number, b: number) => a + (b - a) * rnd();

    // On a narrow (phone) column a fixed-height canvas is mostly empty space above and below the
    // nest, because fitCamera dollies out to keep it in frame. Cap the height to the design
    // aspect (620/470) instead so the nest fills the frame; the wrapper div follows suit.
    const heightFor = (width: number) => Math.min(height, Math.round(width / (620 / 470)));
    const w = wrap.clientWidth, h = heightFor(w);
    wrap.style.height = `${h}px`;
    // Camera framing was tuned for the kit's ~1.3 (620/470) desktop aspect ratio. On mobile,
    // .ns-hero collapses to a single narrow column, so the raw width/height ratio drops well
    // below that (often <0.9) — with a fixed FOV, a narrower aspect shrinks the horizontal
    // frustum and crops the sides of the nest instead of just showing it smaller. Dolly the
    // camera back along its own vector (scaling both x/y/z together, so lookAt framing is
    // unaffected) whenever the live aspect is narrower than the design aspect, so the whole
    // nest stays in frame instead of getting visually cropped.
    const DESIGN_ASPECT = 620 / 470;
    const BASE_CAMERA_POS = new THREE.Vector3(0, 2.15, 6.9);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, w / h, 0.1, 100);
    const fitCamera = (width: number, heightPx: number) => {
      const aspect = width / heightPx;
      const dolly = aspect < DESIGN_ASPECT ? DESIGN_ASPECT / aspect : 1;
      camera.aspect = aspect;
      camera.position.copy(BASE_CAMERA_POS).multiplyScalar(dolly);
      camera.lookAt(0, 0.15, 0);
      camera.updateProjectionMatrix();
    };
    fitCamera(w, h);
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const twigs = [0x735b40, 0x8a704e, 0x624a35, 0x967955, 0x594431].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.92 }));
    const grass = [0x9d845b, 0xb39a6e, 0x7e6c4b, 0xc2aa78].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
    const tube = (points: THREE.Vector3[], r: number, mat: THREE.Material, seg = 4) => {
      const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.45);
      const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, r, seg, false), mat);
      m.castShadow = m.receiveShadow = true; return m;
    };
    const ring = (rx: number, rz: number, y: number, ph: number) => {
      const pts: THREE.Vector3[] = [], n = 22;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const wv = 1 + Math.sin(a * 3 + ph) * 0.045 + Math.sin(a * 7 - ph) * 0.018;
        pts.push(new THREE.Vector3(Math.cos(a) * rx * wv, y + Math.sin(a * 5 + ph) * 0.025, Math.sin(a) * rz * wv));
      }
      return pts;
    };

    const nest = new THREE.Group(); nest.position.set(0, 0.1, 0); scene.add(nest);
    for (let layer = 0; layer < 13; layer++) {
      const t = layer / 12, y = -0.72 + t * 1.12, rx = 1.88 - t * 0.24, rz = 1.34 - t * 0.14;
      for (let j = 0; j < 7; j++) nest.add(tube(ring(rx + range(-0.07, 0.07), rz + range(-0.06, 0.06), y, range(0, 6.28)), range(0.025, 0.048), twigs[Math.floor(rnd() * twigs.length)]));
    }
    for (let i = 0; i < 34; i++) {
      const a = range(0, Math.PI * 2), r = range(1.15, 1.85);
      const p1 = new THREE.Vector3(Math.cos(a) * r, -0.65 + range(0, 1.05), Math.sin(a) * r * 0.72);
      const p2 = new THREE.Vector3(Math.cos(a + range(0.35, 0.9)) * r * 0.8, -0.65 + range(0, 1.05), Math.sin(a + range(0.35, 0.9)) * r * 0.72);
      const mid = p1.clone().lerp(p2, 0.5); mid.y += range(-0.18, 0.18);
      nest.add(tube([p1, mid, p2], range(0.025, 0.05), twigs[Math.floor(rnd() * twigs.length)]));
    }
    for (let i = 0; i < 115; i++) {
      const a = range(0, Math.PI * 2), r = Math.sqrt(range(0.05, 1));
      const p1 = new THREE.Vector3(Math.cos(a) * r * 1.38, -0.02 + range(-0.08, 0.08), Math.sin(a) * r * 0.94);
      const p2 = p1.clone().multiply(new THREE.Vector3(range(1.03, 1.24), 1, range(1.03, 1.24))); p2.y += range(0.08, 0.48);
      const mid = p1.clone().lerp(p2, 0.5); mid.x += range(-0.08, 0.08); mid.z += range(-0.08, 0.08);
      nest.add(tube([p1, mid, p2], range(0.008, 0.018), grass[Math.floor(rnd() * grass.length)], 3));
    }
    // thetaLength used to stop well short of the south pole (0.72 rad), leaving the bowl's
    // underside open — a hollow ring you could see straight through instead of a solid cup.
    // Sweeping all the way to the pole (Math.PI - thetaStart) closes it there naturally, since
    // every longitude vertex collapses to one point at the pole — only the top stays open,
    // which is correct: that's where the eggs sit.
    const bowlThetaStart = 0.55;
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(1.25, 48, 24, 0, Math.PI * 2, bowlThetaStart, Math.PI - bowlThetaStart), new THREE.MeshStandardMaterial({ color: 0x8c6d49, roughness: 1 }));
    bowl.scale.set(1, 0.34, 0.77); bowl.position.y = -0.02; bowl.castShadow = true; nest.add(bowl);

    // Each egg gets the stock's logo + ticker baked into its own material as a real texture
    // (equirectangular, matching SphereGeometry's default UV layout) rather than a flat
    // camera-facing overlay — it's actual 3D surface detail: it curves with the egg, catches
    // the same lighting/shading as the rest of the material, and rotates with the egg instead
    // of always facing the viewer. Front-of-egg (+z, toward the camera at rest) is u≈0.25 on a
    // standard three.js UV sphere (phi=0 is -x, phi=π/2 is +z), so the badge is centered there.
    const eggTextures: THREE.CanvasTexture[] = [];
    const makeEggTexture = (baseColorHex: number, domain: string, ticker: string, weight: number) => {
      const w = 1024, h = 512;
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      const baseColor = `#${baseColorHex.toString(16).padStart(6, "0")}`;
      const cx = w * 0.25, cy = h * 0.5;
      // Small, no plate behind it — icon, ticker, weight stacked directly on the egg's own
      // color, the way a hand-written label sits right on an egg's shell (per reference image),
      // not a sticker glued on top of one.
      const iconSize = h * 0.19;
      const tickerPx = h * 0.125;
      const pctPx = h * 0.095;
      const gap = h * 0.025;
      const draw = (img: HTMLImageElement | null) => {
        ctx.fillStyle = baseColor;
        ctx.fillRect(0, 0, w, h);

        const totalH = iconSize + gap + tickerPx * 1.1 + gap * 0.7 + pctPx * 1.1;
        let y = cy - totalH / 2;

        if (img) {
          ctx.drawImage(img, cx - iconSize / 2, y, iconSize, iconSize);
        }
        y += iconSize + gap;

        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.shadowColor = "rgba(0,0,0,.35)";
        ctx.shadowBlur = 3;
        ctx.fillStyle = "#ffffff";
        ctx.font = `700 ${Math.round(tickerPx)}px 'Instrument Sans', sans-serif`;
        ctx.fillText(ticker, cx, y);
        y += tickerPx * 1.1 + gap * 0.7;

        ctx.globalAlpha = 0.88;
        ctx.font = `600 ${Math.round(pctPx)}px 'Instrument Sans', sans-serif`;
        ctx.fillText(`${(weight * 100).toFixed(1)}%`, cx, y);
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
      };
      draw(null);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => { draw(img); texture.needsUpdate = true; };
      img.onerror = () => console.warn(`NestHero: failed to load favicon for ${domain}`);
      // Google's favicon endpoint sends no CORS headers, so it's proxied through our own origin
      // (see api/nest/favicon/route.ts) — a direct crossOrigin="anonymous" fetch to it just fails
      // silently and this canvas would only ever show the ticker text, never the logo.
      img.src = `/api/nest/favicon?domain=${encodeURIComponent(domain)}`;
      return texture;
    };

    const eggGroup = new THREE.Group(); nest.add(eggGroup);
    const labels: { egg: THREE.Mesh; el: HTMLDivElement; news: boolean }[] = [];
    for (const s of stocks) {
      const sc = 0.62 + s.weight * 1.5;
      const eggTexture = makeEggTexture(s.color, s.domain, s.ticker, s.weight);
      eggTextures.push(eggTexture);
      const mat = new THREE.MeshPhysicalMaterial({
        map: eggTexture, color: 0xffffff, roughness: s.risk === "low" ? 0.14 : s.risk === "med" ? 0.3 : 0.5, metalness: 0.03,
        clearcoat: s.risk === "low" ? 0.9 : 0.4, clearcoatRoughness: 0.16,
        emissive: s.news ? 0x2f5540 : 0x000000, emissiveIntensity: 0,
      });
      const egg = new THREE.Mesh(new THREE.SphereGeometry(0.43, 48, 32), mat);
      egg.scale.set(0.88 * sc, 1.16 * sc, 0.88 * sc);
      egg.position.set(...s.position); egg.rotation.z = range(-0.12, 0.12);
      egg.castShadow = egg.receiveShadow = true;
      // The "pull" axis: mostly straight up (lifting the egg out of the bowl), leaning slightly
      // outward for eggs that sit away from center — like plucking it out by hand rather than
      // sliding it sideways.
      const horizLen = Math.hypot(s.position[0], s.position[2]);
      const hx = horizLen > 1e-4 ? s.position[0] / horizLen : 0;
      const hz = horizLen > 1e-4 ? s.position[2] / horizLen : 0;
      const pullDir = new THREE.Vector3(hx * 0.35, 1, hz * 0.35).normalize();
      egg.userData = { baseY: s.position[1], restX: s.position[0], restZ: s.position[2], phase: range(0, 6.28), baseScale: sc, pullDir, pullAmount: 0 };
      eggGroup.add(egg);

      const el = document.createElement("div");
      el.className = "ns-label";
      el.style.fontSize = `${10 * labelScale}px`; el.style.opacity = "0";
      el.innerHTML = `<img src="https://www.google.com/s2/favicons?domain=${s.domain}&sz=64" alt="">${s.ticker} \u00b7 ${Math.round(s.weight * 100)}% \u00b7 ${s.price} \u00b7 ${s.change}`;
      wrap.appendChild(el); labels.push({ egg, el, news: !!s.news });
    }

    const leafMat = new THREE.MeshStandardMaterial({ color: 0x54765d, roughness: 0.8, side: THREE.DoubleSide });
    for (let i = 0; i < 14; i++) {
      const a = range(0, Math.PI * 2), r = range(1.65, 2.05);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.38, 5), new THREE.MeshStandardMaterial({ color: 0x63704f, roughness: 1 }));
      stem.position.set(Math.cos(a) * r, -0.02, Math.sin(a) * r * 0.72);
      stem.rotation.z = range(-0.45, 0.45); stem.rotation.x = range(-0.25, 0.25); nest.add(stem);
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), leafMat);
      leaf.scale.set(1.8, 0.45, 0.8);
      leaf.position.copy(stem.position).add(new THREE.Vector3(range(-0.12, 0.12), 0.18, range(-0.12, 0.12)));
      leaf.rotation.set(range(-0.5, 0.5), a, range(-0.5, 0.5)); nest.add(leaf);
    }

    scene.add(new THREE.HemisphereLight(0xfffdf7, 0x7c705e, 2.2));
    const key = new THREE.DirectionalLight(0xfffbef, 3.1); key.position.set(4, 6, 5);
    key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -4; key.shadow.camera.right = 4; key.shadow.camera.top = 4; key.shadow.camera.bottom = -4;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xddeee4, 1.2); rim.position.set(-4, 3, -3); scene.add(rim);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(4, 64), new THREE.ShadowMaterial({ opacity: 0.12 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(0, -1.25, 0); ground.receiveShadow = true; scene.add(ground);

    let px = 0, py = 0, dragY = 0, dragging = false, lastX = 0, hovered = -1;
    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
    // Clicking a specific egg lets you pull just that egg part-way out of the bowl along its own
    // fixed "pull axis" (mostly up, see pullDir above) instead of rotating the whole nest — it
    // springs back down to its packed (collision-free) rest position on release, so it reads as
    // a poke-able, slightly bouncy object rather than a permanent rearrangement.
    let draggedEgg: THREE.Mesh | null = null;
    const dragPlane = new THREE.Plane();
    const planeHit = new THREE.Vector3();
    const localHit = new THREE.Vector3();
    const deltaVec = new THREE.Vector3();
    const MAX_PULL = 0.45;

    const eggAt = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
      ray.setFromCamera(mouse, camera);
      const hits = ray.intersectObjects(eggGroup.children);
      return hits.length ? (hits[0].object as THREE.Mesh) : null;
    };
    const onDown = (e: PointerEvent) => {
      const hit = eggAt(e);
      canvas.setPointerCapture(e.pointerId);
      if (hit) {
        draggedEgg = hit;
        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);
        dragPlane.setFromNormalAndCoplanarPoint(camDir, hit.getWorldPosition(new THREE.Vector3()));
        canvas.style.cursor = "grabbing";
        return;
      }
      dragging = true; lastX = e.clientX;
    };
    const onUp = (e: PointerEvent) => { dragging = false; draggedEgg = null; canvas.releasePointerCapture(e.pointerId); };
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      px = (e.clientX - r.left) / r.width - 0.5; py = (e.clientY - r.top) / r.height - 0.5;

      if (draggedEgg) {
        mouse.set(px * 2, -py * 2);
        ray.setFromCamera(mouse, camera);
        if (ray.ray.intersectPlane(dragPlane, planeHit)) {
          eggGroup.worldToLocal(localHit.copy(planeHit));
          const ud = draggedEgg.userData as { restX: number; restZ: number; baseY: number; pullDir: THREE.Vector3 };
          deltaVec.set(localHit.x - ud.restX, localHit.y - ud.baseY, localHit.z - ud.restZ);
          // Only the component of the drag along the egg's own pull axis counts — dragging
          // sideways barely moves it, dragging up along that axis pulls it out. Clamped to
          // [0, MAX_PULL] so it can only come OUT of the nest, never push further in.
          const t = THREE.MathUtils.clamp(deltaVec.dot(ud.pullDir), 0, MAX_PULL);
          draggedEgg.userData.pullAmount = t;
        }
        return;
      }

      if (dragging) { dragY += (e.clientX - lastX) * 0.008; lastX = e.clientX; return; }
      mouse.set(px * 2, -py * 2); ray.setFromCamera(mouse, camera);
      const hits = ray.intersectObjects(eggGroup.children);
      hovered = hits.length ? eggGroup.children.indexOf(hits[0].object) : -1;
      canvas.style.cursor = hovered >= 0 ? "pointer" : "grab";
    };
    const onLeave = () => { px = 0; py = 0; hovered = -1; dragging = false; };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerleave", onLeave);

    const resizeObserver = new ResizeObserver(entries => {
      const cw = entries[0]?.contentRect.width;
      if (!cw || cw === renderer.domElement.clientWidth) return;
      const ch = heightFor(cw);
      wrap.style.height = `${ch}px`;
      fitCamera(cw, ch);
      renderer.setSize(cw, ch, false);
    });
    resizeObserver.observe(wrap);

    const v = new THREE.Vector3(); const clock = new THREE.Clock();
    const animate = () => {
      if (disposed) return;
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      nest.rotation.y = THREE.MathUtils.lerp(nest.rotation.y, dragY + (dragging ? 0 : px * 0.22 + Math.sin(t * 0.12) * 0.1), dragging ? 0.25 : 0.035);
      nest.rotation.x = THREE.MathUtils.lerp(nest.rotation.x, py * 0.07, 0.035);
      nest.position.y = 0.1 + Math.sin(t * 0.75) * 0.025;
      labels.forEach(({ egg, news }) => {
        const ud = egg.userData;
        if (egg !== draggedEgg) {
          ud.pullAmount = THREE.MathUtils.lerp(ud.pullAmount, 0, 0.1);
        }
        egg.position.x = ud.restX + ud.pullDir.x * ud.pullAmount;
        egg.position.z = ud.restZ + ud.pullDir.z * ud.pullAmount;
        egg.position.y = ud.baseY + Math.sin(t * 0.9 + ud.phase) * 0.025 + ud.pullDir.y * ud.pullAmount;
        if (news) {
          const pulse = (Math.sin(t * 2.4) + 1) / 2;
          (egg.material as THREE.MeshPhysicalMaterial).emissiveIntensity = 0.15 + pulse * 0.5;
          const s = egg.userData.baseScale * (1 + pulse * 0.05);
          egg.scale.set(0.88 * s, 1.16 * s, 0.88 * s);
        }
      });
      renderer.render(scene, camera);
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      labels.forEach(({ egg, el, news }, i) => {
        v.setFromMatrixPosition(egg.matrixWorld); v.y += 0.55 * egg.userData.baseScale + 0.25; v.project(camera);
        el.style.left = `${canvas.offsetLeft + (v.x * 0.5 + 0.5) * cw}px`;
        el.style.top = `${canvas.offsetTop + (-v.y * 0.5 + 0.5) * ch}px`;
        el.style.opacity = (i === hovered || (news && hovered < 0)) && v.z < 1 ? "1" : "0";
      });
    };
    animate();

    return () => {
      disposed = true; cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerleave", onLeave);
      labels.forEach(({ el }) => el.remove());
      eggTextures.forEach(t => t.dispose());
      scene.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => x.dispose());
      });
      renderer.dispose();
    };
  }, [stocks, height, labelScale]);

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", height }}>
      <canvas ref={canvasRef} width={620} height={height} style={{ width: "100%", height: "100%", touchAction: "pan-y" }} />
    </div>
  );
}
