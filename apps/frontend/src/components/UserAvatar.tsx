'use client';

import { useEffect, useState } from 'react';

/** Privy stores X photos at the 48px `_normal` size. Swap in a larger variant so the header
 *  avatar stays sharp on retina displays. */
function sharperTwitterAvatar(url: string): string {
  return url.replace(/_normal(\.\w+)(\?|$)/, '_400x400$1$2');
}

/** Shared avatar: a real picture (X profile photo) when we have one, otherwise the existing
 *  gradient-letter fallback — used anywhere we show a gifter/user (gift claim page, profile
 *  page, OG share images). `label` supplies the fallback letter (first char, `@` stripped). */
export function UserAvatar({
  label,
  avatarUrl,
  className = 'h-9 w-9 text-base',
}: {
  label: string;
  avatarUrl?: string | null;
  className?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const initial = label.replace(/^@/, '').charAt(0).toUpperCase() || '?';
  const src = avatarUrl ? sharperTwitterAvatar(avatarUrl) : null;

  useEffect(() => {
    setImgFailed(false);
  }, [src]);

  if (src && !imgFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external X CDN URL, not a local/optimizable asset
      <img
        src={src}
        alt={label}
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }

  return (
    <div className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#FF1301] to-[#EAB308] font-display font-semibold text-white ${className}`}>
      {initial}
    </div>
  );
}
