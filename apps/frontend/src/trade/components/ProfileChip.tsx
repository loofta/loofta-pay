"use client";

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { PersonAvatar } from "@/trade/components/PersonAvatar";
import { ProfileSheet } from "@/trade/components/ProfileSheet";
import { useWallet } from "@/trade/hooks/useWallet";
import { fetchProfile, type MiniProfile } from "@/trade/lib/feed";
import { haptic } from "@/trade/lib/telegram";

/** Your picture and username, with a way to change them. */
export function ProfileChip() {
  const { userId, getAccessToken } = useWallet();
  const [me, setMe] = useState<MiniProfile | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!userId) return;
    getAccessToken().then(fetchProfile).then(setMe).catch(() => undefined);
  }, [userId, getAccessToken]);

  if (!me) return null;
  return (
    <>
      <button type="button" onClick={() => { haptic("tap"); setOpen(true); }} className="mb-4 flex w-full items-center gap-3 rounded-[24px] border border-white/[0.07] bg-[#141419] p-3 text-left active:scale-[0.99]">
        <PersonAvatar avatar={me.avatar} name={me.name} size={48} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-lg font-bold">@{me.name}</div>
          <div className="text-base text-mute">Change your picture and username</div>
        </div>
        <ChevronRight size={22} className="shrink-0 text-mute" />
      </button>
      {open && <ProfileSheet onClose={() => setOpen(false)} onChanged={setMe} />}
    </>
  );
}
