"use client";

import { useState } from "react";
import { AVATAR_GRADIENT, type PublicAvatar } from "@/trade/lib/feed";

/** A person's picture: their Telegram or X photo, or a coloured tile with their first letter. */
export function PersonAvatar({ avatar, name, size = 44 }: { avatar: PublicAvatar; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (avatar.kind === "image" && avatar.url && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={avatar.url} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)} style={style} className="shrink-0 rounded-full bg-raised object-cover" />;
  }
  return (
    <div style={{ ...style, background: AVATAR_GRADIENT[avatar.color], fontSize: size * 0.42 }} className="grid shrink-0 place-items-center rounded-full font-display font-extrabold text-white">
      {(name.replace(/^@/, "")[0] ?? "?").toUpperCase()}
    </div>
  );
}
