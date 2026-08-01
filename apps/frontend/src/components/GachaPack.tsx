// GachaPack.tsx — Loofta Gacha Pack (pooled Pokemon packs) closed-pack visual.
// Canvas-rendered from gachaArt.ts, so it can never drift from that single-source artwork.
// No three.js, no extra dependencies. Ported from the design handoff at /gacha/GachaPack.tsx.txt
// — dropped the unused megapotDark/megapotWhite asset slots (drawGachaPack never referenced
// them) and pointed the defaults at this app's real existing brand SVGs instead of an
// unprovisioned /brand/ folder.
//
//   <GachaPack width={320} />
//   <GachaPack width={320} face="back" />
//   <GachaPack width={320} flippable />          // click to flip

'use client';

import React, { useEffect, useRef, useState } from 'react';
import { drawGachaPack, loadSvg, AW, AH } from './gachaArt';

export type GachaAssets = {
  logoWhite: string;
};

const DEFAULT_ASSETS: GachaAssets = {
  logoWhite: '/loofta_white.svg',
};

// images are loaded once per unique asset set and shared across instances
type Imgs = { logoWhite: HTMLImageElement | null };
const imgCache = new Map<string, Promise<Imgs>>();
function getImages(assets: GachaAssets) {
  const key = JSON.stringify(assets);
  let p = imgCache.get(key);
  if (!p) {
    p = (async () => {
      try {
        await (document as any).fonts?.ready;
      } catch {
        /* fonts optional */
      }
      const [logoWhite] = await Promise.all([loadSvg(assets.logoWhite)]);
      return { logoWhite };
    })();
    imgCache.set(key, p);
  }
  return p;
}

function Face({ width, face, assets }: { width: number; face: 'front' | 'back'; assets: GachaAssets }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    getImages(assets).then((imgs) => {
      if (!live || !ref.current) return;
      const c = ref.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = AW * dpr;
      c.height = AH * dpr;
      const x = c.getContext('2d')!;
      x.scale(dpr, dpr);
      drawGachaPack(x, face, imgs);
    });
    return () => {
      live = false;
    };
  }, [face, assets]);
  return (
    <canvas
      ref={ref}
      style={{ display: 'block', width, height: (width * AH) / AW, borderRadius: width * 0.05 }}
    />
  );
}

export default function GachaPack({
  width = 320,
  face = 'front',
  flippable = false,
  onFlip,
  style,
  assets: assetsProp,
}: {
  width?: number;
  face?: 'front' | 'back';
  flippable?: boolean;
  onFlip?: (face: 'front' | 'back') => void;
  style?: React.CSSProperties;
  /** Override the brand asset URL; unset falls back to DEFAULT_ASSETS. */
  assets?: Partial<GachaAssets>;
}) {
  const [flipped, setFlipped] = useState(face === 'back');
  const assets = React.useMemo(() => ({ ...DEFAULT_ASSETS, ...assetsProp }), [assetsProp?.logoWhite]);
  const height = (width * AH) / AW;

  if (!flippable) {
    return (
      <div style={{ filter: 'drop-shadow(0 30px 56px rgba(0,0,0,.5))', ...style }}>
        <Face width={width} face={face} assets={assets} />
      </div>
    );
  }

  const flip = () => {
    const next = !flipped;
    setFlipped(next);
    onFlip?.(next ? 'back' : 'front');
  };

  return (
    <div onClick={flip} style={{ width, height, perspective: 2000, cursor: 'pointer', ...style }}>
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          transformStyle: 'preserve-3d',
          transition: 'transform 1s cubic-bezier(.2,.8,.2,1)',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0)',
        }}
      >
        <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', filter: 'drop-shadow(0 30px 56px rgba(0,0,0,.5))' }}>
          <Face width={width} face="front" assets={assets} />
        </div>
        <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', filter: 'drop-shadow(0 30px 56px rgba(0,0,0,.5))' }}>
          <Face width={width} face="back" assets={assets} />
        </div>
      </div>
    </div>
  );
}

/** Export the current artwork as a PNG Blob (e.g. for share cards). */
export async function renderGachaPackPNG(face: 'front' | 'back' = 'front', scale = 2, assets?: Partial<GachaAssets>): Promise<Blob> {
  const imgs = await getImages({ ...DEFAULT_ASSETS, ...assets });
  const c = document.createElement('canvas');
  c.width = AW * scale;
  c.height = AH * scale;
  const x = c.getContext('2d')!;
  x.scale(scale, scale);
  drawGachaPack(x, face, imgs);
  return new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
}
