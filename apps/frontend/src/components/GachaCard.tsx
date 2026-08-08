'use client';
// GachaCard.tsx — the collectible card that comes out of a Gacha Pack.
// Real artwork on the front, and you can always SWIPE (drag / trackpad / arrow keys) to flip —
// when Collector Crypt doesn't have a real back scan for this card, the back face just reuses the
// same front image (gold-tinted mat instead of the rarity-tinted front one, via drawCardBack's
// own styling), rather than a generic Loofta-branded back or no flip at all: the card physically
// coming out of the pack should always feel flippable, and a plain re-showing of the one real
// image you have reads better than either a fake back or a dead, static card.
//
//   <GachaCard width={320} card={{ name: 'Charizard', rarity: 'rare', faceImage: nft.image, backImage: nft.backImage }} />
//
// Canvas-rendered from the shared `gachaArt` module — no dependencies. Ported from the design
// handoff at /react/GachaCard.tsx.txt. `rarity` uses this app's real common/uncommon/rare/epic
// scale (see gachaArt.ts's RARITIES) rather than the handoff's generic common/rare/legendary.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, RotateCw, X } from 'lucide-react';
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
  // No real back scan -> the back face reuses the front image instead (see the file header).
  const backSrc = card.backImage ?? card.faceImage ?? card.image;
  // Real Collector Crypt scans commonly run 1-4MB+ (full-resolution PSA vault photos) — without
  // this, a slow fetch and "no artwork available" looked identical (blank canvas, then the same
  // framed placeholder either way), which read as broken rather than just loading.
  const hasRealArt = side === 'front' ? !!(card.faceImage || card.image) : !!backSrc;
  const [loading, setLoading] = useState(hasRealArt);
  useEffect(() => {
    let live = true;
    setLoading(hasRealArt);
    (async () => {
      const [brand, art, faceImage, backImage] = await Promise.all([
        getBrand(assets),
        side === 'front' ? getArt(card.image) : Promise.resolve(null),
        side === 'front' ? getArt(card.faceImage) : Promise.resolve(null),
        side === 'back' ? getArt(backSrc) : Promise.resolve(null),
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
      setLoading(false);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hasRealArt is derived from card.*, already covered below
  }, [card.name, card.rarity, card.image, card.faceImage, card.backImage, side, assets]);
  const height = (width * CH) / CW;
  return (
    <div style={{ position: 'relative', width, height }}>
      <canvas ref={ref} style={{ display: 'block', width, height, borderRadius: width * 0.055 }} />
      {loading && (
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: width * 0.055, background: 'rgba(11,11,15,0.4)',
          }}
        >
          <div
            className="animate-spin"
            style={{ width: 28, height: 28, borderRadius: '50%', border: '3px solid rgba(255,255,255,0.25)', borderTopColor: '#fff' }}
          />
        </div>
      )}
    </div>
  );
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

  // Flippable whenever there's any real art at all — see the file header for why a missing back
  // scan reuses the front image instead of disabling the flip.
  const canFlip = !!(card.faceImage || card.image || card.backImage);

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
  const currentIsFront = Math.abs(Math.round(turns) % 2) === 0;
  // Only for a REAL scan (never the generic branded pack art) — the whole point of zooming is
  // seeing the actual card detail up close, which a raw <img> at native resolution gives for
  // free (the canvas render above is capped to CW×CH, a real scan can be several times larger —
  // see gachaArt.ts's loadImage comment on real Collector Crypt scan sizes).
  const zoomUrl = currentIsFront ? card.faceImage : (card.backImage ?? card.faceImage ?? card.image);
  const [zoomOpen, setZoomOpen] = useState(false);
  useEffect(() => {
    if (!zoomOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoomOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomOpen]);

  return (
    <div style={{ position: 'relative', width, height }}>
      <div
        role={canFlip ? 'button' : 'img'}
        tabIndex={canFlip ? 0 : undefined}
        aria-label={canFlip
          ? `${card.name} card, ${currentIsFront ? 'front' : 'back'}. Swipe or press arrow keys to flip.`
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

      {zoomUrl && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setZoomOpen(true); }}
          aria-label="Zoom in on this card"
          className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-black/60 border border-white/20 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      )}

      {zoomOpen && zoomUrl && typeof window !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center p-6"
          onClick={() => setZoomOpen(false)}
        >
          <button
            type="button"
            onClick={() => setZoomOpen(false)}
            aria-label="Close"
            className="absolute top-5 right-5 w-10 h-10 rounded-full bg-white/10 border border-white/20 text-white flex items-center justify-center hover:bg-white/20 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- full-res zoom needs the raw source, not a canvas render */}
          <img
            src={zoomUrl}
            alt={`${card.name} card, ${currentIsFront ? 'front' : 'back'}`}
            className="max-w-[92vw] max-h-[92vh] object-contain rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          {canFlip && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); commit(turn + 1); }}
              aria-label={`Flip to ${currentIsFront ? 'back' : 'front'}`}
              className="absolute bottom-6 left-1/2 -translate-x-1/2 h-11 px-5 rounded-full bg-white/10 border border-white/20 text-white flex items-center gap-2 hover:bg-white/20 transition-colors"
            >
              <RotateCw className="w-4 h-4" />
              Flip to {currentIsFront ? 'back' : 'front'}
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
