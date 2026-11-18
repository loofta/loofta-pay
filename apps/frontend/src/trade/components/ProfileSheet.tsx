"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Check, Shuffle } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { PersonAvatar } from "@/trade/components/PersonAvatar";
import { Sheet } from "@/trade/components/Sheet";
import { Skeleton, Switch } from "@/trade/components/ui";
import { useWallet } from "@/trade/hooks/useWallet";
import { AVATAR_COLORS, AVATAR_GRADIENT, fetchProfile, saveProfile, squareThumb, uploadAvatar, type AvatarColor, type MiniProfile } from "@/trade/lib/feed";
import { haptic } from "@/trade/lib/telegram";

/** Your name and picture in the feed, and what you show on your posts. */
export function ProfileSheet({ onClose, onChanged }: { onClose: () => void; onChanged: (p: MiniProfile) => void }) {
  const { getAccessToken, userId } = useWallet();
  const { linkTwitter } = usePrivy();
  const [p, setP] = useState<MiniProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [handle, setHandle] = useState("");

  useEffect(() => {
    if (!userId) return;
    getAccessToken()
      .then(fetchProfile)
      .then((x) => {
        setP(x);
        setHandle(x.handle ?? "");
      })
      .catch(() => setError("Could not load your profile."));
  }, [userId, getAccessToken]);

  const save = async (body: Parameters<typeof saveProfile>[0]) => {
    setBusy(true);
    setError(null);
    try {
      const next = await saveProfile(body, await getAccessToken());
      setP(next);
      setHandle(next.handle ?? "");
      onChanged(next);
      haptic("tap");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const fileRef = useRef<HTMLInputElement>(null);
  const onFile = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      const next = await uploadAvatar(await squareThumb(f), await getAccessToken());
      setP(next);
      onChanged(next);
      haptic("tap");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload. Try another picture.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const photoBtn = (label: string, url: string | null, onPick: () => void, selected: boolean, hint?: string) => (
    <button type="button" onClick={onPick} disabled={busy} className={clsx("flex w-full items-center gap-3 rounded-2xl bg-[#1c1c22] px-4 py-3 text-left", selected && "ring-2 ring-up")}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" referrerPolicy="no-referrer" className="h-11 w-11 shrink-0 rounded-full object-cover" />
      ) : (
        <div className="h-11 w-11 shrink-0 rounded-full bg-raised" />
      )}
      <div className="min-w-0 flex-1">
        <div className="font-display text-base font-bold">{label}</div>
        {hint && <div className="text-base text-mute">{hint}</div>}
      </div>
      {selected && <Check size={20} className="text-up" />}
    </button>
  );

  return (
    <Sheet title="Your profile" onClose={onClose}>
      {!p && !error && <Skeleton className="mt-4 h-64" />}
      {error && <div className="mt-4 text-base text-down">{error}</div>}
      {p && (
        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <PersonAvatar avatar={p.avatar} name={p.name} size={64} />
            <div className="min-w-0">
              <div className="truncate font-display text-xl font-extrabold">@{p.name}</div>
              <div className="text-base text-mute">This is what people see in the Feed</div>
            </div>
          </div>

          <div>
            <div className="mb-2 font-display text-lg font-bold">Username</div>
            <div className="flex gap-2">
              <div className="flex h-14 min-w-0 flex-1 items-center rounded-2xl bg-[#1c1c22] px-4">
                <span className="pr-1 font-display text-xl font-bold text-mute">@</span>
                <input value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20))} placeholder="pick a name" maxLength={20} className="h-full min-w-0 flex-1 bg-transparent font-display text-xl font-bold outline-none placeholder:text-mute/50" />
              </div>
              <button type="button" aria-label="Random name" disabled={busy} onClick={() => save({ shuffleHandle: true })} className="btn3d dark grid h-14 w-14 shrink-0 place-items-center !rounded-2xl">
                <Shuffle size={20} />
              </button>
            </div>
            <button type="button" disabled={busy || handle.length < 3 || handle === (p.handle ?? "")} onClick={() => save({ handle })} className="btn3d mt-2 h-12 w-full text-base">
              Save username
            </button>
            {p.options.telegramName && (
              <button type="button" disabled={busy} onClick={() => save({ useTelegramName: true })} className="mt-2 w-full rounded-2xl bg-[#1c1c22] px-4 py-3 text-left text-base">
                <span className="font-semibold">Use my Telegram name (@{p.options.telegramName})</span>
                <span className="block text-mute">Only if you are fine with people linking your trades to your Telegram.</span>
              </button>
            )}
            <p className="mt-2 text-base text-mute">3 to 20 letters, numbers or underscores. Your Telegram name is never used unless you choose it.</p>
          </div>

          <div>
            <div className="mb-1 font-display text-lg font-bold">Picture</div>
            <p className="mb-2 text-base text-mute">Use your Telegram pfp or upload one.</p>
            <div className="space-y-2">
              {p.options.telegram && photoBtn("Use Telegram pfp", p.options.telegram, () => save({ avatar: "telegram" }), p.avatar.kind === "image" && p.avatar.url === p.options.telegram)}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
              {photoBtn("Upload a picture", p.avatar.kind === "image" && p.avatar.url?.includes("/mini/feed/avatar/") ? p.avatar.url : null, () => fileRef.current?.click(), p.avatar.kind === "image" && !!p.avatar.url?.includes("/mini/feed/avatar/"), "From your photos, cut to a square")}
              {p.options.twitter
                ? photoBtn("Use my X photo", p.options.twitter, () => save({ avatar: "twitter" }), p.avatar.kind === "image" && p.avatar.url === p.options.twitter)
                : photoBtn("Use my X photo", null, () => void linkTwitter(), false, "Connect your X account first")}
            </div>
            <div className="mt-3 text-base text-mute">Or pick a colour</div>
            <div className="mt-2 grid grid-cols-8 gap-2">
              {AVATAR_COLORS.map((c: AvatarColor) => (
                <button key={c} type="button" aria-label={c} disabled={busy} onClick={() => save({ avatar: "color", color: c })} className={clsx("h-10 w-10 rounded-full", p.avatar.kind === "color" && p.avatar.color === c && "ring-2 ring-white")} style={{ background: AVATAR_GRADIENT[c] }} />
              ))}
            </div>
          </div>

          <div className="card divide-y divide-white/10 px-4 py-1">
            <div className="py-3">
              <Switch on={p.showPnl} onChange={(v) => save({ showPnl: v })} label="Show my position and PnL on my posts" />
              <p className="mt-1 text-base text-mute">PnL covers coins you traded in Loofta. Turn it off and your posts show only what you wrote.</p>
            </div>
            <div className="py-3">
              <Switch on={p.shareActivity} onChange={(v) => save({ shareActivity: v })} label="Show my bets and buys in the Feed" />
              <p className="mt-1 text-base text-mute">Turn it off and only the comments you write show up.</p>
            </div>
          </div>
          <p className="text-base text-mute">Only people who hold a coin can post about it.</p>
        </div>
      )}
    </Sheet>
  );
}
