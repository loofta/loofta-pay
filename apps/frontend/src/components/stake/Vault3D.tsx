"use client";

import { useEffect, useRef } from "react";

/** Orange clay vault with orbiting coins. three.js is loaded on demand so it never touches first paint. */
export function Vault3D() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const THREE = await import("three");
      const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
      const { RoundedBoxGeometry } = await import("three/examples/jsm/geometries/RoundedBoxGeometry.js");
      if (disposed || !el.isConnected) return;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      el.appendChild(renderer.domElement);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.85;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      Object.assign(renderer.domElement.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block" });

      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
      const key = new THREE.DirectionalLight(0xfff1e0, 2.6); key.position.set(3, 8, 5); key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 30 });
      key.shadow.radius = 6; key.shadow.bias = -0.0004; scene.add(key);
      const rim = new THREE.DirectionalLight(0xffb070, 1.8); rim.position.set(-3, 4, -7); scene.add(rim);
      const fill = new THREE.DirectionalLight(0xff7a3a, 1.2); fill.position.set(-5, 1, 2); scene.add(fill);

      const pcv = document.createElement("canvas"); pcv.width = pcv.height = 512;
      const pg = pcv.getContext("2d")!;
      pg.fillStyle = "#FF5A1A"; pg.fillRect(0, 0, 512, 512);
      const img = pg.getImageData(0, 0, 512, 512), px = img.data;
      for (let i = 0; i < px.length; i += 4) { const nz = (Math.random() - 0.5) * 14; px[i] += nz; px[i + 1] += nz * 0.6; px[i + 2] += nz * 0.4; }
      pg.putImageData(img, 0, 0);
      pg.fillStyle = "rgba(255,170,90,0.5)";
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { pg.beginPath(); pg.arc(32 + x * 64 + (y % 2) * 32, 32 + y * 64, 7, 0, 6.29); pg.fill(); }
      const paper = new THREE.CanvasTexture(pcv); paper.colorSpace = THREE.SRGBColorSpace; paper.anisotropy = 8;
      const clay = new THREE.MeshPhysicalMaterial({ map: paper, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.45, envMapIntensity: 0.7, sheen: 0.3, sheenColor: new THREE.Color(0xff9a5a) });
      const cream = new THREE.MeshPhysicalMaterial({ color: 0xf7e6cf, roughness: 0.3, sheen: 1, sheenRoughness: 0.25, sheenColor: new THREE.Color(0xffffff), clearcoat: 0.5, clearcoatRoughness: 0.2, envMapIntensity: 0.8 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x1a0c06, roughness: 0.7 });

      // Brand orange metal, never yellow.
      const cv = document.createElement("canvas"); cv.width = cv.height = 256;
      const g = cv.getContext("2d")!;
      const gr = g.createRadialGradient(100, 90, 10, 128, 128, 128);
      gr.addColorStop(0, "#FFC79A"); gr.addColorStop(0.6, "#FF6A24"); gr.addColorStop(1, "#C23A08");
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
      g.fillStyle = "#7A2204"; g.font = "800 160px Sora, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("$", 128, 136);
      const face = new THREE.CanvasTexture(cv); face.colorSpace = THREE.SRGBColorSpace;
      const metalSide = new THREE.MeshStandardMaterial({ color: 0xff7a2a, metalness: 1, roughness: 0.25 });
      const metalFace = new THREE.MeshStandardMaterial({ map: face, metalness: 0.75, roughness: 0.3 });

      const root = new THREE.Group(); scene.add(root);
      const body = new THREE.Group(); root.add(body);
      body.add(new THREE.Mesh(new RoundedBoxGeometry(2.4, 2.3, 1.8, 6, 0.34), clay));
      const door = new THREE.Mesh(new THREE.CylinderGeometry(0.84, 0.84, 0.16, 64), cream); door.rotation.x = Math.PI / 2; door.position.z = 0.92; body.add(door);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.06, 16, 80), metalSide); ring.position.z = 0.95; body.add(ring);
      const dial = new THREE.Group(); dial.position.z = 1.05; body.add(dial);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 48), metalSide); hub.rotation.x = Math.PI / 2; dial.add(hub);
      for (let i = 0; i < 3; i++) {
        const sp = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.09, 0.09, 2, 0.04), metalSide); sp.rotation.z = (i * Math.PI) / 3; dial.add(sp);
        [-1, 1].forEach((sx) => { const k = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 24), metalSide); k.position.set(Math.cos((i * Math.PI) / 3) * 0.5 * sx, Math.sin((i * Math.PI) / 3) * 0.5 * sx, 0); dial.add(k); });
      }
      const slot = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.1, 0.26, 2, 0.04), dark); slot.position.y = 1.13; body.add(slot);
      ([[-0.8, -0.55], [0.8, -0.55], [-0.8, 0.55], [0.8, 0.55]] as const).forEach(([x, z]) => { const f = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.24, 0.42, 3, 0.1), cream); f.position.set(x, -1.2, z); body.add(f); });

      const coinG = new THREE.CylinderGeometry(0.5, 0.5, 0.14, 64), rimG = new THREE.TorusGeometry(0.5, 0.05, 12, 72);
      const N = 8;
      const coins = Array.from({ length: N }, () => {
        const c = new THREE.Mesh(coinG, [metalSide, metalFace, metalFace]);
        const rm = new THREE.Mesh(rimG, metalSide); rm.rotation.x = Math.PI / 2; c.add(rm);
        c.rotation.order = "YXZ"; c.scale.setScalar(0.5); root.add(c); return c;
      });

      const SP = 70, spos = new Float32Array(SP * 3);
      const seeds = Array.from({ length: SP }, () => [Math.random() * 6.28, 1.6 + Math.random() * 1.4, Math.random(), 0.3 + Math.random() * 0.7]);
      const sparkG = new THREE.BufferGeometry(); sparkG.setAttribute("position", new THREE.BufferAttribute(spos, 3));
      root.add(new THREE.Points(sparkG, new THREE.PointsMaterial({ color: 0xffd49a, size: 0.05, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })));
      root.traverse((o: any) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ color: 0x1a0600, opacity: 0.5 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -1.5; ground.receiveShadow = true; scene.add(ground);

      let lw = 0, lh = 0;
      const fit = () => {
        const w = el.clientWidth, h = el.clientHeight;
        if (w < 2 || h < 2) return;
        lw = w; lh = h;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        const z = w / h < 1.1 ? (10.5 * 1.1) / (w / h) : 10.5;
        camera.position.set(0, 2.6, z); camera.lookAt(0, 0.2, 0); camera.updateProjectionMatrix();
      };
      const ro = new ResizeObserver(fit); ro.observe(el); fit();

      let px0: number | null = null, py0 = 0;
      const onMove = (e: PointerEvent) => { px0 = e.clientX; py0 = e.clientY; };
      window.addEventListener("pointermove", onMove);

      let visible = true;
      const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0 });
      io.observe(el);

      let t = 0, ry = -0.4, rx = 0.06, dialSpin = 0, raf = 0;
      const clock = new THREE.Clock();
      const tick = () => {
        raf = requestAnimationFrame(tick);
        const dt = Math.min(clock.getDelta(), 0.05);
        if (!visible) return;
        t += dt;
        if (el.clientWidth !== lw || el.clientHeight !== lh) fit();
        let mx = 0, my = 0;
        if (px0 !== null) {
          const r = el.getBoundingClientRect();
          mx = Math.max(-1, Math.min(1, ((px0 - r.left) / r.width) * 2 - 1));
          my = Math.max(-1, Math.min(1, ((py0 - r.top) / r.height) * 2 - 1));
        }
        ry += (-0.42 + mx * 0.4 + Math.sin(t * 0.4) * 0.08 - ry) * 0.05;
        rx += (0.05 + my * 0.08 - rx) * 0.05;
        root.rotation.set(rx, ry, 0);
        root.position.y = Math.sin(t * 1.3) * 0.07;
        dialSpin += dt * 0.5; dial.rotation.z = dialSpin;
        coins.forEach((c, i) => {
          const a = (i / N) * Math.PI * 2 + t * 0.3;
          c.position.set(Math.cos(a) * 2.35, 0.1 - Math.sin(a) * 0.3 + Math.sin(t * 1.6 + i) * 0.12, Math.sin(a) * 2.35);
          c.rotation.set(Math.PI / 2, t * 1.3 + i, 0);
        });
        for (let i = 0; i < SP; i++) {
          const q = seeds[i], k = (q[2] + t * 0.08 * q[3]) % 1, a = q[0] + t * 0.15;
          spos[i * 3] = Math.cos(a) * q[1]; spos[i * 3 + 1] = -1.2 + k * 3.4; spos[i * 3 + 2] = Math.sin(a) * q[1];
        }
        sparkG.attributes.position.needsUpdate = true;
        renderer.render(scene, camera);
      };
      tick();

      cleanup = () => {
        cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
        window.removeEventListener("pointermove", onMove);
        scene.traverse((o: any) => { o.geometry?.dispose?.(); });
        renderer.dispose(); renderer.domElement.remove();
      };
    })().catch(() => { /* WebGL unavailable: the glow behind stays, page still works */ });

    return () => { disposed = true; cleanup(); };
  }, []);

  return <div ref={ref} aria-hidden style={{ position: "absolute", inset: 0 }} />;
}
