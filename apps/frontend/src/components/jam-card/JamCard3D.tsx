'use client';
// JamCard3D.tsx — rotating 3D concept card for the Jam Card pilot.
//
// Placeholder only: network mark and card art are generic until Jam confirms
// Visa/Mastercard and sends real assets — see JAM_CARD_PLACEHOLDER below.
//
// Client-only (touches window/WebGL) — import via next/dynamic with ssr:false.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const JAM_CARD_PLACEHOLDER = true;

const CARD_WIDTH = 1.6;
const CARD_HEIGHT = CARD_WIDTH / 1.586; // ISO/IEC 7810 ID-1 card ratio
const CARD_DEPTH = 0.02;
const CORNER_RADIUS = 0.09;

function roundedRectShape(width: number, height: number, radius: number) {
  const w = width / 2;
  const h = height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-w + radius, -h);
  shape.lineTo(w - radius, -h);
  shape.quadraticCurveTo(w, -h, w, -h + radius);
  shape.lineTo(w, h - radius);
  shape.quadraticCurveTo(w, h, w - radius, h);
  shape.lineTo(-w + radius, h);
  shape.quadraticCurveTo(-w, h, -w, h - radius);
  shape.lineTo(-w, -h + radius);
  shape.quadraticCurveTo(-w, -h, -w + radius, -h);
  return shape;
}

function drawFaceTexture(face: 'front' | 'back'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = Math.round(1024 / 1.586);
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;

  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#15130f');
  bg.addColorStop(0.55, '#1f1c16');
  bg.addColorStop(1, '#0c0b09');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const sheen = ctx.createLinearGradient(0, 0, w, h * 0.4);
  sheen.addColorStop(0, 'rgba(255,166,0,0.10)');
  sheen.addColorStop(1, 'rgba(255,166,0,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, w, h);

  if (face === 'front') {
    ctx.fillStyle = '#f5f0e6';
    ctx.font = '600 54px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('loofta', 60, 100);

    ctx.fillStyle = 'rgba(245,240,230,0.55)';
    ctx.font = '500 30px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('JAM CARD · PILOT', 60, 140);

    // chip
    ctx.fillStyle = '#d8b45a';
    const chipX = 60, chipY = 210, chipW = 100, chipH = 74;
    const r = 10;
    ctx.beginPath();
    ctx.moveTo(chipX + r, chipY);
    ctx.arcTo(chipX + chipW, chipY, chipX + chipW, chipY + chipH, r);
    ctx.arcTo(chipX + chipW, chipY + chipH, chipX, chipY + chipH, r);
    ctx.arcTo(chipX, chipY + chipH, chipX, chipY, r);
    ctx.arcTo(chipX, chipY, chipX + chipW, chipY, r);
    ctx.fill();

    ctx.fillStyle = 'rgba(245,240,230,0.9)';
    ctx.font = '600 46px "Courier New", monospace';
    ctx.fillText('•••• •••• •••• 4269', 60, h - 140);

    ctx.font = '500 26px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = 'rgba(245,240,230,0.6)';
    ctx.fillText('LOOFTA MEMBER', 60, h - 80);
    ctx.textAlign = 'right';
    ctx.fillText('CONCEPT / TBD NETWORK', w - 60, h - 80);
    ctx.textAlign = 'left';
  } else {
    ctx.fillStyle = '#0a0908';
    ctx.fillRect(0, 60, w, 130);

    ctx.fillStyle = 'rgba(245,240,230,0.35)';
    ctx.font = '500 26px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('Preview only — real card art pending Jam partner assets', 60, 260);
    ctx.fillText('Fee split: 50/50 revenue share on load fee', 60, 300);

    ctx.fillStyle = 'rgba(245,240,230,0.5)';
    ctx.font = '600 32px "Helvetica Neue", Arial, sans-serif';
    ctx.fillText('loofta × jam', 60, h - 70);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export default function JamCard3D({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10);
    camera.position.set(0, 0, 3.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const shape = roundedRectShape(CARD_WIDTH, CARD_HEIGHT, CORNER_RADIUS);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: CARD_DEPTH,
      bevelEnabled: true,
      bevelThickness: 0.004,
      bevelSize: 0.004,
      bevelSegments: 2,
      curveSegments: 24,
    });
    geometry.center();

    const frontTex = drawFaceTexture('front');
    const backTex = drawFaceTexture('back');

    const edgeMat = new THREE.MeshStandardMaterial({ color: '#1a1712', metalness: 0.6, roughness: 0.4 });
    const frontMat = new THREE.MeshStandardMaterial({ map: frontTex, metalness: 0.35, roughness: 0.35 });
    const backMat = new THREE.MeshStandardMaterial({ map: backTex, metalness: 0.35, roughness: 0.35 });
    // ExtrudeGeometry face groups: [0]=front cap, [1]=back cap, [2]=side
    const card = new THREE.Mesh(geometry, [frontMat, backMat, edgeMat]);
    scene.add(card);

    const key = new THREE.DirectionalLight(0xfff2d9, 1.6);
    key.position.set(2, 3, 4);
    scene.add(key);
    scene.add(new THREE.AmbientLight(0xffffff, 0.3));

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.4;
    controls.minPolarAngle = Math.PI / 2 - 0.5;
    controls.maxPolarAngle = Math.PI / 2 + 0.5;

    let raf = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      if (!clientWidth || !clientHeight) return;
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(clientWidth, clientHeight);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    animate();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      geometry.dispose();
      frontMat.dispose();
      backMat.dispose();
      edgeMat.dispose();
      frontTex.dispose();
      backTex.dispose();
      pmrem.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={containerRef} className={className ?? 'w-full h-full min-h-[320px]'} />;
}

export { JAM_CARD_PLACEHOLDER };
