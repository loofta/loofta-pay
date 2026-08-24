'use client';

import { useState } from 'react';

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

  if (avatarUrl && !imgFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external X CDN URL, not a local/optimizable asset
      <img
        src={avatarUrl}
        alt={label}
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
