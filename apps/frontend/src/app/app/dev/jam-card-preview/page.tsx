"use client";

// Internal-only preview of the Jam Card pilot concept — not linked from any nav.
// Delete or gate behind an admin check before this ever ships to real users.

import dynamic from "next/dynamic";

const JamCard3D = dynamic(() => import("@/components/jam-card/JamCard3D"), { ssr: false });

export default function JamCardPreviewPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0c] flex flex-col items-center justify-center gap-6 p-6">
      <JamCard3D className="w-full max-w-md aspect-[1.586] " />
      <p className="text-slate-400 text-base text-center max-w-md">
        Concept preview only — network mark, card number, and art are placeholders until Jam
        confirms Visa/Mastercard and sends real assets.
      </p>
    </div>
  );
}
