/**
 * Real 3D Mystery Pack for React Native — an actual WebGL scene (expo-gl) rendered with the same
 * three.js engine the desktop version uses, not a perspective-transform approximation. Ported
 * directly from apps/frontend's MegapotPack.tsx: the pouch geometry displacement, PBR foil
 * materials, PMREM environment lighting, and the idle→shake→tear→reveal animation state machine
 * are plain Three.js object-graph code with zero DOM dependency, so they carry over almost
 * verbatim. Three things genuinely don't exist in RN and were replaced:
 *   - Canvas 2D texture generation → react-native-skia rasterizes the same foil/ticket art
 *     instead (see lib/megapotPackTextures.tsx).
 *   - OrbitControls (DOM pointer events) → a manual PanResponder drives camera azimuth/polar.
 *   - ResizeObserver/Image()/document.visibilitychange → RN's useWindowDimensions/AppState.
 *
 * First-pass simplifications (revisit once confirmed working on-device): no custom Clash
 * Display/Grotesk typeface in the baked textures (system default font), no crinkle bump map, no
 * reactive quality-tier ladder (always renders at full quality), no sound effects.
 */
import { useCallback, useEffect, useRef } from 'react';
import { PanResponder, View, useWindowDimensions } from 'react-native';
import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { generatePackTexture, generateTicketTexture, generateEdgeTexture, ART_W } from '../lib/megapotPackTextures';
import type { PackOpenResult, PackRarity } from '../lib/api/pack';

const RARITY_HUES: Record<PackRarity, number[]> = {
  common: [220, 0, 45],
  uncommon: [160, 190, 45],
  rare: [270, 220, 45],
  epic: [45, 15, 330],
};

function makeDataTexture({ data, width, height }: { data: Uint8Array; width: number; height: number }): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = true;
  tex.needsUpdate = true;
  return tex;
}

interface Props {
  canOpen: boolean;
  resolveOpen: () => Promise<PackOpenResult>;
  onOpened: (result: PackOpenResult) => void;
  onError: (message: string) => void;
}

export default function MegapotPackGL({ canOpen, resolveOpen, onOpened, onError }: Props) {
  const { width: winW } = useWindowDimensions();
  const canOpenRef = useRef(canOpen);
  const resolveOpenRef = useRef(resolveOpen);
  const onOpenedRef = useRef(onOpened);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    canOpenRef.current = canOpen;
  }, [canOpen]);
  useEffect(() => {
    resolveOpenRef.current = resolveOpen;
  }, [resolveOpen]);
  useEffect(() => {
    onOpenedRef.current = onOpened;
  }, [onOpened]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // Camera orbit — azimuth/polar in radians, driven by drag deltas. Not React state: read/written
  // every frame from the render loop, same "avoid re-render churn for a continuous animation"
  // reasoning as the shared values in the Reanimated version.
  const azimuth = useRef(0);
  const polar = useRef(0.15);
  const dragStart = useRef({ x: 0, y: 0, t: 0, moved: false });

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        dragStart.current = { x: evt.nativeEvent.pageX, y: evt.nativeEvent.pageY, t: Date.now(), moved: false };
      },
      onPanResponderMove: (_evt, gesture) => {
        if (Math.abs(gesture.dx) + Math.abs(gesture.dy) > 6) dragStart.current.moved = true;
        azimuth.current -= gesture.vx * 0.04;
        polar.current = Math.max(-0.9, Math.min(0.9, polar.current - gesture.vy * 0.03));
      },
      onPanResponderRelease: () => {
        const elapsed = Date.now() - dragStart.current.t;
        if (!dragStart.current.moved && elapsed < 400) openRef.current();
      },
    }),
  ).current;

  // Re-assigned once the scene is built (onContextCreate) — the PanResponder above is created
  // once at mount, before the scene/open() closure exists.
  const openRef = useRef<() => void>(() => {});

  const onContextCreate = useCallback(async (gl: ExpoWebGLRenderingContext) => {
    const W = gl.drawingBufferWidth;
    const H = gl.drawingBufferHeight;

    // three.js's WebGLRenderer defaults `canvas` to `createCanvasElement()` (which calls
    // `document.createElementNS` — undefined in RN/Hermes) whenever `parameters.canvas` isn't
    // explicitly supplied, EVEN when `context` is given. This plain object satisfies what the
    // renderer actually touches (style, add/removeEventListener as no-ops, width/height) without
    // ever needing `document` — `updateStyle=false` in setSize below means `.style` is never
    // written to, so it never needs to be a real CSSStyleDeclaration either.
    const fakeCanvas = {
      width: W,
      height: H,
      style: {},
      addEventListener: () => {},
      removeEventListener: () => {},
      clientWidth: W,
      clientHeight: H,
    } as unknown as HTMLCanvasElement;

    const renderer = new THREE.WebGLRenderer({ canvas: fakeCanvas, context: gl as unknown as WebGLRenderingContext, antialias: true });
    // NOT setPixelRatio() here — gl.drawingBufferWidth/Height are already the physical pixel size
    // (expo-gl bakes the device's pixel ratio in), so calling setSize(W, H) after ALSO setting a
    // pixelRatio > 1 makes three.js think the framebuffer is W*ratio × H*ratio — much bigger than
    // the real drawing buffer, so only a corner of that oversized render actually lands on
    // screen. Leaving pixelRatio at its default (1) and passing the already-physical W/H directly
    // is the correct match for expo-gl.
    renderer.setSize(W, H, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 100);
    const target = new THREE.Vector3(0, 0.3, 0);
    const radius = 8.3;

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.add(new THREE.HemisphereLight(0xffe9d6, 0x120a06, 0.55));
    const key = new THREE.DirectionalLight(0xfff2e0, 3.1);
    key.position.set(3.4, 5, 4.6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff5a1e, 2.2);
    rim.position.set(-4.4, 1.6, -3.4);
    scene.add(rim);
    const fill = new THREE.PointLight(0xeab308, 26, 14);
    fill.position.set(0, -1.6, 3);
    scene.add(fill);
    const glowLight = new THREE.PointLight(0xffa03c, 0, 12);
    glowLight.position.set(0, 0.55, 1.2);
    scene.add(glowLight);

    // ---- geometry: pouch-shaped pack halves, same displacement math as the web version ----
    const PW = 2.32,
      PH = 3.6,
      PD = 0.4;
    function hash2(i: number, j: number) {
      const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
      return s - Math.floor(s);
    }
    function vnoise(x: number, y: number) {
      const i = Math.floor(x),
        j = Math.floor(y),
        fx = x - i,
        fy = y - j;
      const sx = fx * fx * (3 - 2 * fx),
        sy = fy * fy * (3 - 2 * fy);
      const a = hash2(i, j),
        b = hash2(i + 1, j),
        c = hash2(i, j + 1),
        d = hash2(i + 1, j + 1);
      const top = a + (b - a) * sx,
        bot = c + (d - c) * sx;
      return top + (bot - top) * sy;
    }
    function pouch(geo: THREE.BufferGeometry, part: 'top' | 'bot', amt = 0.006) {
      const p = geo.attributes.position,
        n = geo.attributes.normal;
      const hy = PH / 2,
        yOff = part === 'top' ? PH / 4 : -PH / 4;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i),
          y = p.getY(i),
          z = p.getZ(i);
        const u = Math.min(1, Math.abs(x) / (PW / 2));
        const v = Math.min(1, Math.abs(y + yOff) / hy);
        const prof = Math.max(0.3, Math.pow((1 - Math.pow(u, 4)) * (1 - Math.pow(v, 6)), 0.45));
        const w =
          (vnoise(x * 3.7 + 11.3, y * 3.1 + 5.9) - 0.5) * 2 +
          (vnoise(x * 8.3 - 3.1, y * 7.1 + 17.7) - 0.5) * 1.1 +
          (vnoise(x * 19.7 + 2.3, y * 16.1 - 8.9) - 0.5) * 0.45;
        const d = w * amt,
          seal = 1 - 0.055 * Math.pow(v, 6);
        p.setXYZ(i, x * seal + n.getX(i) * d, y + n.getY(i) * d, z * prof + n.getZ(i) * d * 1.7);
      }
      (p as THREE.BufferAttribute).needsUpdate = true;
      geo.computeVertexNormals();
      return geo;
    }

    // Sequential, NOT Promise.all — concurrent drawAsImage() calls appear to cross-contaminate
    // Skia's offscreen renderer (the pack mesh was showing the ticket's design, missing its own
    // text). One at a time is slower to start up but actually renders the right content.
    const packFront = await generatePackTexture('front');
    const packBack = await generatePackTexture('back');
    const ticketFront1 = await generateTicketTexture(1, 'front');
    const ticketBack = await generateTicketTexture(1, 'back');
    const edgeTex = await generateEdgeTexture();
    if (!mountedRef.current) return;

    const foilMat = (raw: { data: Uint8Array; width: number; height: number }) =>
      new THREE.MeshPhysicalMaterial({ map: makeDataTexture(raw), metalness: 0.42, roughness: 0.18, clearcoat: 0.85, clearcoatRoughness: 0.1, envMapIntensity: 1.3 });

    const packRig = new THREE.Group();
    packRig.position.y = 0.55;
    scene.add(packRig);
    const packGroup = new THREE.Group();
    packRig.add(packGroup);

    function makeHalf(part: 'top' | 'bot') {
      const hh = PH / 2;
      const geo = pouch(new THREE.BoxGeometry(PW, hh, PD, 40, 30, 3), part);
      const cut = new THREE.MeshPhysicalMaterial({ color: 0xc9410b, metalness: 0.2, roughness: 0.6 });
      const side = foilMat(edgeTex);
      const m = new THREE.Mesh(geo, [side, side, part === 'top' ? side : cut, part === 'top' ? cut : side, foilMat(packFront[part]), foilMat(packBack[part])]);
      m.position.y = part === 'top' ? hh / 2 : -hh / 2;
      return m;
    }
    const topHalf = makeHalf('top'),
      botHalf = makeHalf('bot');
    packGroup.add(topHalf, botHalf);

    const ticketGroup = new THREE.Group();
    ticketGroup.visible = false;
    scene.add(ticketGroup);
    const frontMat = new THREE.MeshPhysicalMaterial({ map: makeDataTexture(ticketFront1), roughness: 0.52, metalness: 0.05, clearcoat: 0.35 });
    const backMat = new THREE.MeshPhysicalMaterial({ map: makeDataTexture(ticketBack), roughness: 0.52, metalness: 0.05, clearcoat: 0.35 });
    const paperEdge = new THREE.MeshStandardMaterial({ color: 0xede6d6, roughness: 0.85 });
    const ticket = new THREE.Mesh(new THREE.BoxGeometry(2.1, 4.35, 0.045, 2, 2, 1), [paperEdge, paperEdge, paperEdge, paperEdge, frontMat, backMat]);
    ticketGroup.add(ticket);

    // ---- confetti ----
    const P = 150;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(P * 3),
      pCol = new Float32Array(P * 3);
    const pVel: THREE.Vector3[] = [];
    for (let i = 0; i < P; i++) {
      const a = Math.random() * Math.PI * 2,
        e = (Math.random() - 0.5) * 1.5,
        s = 0.06 + Math.random() * 0.13;
      pVel.push(new THREE.Vector3(Math.cos(a) * s, Math.abs(Math.sin(e)) * s * 1.5 + 0.05, Math.sin(a) * s));
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
    const parts = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.11, vertexColors: true, transparent: true, depthWrite: false }));
    parts.visible = false;
    parts.position.y = 0.55;
    scene.add(parts);
    function paintConfetti(rarity: PackRarity) {
      const hues = RARITY_HUES[rarity];
      const c = new THREE.Color();
      for (let i = 0; i < P; i++) {
        c.setHSL(hues[i % hues.length] / 360, 0.75, i % 3 === 0 ? 0.92 : 0.58);
        pCol[i * 3] = c.r;
        pCol[i * 3 + 1] = c.g;
        pCol[i * 3 + 2] = c.b;
      }
      pGeo.attributes.color.needsUpdate = true;
    }
    paintConfetti('common');

    // ---- state machine — same beats/timings as the web scene ----
    let phase: 'idle' | 'shake' | 'burst' | 'reveal' | 'done' = 'idle';
    let t0 = 0;
    const clock = new THREE.Clock();
    let pendingResult: PackOpenResult | null = null;
    let pendingError: unknown = null;

    function reset() {
      phase = 'idle';
      ticketGroup.visible = false;
      parts.visible = false;
      topHalf.position.set(0, PH / 4, 0);
      topHalf.rotation.set(0, 0, 0);
      botHalf.position.set(0, -PH / 4, 0);
      botHalf.rotation.set(0, 0, 0);
      [topHalf, botHalf].forEach((m) => (m.material as THREE.Material[]).forEach((mt: any) => ((mt.opacity = 1), (mt.transparent = false))));
      packRig.visible = true;
      packGroup.visible = true;
      glowLight.intensity = 0;
    }

    openRef.current = () => {
      if (phase !== 'idle' || !canOpenRef.current) return;
      phase = 'shake';
      t0 = clock.getElapsedTime();
      pendingResult = null;
      pendingError = null;
      resolveOpenRef
        .current()
        .then((result) => {
          pendingResult = result;
          paintConfetti(result.rarity);
          generateTicketTexture(result.ticketsAwarded, 'front').then((tex) => {
            if (!mountedRef.current) return;
            frontMat.map?.dispose();
            frontMat.map = makeDataTexture(tex);
            frontMat.needsUpdate = true;
          });
        })
        .catch((err) => {
          pendingError = err ?? new Error('Failed to open pack');
        });
    };

    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    let raf = 0;
    function tick() {
      if (!mountedRef.current) return;
      const t = clock.getElapsedTime(),
        e = t - t0;

      camera.position.set(
        target.x + radius * Math.cos(polar.current) * Math.sin(azimuth.current),
        target.y + radius * Math.sin(polar.current) + 0.5,
        target.z + radius * Math.cos(polar.current) * Math.cos(azimuth.current),
      );
      camera.lookAt(target);

      if (phase === 'idle') {
        packGroup.position.y = Math.sin(t * 1.3) * 0.13;
        packGroup.rotation.y = Math.sin(t * 0.55) * 0.34;
        packGroup.rotation.z = Math.sin(t * 0.8) * 0.035;
      } else if (phase === 'shake') {
        const k = Math.min(e / 1.2, 1);
        packGroup.position.x = (Math.random() - 0.5) * 0.14 * k;
        packGroup.position.y = (Math.random() - 0.5) * 0.11 * k;
        packGroup.rotation.z = (Math.random() - 0.5) * 0.14 * k;
        glowLight.intensity = k * 70;
        if (pendingError) {
          onErrorRef.current(pendingError instanceof Error ? pendingError.message : 'Failed to open pack');
          reset();
        } else if (e > 1.2 && pendingResult) {
          phase = 'burst';
          t0 = t;
          parts.visible = true;
          const p = parts.geometry.attributes.position as THREE.BufferAttribute;
          for (let i = 0; i < P; i++) {
            p.array[i * 3] = 0;
            p.array[i * 3 + 1] = 0;
            p.array[i * 3 + 2] = 0;
          }
          p.needsUpdate = true;
          ticketGroup.visible = true;
        }
      } else if (phase === 'burst' || phase === 'reveal') {
        const k = Math.min(e / 0.85, 1),
          q = ease(k);
        topHalf.position.y = PH / 4 + q * 3.1;
        topHalf.rotation.x = -q * 1.5;
        topHalf.rotation.z = -q * 0.5;
        botHalf.position.y = -PH / 4 - q * 3.1;
        botHalf.rotation.x = q * 1.5;
        botHalf.rotation.z = q * 0.5;
        [topHalf, botHalf].forEach((m) => (m.material as THREE.Material[]).forEach((mt: any) => ((mt.transparent = true), (mt.opacity = 1 - q))));
        packGroup.position.set(0, 0, 0);
        packGroup.rotation.set(0, 0, 0);
        const p = parts.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < P; i++) {
          p.array[i * 3] += pVel[i].x * 0.55;
          p.array[i * 3 + 1] += pVel[i].y * 0.55 - e * 0.012;
          p.array[i * 3 + 2] += pVel[i].z * 0.55;
        }
        p.needsUpdate = true;
        (parts.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - e / 1.5);
        const rk = Math.min(Math.max((e - 0.15) / 1.15, 0), 1),
          rq = ease(rk);
        ticketGroup.position.y = -1.2 + rq * 1.75;
        ticketGroup.rotation.y = (1 - rq) * Math.PI * 2.4;
        ticketGroup.scale.setScalar(0.5 + rq * 0.36);
        glowLight.intensity = 70 * (1 - k * 0.55);
        if (k >= 1 && phase === 'burst') phase = 'reveal';
        if (e > 1.5 && phase === 'reveal' && pendingResult) {
          phase = 'done';
          packRig.visible = false;
          parts.visible = false;
          onOpenedRef.current(pendingResult);
        }
      } else {
        ticketGroup.rotation.y = Math.sin(t * 0.7) * 0.42;
        ticketGroup.position.y = 0.55 + Math.sin(t * 1.2) * 0.07;
        glowLight.intensity = 26 + Math.sin(t * 2) * 5;
      }

      renderer.render(scene, camera);
      gl.endFrameEXP();
      raf = requestAnimationFrame(tick);
    }
    tick();
  }, []);

  return (
    <View style={{ width: '100%', aspectRatio: 0.82, borderRadius: 24, overflow: 'hidden', backgroundColor: '#08060A' }} {...panResponder.panHandlers}>
      <GLView style={{ flex: 1 }} onContextCreate={onContextCreate} />
    </View>
  );
}
