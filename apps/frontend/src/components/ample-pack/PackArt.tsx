"use client";

/**
 * The Ample x Loofta foil pack. Pure SVG + CSS, no image assets besides the Loofta mark.
 * `state`: sealed (idle float + shimmer), ripping (shake, top tears off), open (top gone, light bursts out).
 */
export function PackArt({ state = "sealed", size = 300 }: { state?: "sealed" | "ripping" | "open"; size?: number }) {
  const w = size, h = size * 1.45;
  return (
    <div className={`apk apk-${state}`} style={{ width: w, height: h }}>
      <style>{`
        .apk{position:relative;perspective:900px;filter:drop-shadow(0 28px 36px rgba(255,90,40,.28))}
        .apk-sealed{animation:apk-float 4.2s ease-in-out infinite}
        .apk-ripping{animation:apk-shake .5s linear infinite}
        .apk svg{width:100%;height:100%;overflow:visible}
        .apk .sheen{animation:apk-sheen 3.4s ease-in-out infinite;mix-blend-mode:soft-light}
        .apk .top{transform-origin:0 0;transition:transform .7s cubic-bezier(.2,.8,.2,1),opacity .7s}
        .apk-ripping .top{transform:rotate(-8deg) translate(-4px,-10px)}
        .apk-open .top{transform:rotate(-38deg) translate(-70px,-150px);opacity:0}
        .apk .burst{opacity:0;transition:opacity .5s}
        .apk-open .burst{opacity:1}
        @keyframes apk-float{0%,100%{transform:translateY(0) rotateY(-6deg) rotateZ(-1.5deg)}50%{transform:translateY(-12px) rotateY(6deg) rotateZ(1.5deg)}}
        @keyframes apk-shake{0%,100%{transform:translate(0,0) rotate(0)}25%{transform:translate(-4px,2px) rotate(-1.5deg)}75%{transform:translate(4px,-2px) rotate(1.5deg)}}
        @keyframes apk-sheen{0%{transform:translateX(-140%)}60%,100%{transform:translateX(160%)}}
        @media (prefers-reduced-motion:reduce){.apk,.apk .sheen{animation:none!important}}
      `}</style>
      <svg viewBox="0 0 300 435" role="img" aria-label="Ample x Loofta pack">
        <defs>
          <linearGradient id="apk-body" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2A0F4A" /><stop offset=".45" stopColor="#120A24" /><stop offset="1" stopColor="#3A1208" />
          </linearGradient>
          <linearGradient id="apk-foil" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#FF4A26" /><stop offset=".5" stopColor="#FFB020" /><stop offset="1" stopColor="#FF4A26" />
          </linearGradient>
          <linearGradient id="apk-edge" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FFE9A8" /><stop offset=".5" stopColor="#FF8A3A" /><stop offset="1" stopColor="#B0300F" />
          </linearGradient>
          <radialGradient id="apk-glow" cx=".5" cy=".5" r=".5">
            <stop offset="0" stopColor="#FFD36A" stopOpacity=".95" /><stop offset="1" stopColor="#FF4A26" stopOpacity="0" />
          </radialGradient>
          <clipPath id="apk-clip"><path d="M14 40 l14 -10 l14 10 l14 -10 l14 10 l14 -10 l14 10 l14 -10 l14 10 l14 -10 l14 10 l14 -10 l14 10 l14 -10 l14 10 l14 -10 l14 10 l14 -10 l14 10 l14 -10 l14 10 V405 l-14 10 l-14 -10 l-14 10 l-14 -10 l-14 10 l-14 -10 l-14 10 l-14 -10 l-14 10 l-14 -10 l-14 10 l-14 -10 l-14 10 l-14 -10 l-14 10 l-14 -10 l-14 10 l-14 -10 l-14 10 l-14 -10 Z" /></clipPath>
        </defs>

        <circle className="burst" cx="150" cy="150" r="170" fill="url(#apk-glow)" />

        <g clipPath="url(#apk-clip)">
          <rect x="0" y="0" width="300" height="435" fill="url(#apk-body)" />
          {/* foil stripes */}
          {Array.from({ length: 9 }).map((_, i) => (
            <rect key={i} x={-40 + i * 44} y="-20" width="14" height="500" fill="url(#apk-foil)" opacity=".13" transform="rotate(18 150 217)" />
          ))}
          {/* orbit rings */}
          <circle cx="150" cy="205" r="104" fill="none" stroke="url(#apk-edge)" strokeWidth="1.5" opacity=".6" />
          <circle cx="150" cy="205" r="124" fill="none" stroke="#fff" strokeOpacity=".12" strokeDasharray="2 7" />
          {/* sparkles */}
          {[[48, 96, 5], [250, 120, 4], [60, 330, 4], [244, 300, 6], [214, 70, 3], [92, 380, 3]].map(([x, y, r], i) => (
            <path key={i} d={`M${x} ${y - r * 2} L${x + r * .5} ${y - r * .5} L${x + r * 2} ${y} L${x + r * .5} ${y + r * .5} L${x} ${y + r * 2} L${x - r * .5} ${y + r * .5} L${x - r * 2} ${y} L${x - r * .5} ${y - r * .5} Z`} fill="#FFE9A8" opacity=".85" />
          ))}

          {/* Loofta mark, centre */}
          <circle cx="150" cy="205" r="72" fill="#0B0614" stroke="url(#apk-edge)" strokeWidth="3" />
          <image href="/images/logo/icon_nobg_loofta.svg" x="102" y="157" width="96" height="96" />

          {/* x */}
          <text x="150" y="312" textAnchor="middle" fontSize="22" fontWeight="800" fill="#FFE9A8" fontFamily="system-ui,sans-serif">×</text>
          {/* ample wordmark */}
          <text x="150" y="352" textAnchor="middle" fontSize="38" fontWeight="800" letterSpacing="-1.5" fill="#fff" fontFamily="system-ui,sans-serif">ample</text>
          <text x="150" y="378" textAnchor="middle" fontSize="11" fontWeight="700" letterSpacing="4" fill="#FFB020" fontFamily="system-ui,sans-serif">FREE PACK</text>

          {/* top crimp, tears off when ripping */}
          <g className="top">
            <rect x="0" y="0" width="300" height="62" fill="url(#apk-edge)" />
            {Array.from({ length: 25 }).map((_, i) => <rect key={i} x={i * 12 + 3} y="0" width="3" height="62" fill="#000" opacity=".22" />)}
            <text x="150" y="40" textAnchor="middle" fontSize="12" fontWeight="800" letterSpacing="5" fill="#2A0F0A" fontFamily="system-ui,sans-serif">TEAR HERE</text>
          </g>

          {/* moving sheen */}
          <rect className="sheen" x="-60" y="0" width="90" height="435" fill="#fff" opacity=".55" transform="skewX(-18)" />
        </g>
        <path d="M14 40 l14 -10 l14 10 l14 -10 l14 10 l14 -10 l14 10 l14 -10 l14 10 l14 -10 l14 10 l14 -10 l14 10 l14 -10 l14 10 l14 -10 l14 10 l14 -10 l14 10 l14 -10 l14 10 V405" fill="none" stroke="#fff" strokeOpacity=".18" />
      </svg>
    </div>
  );
}
