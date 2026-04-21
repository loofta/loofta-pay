// 3D glossy orange/red icons matching Loofta brand palette.
// Gradient pattern: cream highlight → orange mid → deep orange-red shadow

export function Icon3DGlobe({ size = 52 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="i3d-globe-base" cx="36%" cy="28%" r="68%" gradientUnits="objectBoundingBox">
          <stop offset="0%" stopColor="#ffe8d0" />
          <stop offset="28%" stopColor="#ffa050" />
          <stop offset="62%" stopColor="#ff4810" />
          <stop offset="100%" stopColor="#c01400" />
        </radialGradient>
        <radialGradient id="i3d-globe-gloss" cx="38%" cy="22%" r="52%" gradientUnits="objectBoundingBox">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.82" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id="i3d-globe-shadow" x="-25%" y="-25%" width="150%" height="150%">
          <feDropShadow dx="0" dy="3" stdDeviation="3.5" floodColor="#b01000" floodOpacity="0.38" />
        </filter>
        <clipPath id="i3d-globe-clip">
          <circle cx="28" cy="27" r="21" />
        </clipPath>
      </defs>
      <circle cx="28" cy="27" r="21" fill="url(#i3d-globe-base)" filter="url(#i3d-globe-shadow)" />
      <g clipPath="url(#i3d-globe-clip)" fill="none" stroke="#8b1800" strokeOpacity="0.45" strokeWidth="1.3">
        <ellipse cx="28" cy="27" rx="21" ry="7.5" />
        <ellipse cx="28" cy="20" rx="15" ry="5" />
        <ellipse cx="28" cy="34" rx="15" ry="5" />
        <ellipse cx="28" cy="27" rx="8" ry="21" />
        <ellipse cx="28" cy="27" rx="16" ry="21" />
      </g>
      <ellipse cx="21" cy="18" rx="10" ry="7" fill="url(#i3d-globe-gloss)" />
    </svg>
  );
}

export function Icon3DEye({ size = 52 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="i3d-eye-outer" cx="34%" cy="26%" r="68%" gradientUnits="objectBoundingBox">
          <stop offset="0%" stopColor="#ffe8d0" />
          <stop offset="30%" stopColor="#ffa050" />
          <stop offset="64%" stopColor="#ff4810" />
          <stop offset="100%" stopColor="#c01400" />
        </radialGradient>
        <radialGradient id="i3d-eye-iris" cx="38%" cy="32%" r="62%" gradientUnits="objectBoundingBox">
          <stop offset="0%" stopColor="#d03000" />
          <stop offset="100%" stopColor="#680800" />
        </radialGradient>
        <radialGradient id="i3d-eye-gloss" cx="36%" cy="22%" r="54%" gradientUnits="objectBoundingBox">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id="i3d-eye-shadow" x="-30%" y="-40%" width="160%" height="180%">
          <feDropShadow dx="0" dy="3" stdDeviation="3.5" floodColor="#b01000" floodOpacity="0.38" />
        </filter>
      </defs>
      <path
        d="M5 28 C10 16 21 13 28 13 C35 13 46 16 51 28 C46 40 35 43 28 43 C21 43 10 40 5 28 Z"
        fill="url(#i3d-eye-outer)"
        filter="url(#i3d-eye-shadow)"
      />
      <circle cx="28" cy="28" r="9" fill="url(#i3d-eye-iris)" />
      <circle cx="28" cy="28" r="5" fill="#2a0400" />
      <circle cx="24" cy="24" r="2.5" fill="white" fillOpacity="0.85" />
      <path d="M8 24 C14 17 26 15 36 17" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeOpacity="0.55" fill="none" />
      <ellipse cx="20" cy="20" rx="10" ry="5.5" fill="url(#i3d-eye-gloss)" />
    </svg>
  );
}

export function Icon3DArrowUser({ size = 52 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="i3d-au-fill" cx="35%" cy="26%" r="68%" gradientUnits="objectBoundingBox">
          <stop offset="0%" stopColor="#ffe8d0" />
          <stop offset="28%" stopColor="#ffa050" />
          <stop offset="63%" stopColor="#ff4810" />
          <stop offset="100%" stopColor="#c01400" />
        </radialGradient>
        <radialGradient id="i3d-au-gloss" cx="36%" cy="22%" r="52%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id="i3d-au-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#b01000" floodOpacity="0.35" />
        </filter>
      </defs>
      {/* Person head */}
      <circle cx="18" cy="15" r="8.5" fill="url(#i3d-au-fill)" filter="url(#i3d-au-shadow)" />
      <ellipse cx="14" cy="11" rx="5" ry="4" fill="url(#i3d-au-gloss)" />
      {/* Person body */}
      <path
        d="M4 42 C4 30 9 26 18 26 C22 26 26 27.5 29 30"
        stroke="url(#i3d-au-fill)" strokeWidth="0" fill="none"
      />
      <path
        d="M3 44 Q3 27 18 27 Q27 27 30 32 L26 32 Q22 29 18 29 Q7 29 7 44 Z"
        fill="url(#i3d-au-fill)"
        filter="url(#i3d-au-shadow)"
      />
      {/* Arrow pointing right */}
      <path
        d="M34 28 L50 28"
        stroke="url(#i3d-au-fill)" strokeWidth="0" fill="none"
      />
      <rect x="33" y="25.5" width="17" height="5" rx="2.5" fill="url(#i3d-au-fill)" filter="url(#i3d-au-shadow)" />
      <path
        d="M43 19 L53 28 L43 37"
        strokeWidth="0" fill="none"
      />
      <polygon points="42,18 54,28 42,38 46,28" fill="url(#i3d-au-fill)" filter="url(#i3d-au-shadow)" />
    </svg>
  );
}

export function Icon3DBolt({ size = 52 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="i3d-bolt-fill" cx="40%" cy="22%" r="72%" gradientUnits="objectBoundingBox">
          <stop offset="0%" stopColor="#fff4d0" />
          <stop offset="22%" stopColor="#ffc040" />
          <stop offset="55%" stopColor="#ff6010" />
          <stop offset="100%" stopColor="#c01400" />
        </radialGradient>
        <radialGradient id="i3d-bolt-gloss" cx="42%" cy="18%" r="48%" gradientUnits="objectBoundingBox">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id="i3d-bolt-shadow" x="-25%" y="-15%" width="150%" height="130%">
          <feDropShadow dx="0" dy="3" stdDeviation="3.5" floodColor="#b01000" floodOpacity="0.4" />
        </filter>
      </defs>
      <path
        d="M35 4 L18 30 H29 L21 52 L44 24 H31 Z"
        fill="url(#i3d-bolt-fill)"
        filter="url(#i3d-bolt-shadow)"
      />
      <path
        d="M35 4 L24 24 H33 L26 42 L42 22 H31 Z"
        fill="url(#i3d-bolt-gloss)"
      />
    </svg>
  );
}

export function Icon3DLock({ size = 52 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="i3d-lock-body" cx="35%" cy="28%" r="68%" gradientUnits="objectBoundingBox">
          <stop offset="0%" stopColor="#ffe8d0" />
          <stop offset="28%" stopColor="#ffa050" />
          <stop offset="62%" stopColor="#ff4810" />
          <stop offset="100%" stopColor="#c01400" />
        </radialGradient>
        <radialGradient id="i3d-lock-shackle" cx="40%" cy="25%" r="65%" gradientUnits="objectBoundingBox">
          <stop offset="0%" stopColor="#ffcc90" />
          <stop offset="50%" stopColor="#ff7830" />
          <stop offset="100%" stopColor="#aa1800" />
        </radialGradient>
        <radialGradient id="i3d-lock-gloss" cx="36%" cy="22%" r="50%" gradientUnits="objectBoundingBox">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id="i3d-lock-shadow" x="-20%" y="-15%" width="140%" height="135%">
          <feDropShadow dx="0" dy="3" stdDeviation="3.5" floodColor="#b01000" floodOpacity="0.38" />
        </filter>
      </defs>
      {/* Shackle arc */}
      <path
        d="M17 26 L17 18 Q17 8 28 8 Q39 8 39 18 L39 26"
        stroke="url(#i3d-lock-shackle)" strokeWidth="6" strokeLinecap="round" fill="none"
        filter="url(#i3d-lock-shadow)"
      />
      {/* Lock body */}
      <rect x="11" y="24" width="34" height="26" rx="5" fill="url(#i3d-lock-body)" filter="url(#i3d-lock-shadow)" />
      {/* Keyhole */}
      <circle cx="28" cy="35" r="5" fill="#7a0c00" />
      <rect x="25.5" y="35" width="5" height="8" rx="2" fill="#7a0c00" />
      {/* Gloss */}
      <ellipse cx="21" cy="30" rx="9" ry="5.5" fill="url(#i3d-lock-gloss)" />
    </svg>
  );
}

export function Icon3DStar({ size = 52 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="i3d-star-fill" cx="38%" cy="24%" r="68%" gradientUnits="objectBoundingBox">
          <stop offset="0%" stopColor="#fff4d0" />
          <stop offset="22%" stopColor="#ffc040" />
          <stop offset="56%" stopColor="#ff6010" />
          <stop offset="100%" stopColor="#c01400" />
        </radialGradient>
        <radialGradient id="i3d-star-gloss" cx="40%" cy="18%" r="50%" gradientUnits="objectBoundingBox">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id="i3d-star-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="3.5" floodColor="#b01000" floodOpacity="0.38" />
        </filter>
      </defs>
      {/* 4-pointed star (diamond arms) */}
      <path
        d="M28 4 L32 24 L52 28 L32 32 L28 52 L24 32 L4 28 L24 24 Z"
        fill="url(#i3d-star-fill)"
        filter="url(#i3d-star-shadow)"
      />
      {/* Small accent sparkle */}
      <path
        d="M44 10 L45.5 15 L51 16.5 L45.5 18 L44 23 L42.5 18 L37 16.5 L42.5 15 Z"
        fill="url(#i3d-star-fill)"
      />
      {/* Gloss */}
      <ellipse cx="22" cy="18" rx="9" ry="6" fill="url(#i3d-star-gloss)" />
    </svg>
  );
}

export function Icon3DShield({ size = 52 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="i3d-shield-fill" cx="36%" cy="26%" r="70%" gradientUnits="objectBoundingBox">
          <stop offset="0%" stopColor="#ffe8d0" />
          <stop offset="26%" stopColor="#ffa050" />
          <stop offset="62%" stopColor="#ff4810" />
          <stop offset="100%" stopColor="#c01400" />
        </radialGradient>
        <radialGradient id="i3d-shield-gloss" cx="36%" cy="20%" r="52%" gradientUnits="objectBoundingBox">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.82" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id="i3d-shield-shadow" x="-20%" y="-15%" width="140%" height="135%">
          <feDropShadow dx="0" dy="3" stdDeviation="3.5" floodColor="#b01000" floodOpacity="0.4" />
        </filter>
      </defs>
      <path
        d="M28 4 L48 12 L48 30 Q48 44 28 52 Q8 44 8 30 L8 12 Z"
        fill="url(#i3d-shield-fill)"
        filter="url(#i3d-shield-shadow)"
      />
      {/* Checkmark */}
      <path
        d="M18 28 L24 35 L38 20"
        stroke="#fff0e8" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" fill="none"
      />
      <ellipse cx="21" cy="17" rx="11" ry="7" fill="url(#i3d-shield-gloss)" />
    </svg>
  );
}
