"use client";

import { useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";

/**
 * Logo picker: drag an image onto the box or click to choose one. It is uploaded (squared and
 * compressed server-side by the same route merchant branding uses) and the hosted address is
 * handed back through onChange.
 */
export function LogoUpload({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
}) {
  const { getAccessToken } = usePrivy();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setError(null);
    if (!file.type.startsWith("image/")) return setError("Choose an image file.");
    if (file.size > 5 * 1024 * 1024) return setError("The image must be under 5 MB.");
    setBusy(true);
    try {
      const token = await getAccessToken();
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/merchant-branding/upload-logo", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Upload failed");
      onChange(data.logo_url as string);
    } catch (e) {
      setError((e as Error).message || "Could not upload the logo.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const locked = disabled || busy;

  return (
    <div>
      <div
        role="button"
        tabIndex={locked ? -1 : 0}
        aria-label="Upload logo. Drag an image here or press Enter to choose a file."
        onClick={() => !locked && input.current?.click()}
        onKeyDown={(e) => {
          if (!locked && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            input.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!locked) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file && !locked) void upload(file);
        }}
        className={`flex items-center gap-5 rounded-2xl border-2 border-dashed p-4 transition ${
          locked ? "cursor-not-allowed opacity-60" : "cursor-pointer"
        } ${dragging ? "border-[#FF6A1F] bg-[#FF6A1F]/10" : "border-white/15 bg-[#0b0b0e] hover:border-[#FF6A1F]/50"}`}
      >
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="Logo" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-[#9C9CA5]" aria-hidden>
              <path d="M12 16V4m0 0l-4 4m4-4l4 4" />
              <path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />
            </svg>
          )}
        </div>
        <div className="min-w-0">
          <div className="text-[15px] font-medium text-[#EDEDEF]">
            {busy ? "Uploading..." : dragging ? "Drop it here" : value ? "Drop a new image or click to change" : "Drag an image here, or click to choose"}
          </div>
          <div className="mt-1 text-[14px] text-[#9C9CA5]">PNG, JPG or SVG, up to 5 MB. It is cropped to a square.</div>
        </div>
        <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
      </div>
      {value && !disabled && (
        <div className="mt-2 flex justify-end">
          <button type="button" onClick={() => onChange(null)} className="text-[14px] text-[#C9C9D0] transition hover:text-[#DCDCE1]">
            Remove logo
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-[14px] text-red-300">{error}</p>}
    </div>
  );
}
