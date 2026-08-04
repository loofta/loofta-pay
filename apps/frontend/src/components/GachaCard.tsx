'use client';
// GachaCard.tsx — the collectible card that comes out of a Gacha Pack.
// Real artwork on the front, and if a real back scan is ALSO available, you can SWIPE (drag /
// trackpad / arrow keys) to flip between the two faces in 3D. If there's no real back scan, the
// card is static, front-only — it deliberately never falls back to a generic Loofta-branded back
// face; a made-up brand pattern standing in for a real collectible's actual back reads as fake.
//
//   <GachaCard width={320} card={{ name: 'Charizard', rarity: 'rare', faceImage: nft.image, backImage: nft.backImage }} />
//
// Canvas-rendered from the shared `gachaArt` module — no dependencies. Ported from the design
// handoff at /react/GachaCard.tsx.txt. `rarity` uses this app's real common/uncommon/rare/epic
// scale (see gachaArt.ts's RARITIES) rather than the handoff's generic common/rare/legendary.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { drawCardFront, drawCardBack, loadSvg, loadImage, CW, CH, type Rarity } from './gachaArt';

export type { Rarity };
export type CardData = {
  name: string;
  rarity: Rarity;
  /** Illustration URL, cover-cropped into the framed card's art window. */
  image?: string;
  /** A COMPLETE card front (real card scan) — used edge-to-edge, frame skipped. */
  faceImage?: string;
  /** A COMPLETE card back — pairs with faceImage so you can swipe front <-> back. */
  backImage?: string;
};

export type CardAssets = { logoDark: string; logoWhite: string };
const DEFAULT_ASSETS: CardAssets = {
  logoDark: '/loofta.svg',
  logoWhite: '/loofta_white.svg',
};

/* ---- shared, cached asset loading ---- */
const brandCache = new Map<string, Promise<Record<string, HTMLImageElement | null>>>();
function getBrand(assets: CardAssets) {
  const key = JSON.stringify(assets);
  let p = brandCache.get(key);
  if (!p) {
    p = (async () => {
      try { await (document as any).fonts?.ready; } catch { /* fonts optional */ }
      const [logoDark, logoWhite] = await Promise.all([loadSvg(assets.logoDark), loadSvg(assets.logoWhite)]);
      return { logoDark, logoWhite };
    })();
    brandCache.set(key, p);
  }
  return p;
}
const artCache = new Map<string, Promise<HTMLImageElement | null>>();
function getArt(url?: string) {
  if (!url) return Promise.resolve(null);
  let p = artCache.get(url);
  if (!p) { p = loadImage(url); artCache.set(url, p); }
  return p;
}

/** Preload a set of card images so reveals never pop in late. */
export function preloadCards(cards: CardData[]) {
  const urls = cards.flatMap((c) => [c.image, c.faceImage, c.backImage]).filter(Boolean) as string[];
  return Promise.all([...new Set(urls)].map(getArt));
}

/* ---- one painted face ---- */
function Face({ width, card, side, assets }: { width: number; card: CardData; side: 'front' | 'back'; assets: CardAssets }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const [brand, art, faceImage, backImage] = await Promise.all([
        getBrand(assets),
        side === 'front' ? getArt(card.image) : Promise.resolve(null),
        side === 'front' ? getArt(card.faceImage) : Promise.resolve(null),
        side === 'back' ? getArt(card.backImage) : Promise.resolve(null),
      ]);
      if (!live || !ref.current) return;
      const c = ref.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = CW * dpr; c.height = CH * dpr;
      const x = c.getContext('2d')!;
      x.scale(dpr, dpr);
      if (side === 'front') {
        drawCardFront(x, { ...card, art, faceImage, logoDark: brand.logoDark });
      } else {
        drawCardBack(x, { logoWhite: brand.logoWhite, backImage });
      }
    })();
    return () => { live = false; };
  }, [card.name, card.rarity, card.image, card.faceImage, card.backImage, side, assets]);
  return <canvas ref={ref} style={{ display: 'block', width, height: (width * CH) / CW, borderRadius: width * 0.055 }} />;
}

/* ---- swipeable single card ---- */
export default function GachaCard({
  width = 320,
  card,
  assets: assetsProp,
  onFlip,
  style,
}: {
  width?: number;
  card: CardData;
  assets?: Partial<CardAssets>;
  onFlip?: (side: 'front' | 'back') => void;
  style?: React.CSSProperties;
}) {
  const assets = React.useMemo(
    () => ({ ...DEFAULT_ASSETS, ...assetsProp }),
    [assetsProp?.logoDark, assetsProp?.logoWhite],
  );
  const height = (width * CH) / CW;

  // No real back scan -> no flip at all, ever. Drawing the back face with a Loofta brand pattern
  // as a stand-in for a real collectible's actual back is exactly what this card shouldn't do —
  // better to just show the one real face you have.
  const canFlip = !!card.backImage;

  // turns, in half-rotations: even = front, odd = back
  const [turn, setTurn] = useState(0);
  const [drag, setDrag] = useState(0); // live drag, in turns
  const startX = useRef(0);
  const dragging = useRef(false);

  const commit = useCallback((next: number) => {
    setTurn(next);
    onFlip?.(Math.abs(next % 2) === 0 ? 'front' : 'back');
  }, [onFlip]);

  const onDown = (e: React.PointerEvent) => {
    if (!canFlip) return;
    dragging.current = true; startX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!canFlip || !dragging.current) return;
    setDrag((e.clientX - startX.current) / (width * 0.9));
  };
  const onUp = () => {
    if (!canFlip || !dragging.current) return;
    dragging.current = false;
    commit(Math.round(turn + drag));
    setDrag(0);
  };

  const turns = turn + drag;
  const deg = turns * 180;

  return (
    <div
      role={canFlip ? 'button' : 'img'}
      tabIndex={canFlip ? 0 : undefined}
      aria-label={canFlip
        ? `${card.name} card, ${Math.abs(Math.round(turns) % 2) === 0 ? 'front' : 'back'}. Swipe or press arrow keys to flip.`
        : `${card.name} card`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onClick={() => { if (canFlip && !drag) commit(turn + 1); }}
      onKeyDown={(e) => {
        if (!canFlip) return;
        if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); commit(turn + 1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); commit(turn - 1); }
      }}
      style={{ width, height, perspective: 1800, cursor: canFlip ? 'grab' : 'default', touchAction: 'pan-y', outline: 'none', ...style }}
    >
      {canFlip ? (
        <div
          style={{
            position: 'relative', width: '100%', height: '100%', transformStyle: 'preserve-3d',
            transform: `rotateY(${deg}deg)`,
            transition: dragging.current ? 'none' : 'transform .75s cubic-bezier(.2,.8,.2,1)',
          }}
        >
          <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', filter: 'drop-shadow(0 24px 46px rgba(0,0,0,.42))' }}>
            <Face width={width} card={card} side="front" assets={assets} />
          </div>
          <div style={{ position: 'absolute', inset: 0, backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', filter: 'drop-shadow(0 24px 46px rgba(0,0,0,.42))' }}>
            <Face width={width} card={card} side="back" assets={assets} />
          </div>
        </div>
      ) : (
        <div style={{ filter: 'drop-shadow(0 24px 46px rgba(0,0,0,.42))' }}>
          <Face width={width} card={card} side="front" assets={assets} />
        </div>
      )}
    </div>
  );
}
