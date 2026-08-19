"use client";

/**
 * Square-crop-and-resize modal for logo uploads. Pan (drag) + zoom (slider/wheel) over a fixed
 * square viewport, then exports a fixed-size square PNG blob — so every uploaded logo ends up
 * consistently sized and framed regardless of the source image's dimensions, instead of shipping
 * whatever aspect ratio/resolution the user's file happened to have.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, ZoomIn } from "lucide-react";
import { GradientActionButton } from "@/components/ui/GradientActionButton";

const VIEWPORT = 288; // px — the square crop window shown on screen
const OUTPUT_SIZE = 512; // px — the exported logo's fixed width/height
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

interface Props {
  file: File;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}

export function LogoCropModal({ file, onCancel, onConfirm }: Props) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [exporting, setExporting] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; offX: number; offY: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImgSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Cover-fit scale: the smallest scale at which the image fully covers the square viewport.
  const baseScale = useMemo(() => {
    if (!natural.w || !natural.h) return 1;
    return Math.max(VIEWPORT / natural.w, VIEWPORT / natural.h);
  }, [natural]);

  const scale = baseScale * zoom;

  const clampOffset = useCallback(
    (x: number, y: number, s: number) => {
      const dw = natural.w * s;
      const dh = natural.h * s;
      const minX = Math.min(0, VIEWPORT - dw);
      const minY = Math.min(0, VIEWPORT - dh);
      return { x: Math.min(0, Math.max(minX, x)), y: Math.min(0, Math.max(minY, y)) };
    },
    [natural],
  );

  const onImgLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setNatural({ w, h });
    const s = Math.max(VIEWPORT / w, VIEWPORT / h);
    setOffset({ x: (VIEWPORT - w * s) / 2, y: (VIEWPORT - h * s) / 2 });
  };

  const changeZoom = (next: number) => {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    setZoom(z);
    setOffset((prev) => clampOffset(prev.x, prev.y, baseScale * z));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, offX: offset.x, offY: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset(clampOffset(dragRef.current.offX + dx, dragRef.current.offY + dy, scale));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    changeZoom(zoom - e.deltaY * 0.0015);
  };

  const handleConfirm = async () => {
    const img = imgRef.current;
    if (!img || !natural.w) return;
    setExporting(true);
    try {
      const sx = -offset.x / scale;
      const sy = -offset.y / scale;
      const sSize = VIEWPORT / scale;
      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas not supported");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Failed to export image");
      onConfirm(blob);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#17171b] shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-medium text-white">Crop your logo</h2>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-white rounded-lg p-1 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-slate-400 mb-4">Drag to reposition, use the slider to zoom. Square logos look best.</p>

        <div
          className="relative mx-auto overflow-hidden rounded-2xl border border-white/15 bg-black/40 touch-none cursor-grab active:cursor-grabbing"
          style={{ width: VIEWPORT, height: VIEWPORT }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onWheel={onWheel}
        >
          {imgSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={imgSrc}
              alt=""
              draggable={false}
              onLoad={onImgLoad}
              className="absolute top-0 left-0 select-none pointer-events-none"
              style={{
                width: natural.w * scale,
                height: natural.h * scale,
                transform: `translate(${offset.x}px, ${offset.y}px)`,
                maxWidth: "none",
              }}
            />
          )}
          {/* corner guides so the square framing reads clearly against the image */}
          <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/20" />
        </div>

        <div className="flex items-center gap-3 mt-4">
          <ZoomIn className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => changeZoom(Number(e.target.value))}
            className="w-full accent-[#FF7A2A]"
          />
        </div>

        <div className="flex gap-3 mt-5">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-white/15 text-slate-300 hover:bg-white/[0.06] transition-colors py-2.5 text-base font-medium"
          >
            Cancel
          </button>
          <GradientActionButton className="flex-1 h-auto py-2.5" onClick={handleConfirm} loading={exporting} loadingText="Saving…">
            <span className="text-base">Use this crop</span>
          </GradientActionButton>
        </div>
      </div>
    </div>
  );
}
