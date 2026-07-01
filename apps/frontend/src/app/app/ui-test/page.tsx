"use client";
import React, { useState } from "react";

// Isolated preview of the username suggestion component on the claim page.
// Visit /app/ui-test to see it.

function UsernameSuggestion({
  handle,
  updating,
  onSet,
}: {
  handle: string;
  updating: boolean;
  onSet: () => void;
}) {
  return (
    <div className="mb-5 flex items-center justify-between gap-3 max-w-md mx-auto rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <span className="text-sm text-slate-300">
        Use <span className="font-semibold text-white">@{handle}</span> as your Loofta username
      </span>
      <button
        type="button"
        disabled={updating}
        onClick={onSet}
        className="shrink-0 inline-flex items-center justify-center rounded-lg bg-white text-black px-3 py-1.5 text-sm font-semibold hover:opacity-80 disabled:opacity-50 transition-opacity"
      >
        {updating ? "Setting…" : "Set username"}
      </button>
    </div>
  );
}

export default function UITestPage() {
  const [updating, setUpdating] = useState(false);
  const [done, setDone] = useState(false);

  const handleSet = () => {
    setUpdating(true);
    setTimeout(() => {
      setUpdating(false);
      setDone(true);
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-[#111] flex flex-col items-center py-16 px-4 gap-12">
      <h1 className="text-white text-xl font-semibold">UI Test — username suggestion</h1>

      <div className="w-full max-w-md space-y-8">
        <div>
          <p className="text-slate-500 text-sm mb-3">Default state</p>
          <UsernameSuggestion handle="jjjjacobx" updating={false} onSet={() => {}} />
        </div>

        <div>
          <p className="text-slate-500 text-sm mb-3">Updating state</p>
          <UsernameSuggestion handle="jjjjacobx" updating={true} onSet={() => {}} />
        </div>

        <div>
          <p className="text-slate-500 text-sm mb-3">Interactive (click Set username)</p>
          {!done ? (
            <UsernameSuggestion handle="jjjjacobx" updating={updating} onSet={handleSet} />
          ) : (
            <p className="text-green-400 text-sm text-center">Username set!</p>
          )}
        </div>

        <div>
          <p className="text-slate-500 text-sm mb-3">Long handle</p>
          <UsernameSuggestion handle="averylonghandle123" updating={false} onSet={() => {}} />
        </div>
      </div>
    </div>
  );
}
