/**
 * Generates the Mystery Pack's foil/ticket art as real raster textures for the Three.js scene in
 * MegapotPackGL.tsx — React Native has no Canvas 2D API (what the web version's packArt()/
 * ticketFront() etc. use), so this renders the same design as declarative react-native-skia
 * elements (a real native 2D graphics engine) via `drawAsImage`, then reads the rasterized pixels
 * back out as a plain RGBA buffer for `THREE.DataTexture`. Path strings for the sparkle/crimp
 * shapes are the same SVG-path math already used in MysteryPack.tsx (the non-3D fallback), just
 * fed into Skia's <Path> instead of react-native-svg's. Logo SVGs are inlined from
 * apps/frontend/public (loofta.svg, loofta_white.svg, images/megapot/logo.svg) and rasterized via
 * Skia's own SVG renderer (`Skia.SVG.MakeFromString` + `<ImageSVG>`) — no PNG export step needed.
 *
 * Simplification vs the web version (first pass — revisit once confirmed working on-device): no
 * crinkle bump map (the foil renders smooth/glossy rather than crinkled).
 */
import React from 'react';
import {
  Skia,
  drawAsImage,
  vec,
  Group,
  Rect,
  RoundedRect,
  Circle,
  Path,
  Text as SkiaText,
  ImageSVG,
  LinearGradient,
  RadialGradient,
  FontStyle,
  AlphaType,
  ColorType,
} from '@shopify/react-native-skia';

export const ART_W = 760;
export const ART_H = 1120;

async function imageToRgba(image: { readPixels: (x: number, y: number, info: any) => any } | null, width: number, height: number): Promise<Uint8Array> {
  if (!image) throw new Error('Skia failed to rasterize pack texture');
  const pixels = image.readPixels(0, 0, { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  return pixels instanceof Uint8Array ? pixels : new Uint8Array(pixels?.buffer ?? new ArrayBuffer(width * height * 4));
}

// `Skia.Font(undefined, size)` crashes ("Value is undefined, expected an Object") — its native
// constructor branches on JS argument COUNT, and an explicitly-passed `undefined` still counts as
// an argument, so it tries (and fails) to unwrap a typeface from it. `Skia.Font()` with zero args
// takes the default-constructor branch instead, but THAT font has no typeface bound at all, so it
// silently draws no glyphs — needs a real typeface from the system font manager.
//
// Resolved eagerly at module load (not lazily on first use) — the 5 texture generators below all
// run concurrently via Promise.all from MegapotPackGL, each on its own Skia offscreen-render pass;
// a lazy "compute once, cache" pattern would race if two of those passes called defaultFont()
// before the first one finished writing the cache.
const SYSTEM_TYPEFACE = Skia.FontMgr.System().matchFamilyStyle('sans-serif', FontStyle.Normal);
function defaultFont(size: number) {
  return Skia.Font(SYSTEM_TYPEFACE, size);
}

// ---- brand logos, inlined from apps/frontend/public so no PNG export step is needed ----
// The loofta WHITE wordmark is 3671x1026 natively — scaling it down to pack/ticket size (a
// ~12-20x downscale) via Skia.XYWHRect at DRAW time rendered as a huge, unscaled fragment of a
// single letterform (a smooth rounded blob) instead of the whole wordmark, even though the same
// `rect` approach works for the Megapot logo's much more modest ~3x downscale. Fix: bake the
// FINAL target width/height directly into the SVG markup's own <svg width height> attributes
// (keeping the same viewBox, so the artwork itself is unchanged) so Skia's SVG parser computes
// the viewBox→size scale once at parse time — a completely different, apparently more robust code
// path than asking `rect` to scale an already-parsed 3671-native SVG down at draw time. Cached
// per distinct target width since each caller needs a different final size.
const LOOFTA_WHITE_PATHS = `<path d="M3209.39 1022.06C3144.58 1022.06 3093.78 1004.54 3057 969.51C3021.09 934.479 3003.13 885.434 3003.13 822.376C3003.13 759.319 3024.15 713.777 3066.19 685.751C3108.23 656.85 3162.09 642.399 3227.78 642.399C3266.31 642.399 3301.34 645.027 3332.87 650.282C3364.4 655.536 3392.87 662.981 3418.26 672.614H3422.2V652.909C3422.2 632.766 3414.76 617.001 3399.87 605.616C3384.98 593.355 3366.15 587.662 3343.38 588.538C3321.49 588.538 3302.66 589.851 3286.89 592.479C3272.01 595.106 3253.18 599.485 3230.4 605.616C3188.37 616.125 3152.02 615.25 3121.37 602.988C3090.71 590.727 3069.7 566.643 3058.31 530.735C3047.8 493.076 3049.99 461.547 3064.88 436.149C3080.64 410.751 3104.29 391.045 3135.82 377.032C3162.97 363.895 3193.18 352.948 3226.46 344.19C3260.62 335.432 3297.4 331.053 3336.81 331.053C3451.54 331.053 3535.62 359.078 3589.04 415.129C3643.34 470.305 3670.49 563.14 3670.49 693.634V897.257C3670.49 933.165 3659.55 962.942 3637.65 986.589C3615.76 1010.24 3585.54 1022.06 3547.01 1022.06C3504.97 1022.06 3473.44 1010.24 3452.42 986.589C3432.28 962.942 3422.2 934.041 3422.2 899.884V869.669H3395.93C3395.93 892.44 3391.55 915.649 3382.79 939.295C3374.91 962.942 3357.83 982.647 3331.56 998.412C3306.16 1014.18 3265.44 1022.06 3209.39 1022.06ZM3222.52 734.358C3222.52 749.247 3227.78 759.757 3238.29 765.887C3249.67 772.018 3273.76 775.083 3310.54 775.083C3343.82 775.083 3367.03 772.018 3380.17 765.887C3393.3 759.757 3399.87 749.247 3399.87 734.358C3399.87 720.346 3393.3 710.712 3380.17 705.457C3367.03 699.326 3343.82 696.261 3310.54 696.261C3273.76 696.261 3249.67 699.326 3238.29 705.457C3227.78 710.712 3222.52 720.346 3222.52 734.358Z" fill="white"/>
<path d="M2714.71 1026C2668.29 1026 2626.25 1015.49 2588.59 994.474C2551.81 973.455 2522.91 943.678 2501.89 905.143C2480.87 865.732 2470.36 819.752 2470.36 767.204V535.993L2421.75 542.562C2395.48 546.065 2372.27 536.869 2352.13 514.974C2331.98 493.079 2321.91 465.491 2321.91 432.211C2321.91 398.931 2331.98 371.781 2352.13 350.762C2372.27 328.867 2395.48 319.671 2421.75 323.174L2470.36 329.743L2469.04 240.411C2468.17 205.379 2478.24 177.791 2499.26 157.648C2520.28 136.629 2550.93 126.119 2591.22 126.119C2631.51 126.119 2662.6 136.629 2684.49 157.648C2706.39 177.791 2716.46 205.379 2714.71 240.411L2712.08 329.743L2781.7 320.547C2829 313.54 2864.91 322.298 2889.43 346.821C2913.95 370.467 2926.21 398.931 2926.21 432.211C2926.21 465.491 2913.95 494.393 2889.43 518.915C2865.78 542.562 2831.19 551.32 2785.65 545.189L2712.08 535.993V731.734C2712.08 743.12 2716.02 753.629 2723.9 763.263C2731.78 772.021 2741.42 774.649 2752.8 771.145C2765.94 767.642 2779.52 760.198 2793.53 748.812C2808.42 737.427 2827.25 731.734 2850.02 731.734C2884.17 731.734 2910.45 743.996 2928.84 768.518C2947.23 793.04 2956.43 823.255 2956.43 859.163C2956.43 887.189 2946.35 914.339 2926.21 940.612C2906.94 966.011 2879.36 986.592 2843.45 1002.36C2807.54 1018.12 2764.63 1026 2714.71 1026Z" fill="white"/>
<path d="M1970.59 1022.06C1933.81 1022.06 1903.59 1010.67 1879.94 987.902C1857.17 964.255 1845.79 934.916 1845.79 899.884V606.929C1823.02 612.184 1802.44 609.118 1784.04 597.733C1765.65 586.348 1750.76 569.27 1739.38 546.499C1728.87 523.728 1723.61 498.768 1723.61 471.618C1723.61 444.468 1729.31 419.508 1740.69 396.737C1752.08 373.091 1766.97 355.137 1785.36 342.875C1804.63 330.614 1825.64 327.987 1848.42 334.993C1852.79 270.184 1863.3 212.819 1879.94 162.899C1896.58 112.102 1921.98 72.2535 1956.14 43.3521C1991.17 14.4507 2036.71 0 2092.76 0C2140.93 0 2179.47 10.0717 2208.37 30.2151C2237.27 49.4827 2257.41 73.5672 2268.8 102.469C2281.06 131.37 2285 160.709 2280.62 190.486C2276.24 219.388 2264.42 244.786 2245.15 266.681C2225.89 287.7 2197.42 298.21 2159.76 298.21C2133.49 298.21 2111.59 292.955 2094.08 282.445C2076.56 271.936 2061.67 259.237 2049.41 244.348C2038.03 228.584 2027.95 213.695 2019.2 199.682C1997.3 164.65 1974.97 152.827 1952.2 164.212C1940.81 170.343 1934.68 180.415 1933.81 194.427C1932.93 207.564 1937.31 222.891 1946.94 240.407L1975.84 290.327C1990.73 314.85 2006.5 331.052 2023.14 338.934C2039.78 345.941 2060.8 347.692 2086.2 344.189L2149.25 334.993C2189.54 328.863 2222.38 339.81 2247.78 367.836C2273.18 395.861 2285.88 430.455 2285.88 471.618C2285.88 514.532 2272.74 549.126 2246.47 575.4C2221.07 600.798 2189.54 611.308 2151.88 606.929L2096.7 600.36V899.884C2096.7 934.916 2085.32 964.255 2062.55 987.902C2039.78 1010.67 2009.12 1022.06 1970.59 1022.06Z" fill="white"/>
<path d="M1379.31 1024.68C1276.84 1024.68 1194.96 994.468 1133.65 934.038C1073.22 872.732 1043 786.466 1043 675.239C1043 606.927 1057.02 546.935 1085.04 495.262C1113.07 443.59 1152.04 403.303 1201.96 374.402C1252.76 344.625 1311.88 329.736 1379.31 329.736C1454.63 329.736 1517.25 344.625 1567.17 374.402C1617.09 403.303 1654.31 443.59 1678.84 495.262C1704.23 546.935 1716.93 606.927 1716.93 675.239C1716.93 786.466 1688.91 872.732 1632.86 934.038C1577.68 994.468 1493.17 1024.68 1379.31 1024.68ZM1199.34 652.906C1199.34 680.056 1212.91 699.324 1240.06 710.709C1267.21 721.219 1313.63 726.473 1379.31 726.473C1445 726.473 1491.41 721.219 1518.56 710.709C1545.71 699.324 1559.29 680.056 1559.29 652.906C1559.29 626.632 1545.71 608.24 1518.56 597.731C1491.41 587.221 1445 581.966 1379.31 581.966C1313.63 581.966 1267.21 587.221 1240.06 597.731C1212.91 608.24 1199.34 626.632 1199.34 652.906Z" fill="white"/>
<path d="M646.771 1024.68C544.302 1024.68 462.415 994.468 401.109 934.038C340.679 872.732 310.464 786.466 310.464 675.239C310.464 606.927 324.477 546.935 352.502 495.262C380.528 443.59 419.501 403.303 469.421 374.402C520.218 344.625 579.334 329.736 646.771 329.736C722.09 329.736 784.709 344.625 834.63 374.402C884.55 403.303 921.772 443.59 946.294 495.262C971.692 546.935 984.391 606.927 984.391 675.239C984.391 786.466 956.366 872.732 900.315 934.038C845.139 994.468 760.625 1024.68 646.771 1024.68ZM466.794 652.906C466.794 680.056 480.369 699.324 507.519 710.709C534.668 721.219 581.086 726.473 646.771 726.473C712.456 726.473 758.873 721.219 786.023 710.709C813.173 699.324 826.747 680.056 826.747 652.906C826.747 626.632 813.173 608.24 786.023 597.731C758.873 587.221 712.456 581.966 646.771 581.966C581.086 581.966 534.668 587.221 507.519 597.731C480.369 608.24 466.794 626.632 466.794 652.906Z" fill="white"/>
<path d="M128.743 1022.06C85.8283 1022.06 53.4238 1010.67 31.5288 987.903C10.5096 965.132 0 936.669 0 902.513V140.567C0 102.908 10.5096 71.8169 31.5288 47.2945C53.4238 21.8963 85.8283 9.19727 128.743 9.19727C167.278 9.19727 197.055 21.8963 218.074 47.2945C239.093 71.8169 249.603 102.032 249.603 137.94V902.513C249.603 936.669 239.093 965.132 218.074 987.903C197.055 1010.67 167.278 1022.06 128.743 1022.06Z" fill="white"/>`;

const _looftaWhiteBySize = new Map<number, ReturnType<(typeof Skia)['SVG']['MakeFromString']>>();
function looftaWhiteSvgAt(targetWidth: number) {
  let svg = _looftaWhiteBySize.get(targetWidth);
  if (!svg) {
    const targetHeight = (targetWidth * 1026) / 3671;
    svg = Skia.SVG.MakeFromString(
      `<svg width="${targetWidth}" height="${targetHeight}" viewBox="0 0 3671 1026" fill="none" xmlns="http://www.w3.org/2000/svg">${LOOFTA_WHITE_PATHS}</svg>`,
    );
    _looftaWhiteBySize.set(targetWidth, svg);
  }
  return svg;
}

const LOOFTA_ORANGE_SVG = `<svg width="179" height="50" viewBox="0 0 179 50" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M156.353 49.7919C153.195 49.7919 150.721 48.9386 148.929 47.2319C147.179 45.5253 146.305 43.1359 146.305 40.0639C146.305 36.9919 147.329 34.7733 149.377 33.4079C151.425 31.9999 154.049 31.2959 157.249 31.2959C159.126 31.2959 160.833 31.4239 162.369 31.6799C163.905 31.9359 165.291 32.2986 166.529 32.7679H166.721V31.8079C166.721 30.8266 166.358 30.0586 165.633 29.5039C164.907 28.9066 163.99 28.6293 162.881 28.6719C161.814 28.6719 160.897 28.7359 160.129 28.8639C159.403 28.9919 158.486 29.2053 157.377 29.5039C155.329 30.0159 153.558 29.9733 152.065 29.3759C150.571 28.7786 149.547 27.6053 148.993 25.8559C148.481 24.0213 148.587 22.4853 149.313 21.2479C150.081 20.0106 151.233 19.0506 152.769 18.3679C154.091 17.7279 155.563 17.1946 157.185 16.7679C158.849 16.3413 160.641 16.1279 162.561 16.1279C168.15 16.1279 172.246 17.4933 174.849 20.2239C177.494 22.9119 178.817 27.4346 178.817 33.7919V43.7119C178.817 45.4613 178.283 46.9119 177.217 48.0639C176.15 49.2159 174.678 49.7919 172.801 49.7919C170.753 49.7919 169.217 49.2159 168.193 48.0639C167.211 46.9119 166.721 45.5039 166.721 43.8399V42.3679H165.441C165.441 43.4773 165.227 44.6079 164.801 45.7599C164.417 46.9119 163.585 47.8719 162.305 48.6399C161.067 49.4079 159.083 49.7919 156.353 49.7919ZM156.993 35.7759C156.993 36.5013 157.249 37.0133 157.761 37.3119C158.315 37.6106 159.489 37.7599 161.281 37.7599C162.902 37.7599 164.033 37.6106 164.673 37.3119C165.313 37.0133 165.633 36.5013 165.633 35.7759C165.633 35.0933 165.313 34.6239 164.673 34.3679C164.033 34.0693 162.902 33.9199 161.281 33.9199C159.489 33.9199 158.315 34.0693 157.761 34.3679C157.249 34.6239 156.993 35.0933 156.993 35.7759Z" fill="#FF4A26"/>
<path d="M132.253 49.984C129.992 49.984 127.944 49.472 126.109 48.448C124.317 47.424 122.909 45.9734 121.885 44.096C120.861 42.176 120.349 39.936 120.349 37.376V26.112L117.981 26.432C116.701 26.6027 115.571 26.1547 114.589 25.088C113.608 24.0214 113.117 22.6774 113.117 21.056C113.117 19.4347 113.608 18.112 114.589 17.088C115.571 16.0214 116.701 15.5734 117.981 15.744L120.349 16.064L120.285 11.712C120.243 10.0054 120.733 8.66138 121.757 7.68004C122.781 6.65604 124.275 6.14404 126.237 6.14404C128.2 6.14404 129.715 6.65604 130.781 7.68004C131.848 8.66138 132.339 10.0054 132.253 11.712L132.125 16.064L135.517 15.616C137.821 15.2747 139.571 15.7014 140.765 16.896C141.96 18.048 142.557 19.4347 142.557 21.056C142.557 22.6774 141.96 24.0854 140.765 25.28C139.613 26.432 137.928 26.8587 135.709 26.56L132.125 26.112V35.648C132.125 36.2027 132.317 36.7147 132.701 37.184C133.085 37.6107 133.555 37.7387 134.109 37.568C134.749 37.3974 135.411 37.0347 136.093 36.48C136.819 35.9254 137.736 35.648 138.845 35.648C140.509 35.648 141.789 36.2454 142.685 37.44C143.581 38.6347 144.029 40.1067 144.029 41.856C144.029 43.2214 143.539 44.544 142.557 45.824C141.619 47.0614 140.275 48.064 138.525 48.832C136.776 49.6 134.685 49.984 132.253 49.984Z" fill="#FF4A26"/>
<path d="M96.0017 49.792C94.2097 49.792 92.7377 49.2373 91.5857 48.128C90.4764 46.976 89.9217 45.5467 89.9217 43.84V29.568C88.8124 29.824 87.8097 29.6747 86.9137 29.12C86.0177 28.5653 85.2924 27.7333 84.7377 26.624C84.2257 25.5147 83.9697 24.2987 83.9697 22.976C83.9697 21.6533 84.2471 20.4373 84.8017 19.328C85.3564 18.176 86.0817 17.3013 86.9777 16.704C87.9164 16.1067 88.9404 15.9787 90.0497 16.32C90.2631 13.1627 90.7751 10.368 91.5857 7.936C92.3964 5.46134 93.6337 3.52 95.2977 2.112C97.0044 0.704 99.2231 0 101.954 0C104.3 0 106.178 0.490667 107.586 1.472C108.994 2.41067 109.975 3.584 110.53 4.992C111.127 6.4 111.319 7.82933 111.106 9.28C110.892 10.688 110.316 11.9253 109.378 12.992C108.439 14.016 107.052 14.528 105.218 14.528C103.938 14.528 102.871 14.272 102.018 13.76C101.164 13.248 100.439 12.6293 99.8417 11.904C99.2871 11.136 98.7964 10.4107 98.3697 9.728C97.3031 8.02134 96.2151 7.44534 95.1057 8C94.5511 8.29867 94.2524 8.78933 94.2097 9.472C94.1671 10.112 94.3804 10.8587 94.8497 11.712L96.2577 14.144C96.9831 15.3387 97.7511 16.128 98.5617 16.512C99.3724 16.8533 100.396 16.9387 101.634 16.768L104.706 16.32C106.668 16.0213 108.268 16.5547 109.506 17.92C110.743 19.2853 111.362 20.9707 111.362 22.976C111.362 25.0667 110.722 26.752 109.442 28.032C108.204 29.2693 106.668 29.7813 104.834 29.568L102.146 29.248V43.84C102.146 45.5467 101.591 46.976 100.482 48.128C99.3724 49.2373 97.8791 49.792 96.0017 49.792Z" fill="#FF4A26"/>
<path d="M67.1965 49.92C62.2045 49.92 58.2152 48.448 55.2285 45.504C52.2845 42.5173 50.8125 38.3146 50.8125 32.896C50.8125 29.568 51.4952 26.6453 52.8605 24.128C54.2258 21.6106 56.1245 19.648 58.5565 18.24C61.0312 16.7893 63.9112 16.064 67.1965 16.064C70.8658 16.064 73.9165 16.7893 76.3485 18.24C78.7805 19.648 80.5938 21.6106 81.7885 24.128C83.0258 26.6453 83.6445 29.568 83.6445 32.896C83.6445 38.3146 82.2792 42.5173 79.5485 45.504C76.8605 48.448 72.7432 49.92 67.1965 49.92ZM58.4285 31.808C58.4285 33.1306 59.0898 34.0693 60.4125 34.624C61.7352 35.136 63.9965 35.392 67.1965 35.392C70.3965 35.392 72.6578 35.136 73.9805 34.624C75.3032 34.0693 75.9645 33.1306 75.9645 31.808C75.9645 30.528 75.3032 29.632 73.9805 29.12C72.6578 28.608 70.3965 28.352 67.1965 28.352C63.9965 28.352 61.7352 28.608 60.4125 29.12C59.0898 29.632 58.4285 30.528 58.4285 31.808Z" fill="#FF4A26"/>
<path d="M31.509 49.92C26.517 49.92 22.5277 48.448 19.541 45.504C16.597 42.5173 15.125 38.3146 15.125 32.896C15.125 29.568 15.8077 26.6453 17.173 24.128C18.5383 21.6106 20.437 19.648 22.869 18.24C25.3437 16.7893 28.2237 16.064 31.509 16.064C35.1783 16.064 38.229 16.7893 40.661 18.24C43.093 19.648 44.9063 21.6106 46.101 24.128C47.3383 26.6453 47.957 29.568 47.957 32.896C47.957 38.3146 46.5917 42.5173 43.861 45.504C41.173 48.448 37.0557 49.92 31.509 49.92ZM22.741 31.808C22.741 33.1306 23.4023 34.0693 24.725 34.624C26.0477 35.136 28.309 35.392 31.509 35.392C34.709 35.392 36.9703 35.136 38.293 34.624C39.6157 34.0693 40.277 33.1306 40.277 31.808C40.277 30.528 39.6157 29.632 38.293 29.12C36.9703 28.608 34.709 28.352 31.509 28.352C28.309 28.352 26.0477 28.608 24.725 29.12C23.4023 29.632 22.741 30.528 22.741 31.808Z" fill="#FF4A26"/>
<path d="M6.272 49.792C4.18133 49.792 2.60267 49.2373 1.536 48.128C0.512 47.0187 0 45.632 0 43.968V6.848C0 5.01333 0.512 3.49866 1.536 2.304C2.60267 1.06666 4.18133 0.447998 6.272 0.447998C8.14933 0.447998 9.6 1.06666 10.624 2.304C11.648 3.49866 12.16 4.97066 12.16 6.72V43.968C12.16 45.632 11.648 47.0187 10.624 48.128C9.6 49.2373 8.14933 49.792 6.272 49.792Z" fill="#FF4A26"/>
</svg>`;

// Same extreme-downscale caveat as the loofta white wordmark above turned out to also affect this
// logo — `rect`-based scaling was believed to work here (~3x, "modest") from earlier isolated
// testing, but rendering it in place on the actual badge showed it drawing at ~native 658px size,
// blowing way past its 210px-wide badge plate. Baking the target size into the markup fixes it the
// same way; see looftaWhiteSvgAt() above.
const MEGAPOT_LOGO_PATHS = `<path d="M203.158 25.9583L209.695 2.73978L146.855 2.73977L113.189 122.51L176.028 122.51L182.565 99.2901L150.206 99.2901L157.804 72.2298L184.609 72.2298L191.065 48.9264L164.26 48.9264L170.798 25.9583L203.158 25.9583Z" fill="#111827"/>
<path d="M285.289 17.6461C282.866 12.2185 278.738 8.02887 272.909 5.07712C267.08 2.1269 259.835 0.651021 251.173 0.651021C243.166 0.65102 236.261 2.01563 230.459 4.7433C224.657 7.47252 219.932 11.231 216.281 16.0188C212.632 20.808 209.909 26.4595 208.111 32.9736L196.098 76.488C193.265 86.4003 192.817 94.9605 194.749 102.17C196.682 109.382 200.837 114.921 207.211 118.792C213.584 122.662 221.973 124.597 232.379 124.597C238.806 124.597 244.923 123.817 250.725 122.259C256.526 120.701 261.334 118.695 265.147 116.246L281.327 58.0311L238.754 58.0311L232.544 80.248L245.536 80.248L240.184 99.2027C239.664 99.4128 239.133 99.5968 238.591 99.7513C237.12 100.167 235.567 100.377 233.932 100.377C231.425 100.377 229.369 99.793 227.764 98.6232C226.155 97.4533 225.12 95.8121 224.657 93.6947C224.195 91.5791 224.371 89.0183 225.188 86.011L239.652 34.4788C240.304 32.2519 241.041 30.4005 241.858 28.9245C242.674 27.4486 243.668 26.3499 244.842 25.625C246.011 24.9017 247.415 24.5386 249.049 24.5386C251.828 24.5386 253.733 25.472 254.768 27.3358C255.803 29.2027 255.967 31.6939 255.259 34.8111L252.48 44.7497L284.592 44.7497L286.798 36.6486C288.215 29.4099 287.714 23.0767 285.289 17.6461Z" fill="#111827"/>
<path d="M321.5 2.73978L268.222 122.51L300.091 122.51L309.798 98.0383L326.356 98.0383L322.48 122.51L353.532 122.51L366.606 2.73979L321.5 2.73978ZM330.175 74.3176L319.245 74.3176L337.34 28.8187L330.175 74.3176Z" fill="#111827"/>
<path d="M456.101 22.369C454.874 16.1332 451.906 11.3022 447.194 7.8791C442.48 4.4529 436.121 2.74211 428.114 2.74211L393.875 2.74211L360.208 122.512L390.689 122.512L402.62 79.9993L409.24 79.9993C417.683 79.9993 424.834 78.8033 430.69 76.4078C436.544 74.0139 441.38 70.3528 445.194 65.4245C449.007 60.4976 451.948 54.1645 454.02 46.4236L454.592 44.1687C456.825 35.8729 457.325 28.6064 456.101 22.369ZM425.661 38.99L424.026 44.7529C422.719 49.4293 421.016 52.8417 418.92 54.9851C416.821 57.1287 414.002 58.1997 410.461 58.1997L408.745 58.1997L418.225 24.4568L419.859 24.4568C421.982 24.4568 423.629 24.9576 424.803 25.9606C425.973 26.9636 426.641 28.5492 426.804 30.722C426.968 32.8934 426.587 35.6504 425.661 38.99Z" fill="#111827"/>
<path d="M586.5 2.74211L579.472 27.8815L599.982 27.8815L573.344 122.512L603.823 122.512L630.381 27.8815L650.891 27.8815L658 2.74212L586.5 2.74211Z" fill="#111827"/>
<path d="M95.6059 2.73977L64.4273 76.0345L74.5244 2.73977L33.6659 2.73977L-4.87825e-06 122.51L27.0479 122.51L47.9043 48.3298L38.8141 122.51L64.4726 122.51L97.3614 46.9111L76.0757 122.51L103.368 122.51L137.036 2.73977L95.6059 2.73977Z" fill="#111827"/>
<path d="M519.087 -6.07209e-06C485.317 -7.94346e-06 457.94 27.9814 457.94 62.5C457.94 97.0186 485.316 125 519.087 125C552.859 125 580.234 97.0186 580.234 62.5C580.234 27.9814 552.859 -4.20055e-06 519.087 -6.07209e-06ZM536.809 116.08C527.222 90.5294 496.846 80.7747 474.683 96.1285C495.494 78.9124 495.186 46.3705 474.05 29.5717C496.499 44.4819 526.683 34.1245 535.784 8.38856C528.847 34.82 547.811 60.9608 574.571 61.8541C547.834 63.2789 529.371 89.7922 536.809 116.08Z" fill="#111827"/>`;

const _megapotLogoBySize = new Map<number, ReturnType<(typeof Skia)['SVG']['MakeFromString']>>();
function megapotLogoSvgAt(targetWidth: number) {
  let svg = _megapotLogoBySize.get(targetWidth);
  if (!svg) {
    const targetHeight = (targetWidth * 125) / 658;
    svg = Skia.SVG.MakeFromString(
      `<svg width="${targetWidth}" height="${targetHeight}" viewBox="0 0 658 125" fill="none" xmlns="http://www.w3.org/2000/svg">${MEGAPOT_LOGO_PATHS}</svg>`,
    );
    _megapotLogoBySize.set(targetWidth, svg);
  }
  return svg;
}

let _looftaOrange: ReturnType<(typeof Skia)['SVG']['MakeFromString']>;
function looftaOrangeSvg() {
  if (!_looftaOrange) _looftaOrange = Skia.SVG.MakeFromString(LOOFTA_ORANGE_SVG);
  return _looftaOrange;
}

/** Four-point sparkle path, same math as MysteryPack.tsx's Sparkle. */
function sparklePath(cx: number, cy: number, r: number): string {
  return (
    `M ${cx} ${cy - r} Q ${cx + r * 0.16} ${cy - r * 0.16} ${cx + r} ${cy}` +
    ` Q ${cx + r * 0.16} ${cy + r * 0.16} ${cx} ${cy + r}` +
    ` Q ${cx - r * 0.16} ${cy + r * 0.16} ${cx - r} ${cy}` +
    ` Q ${cx - r * 0.16} ${cy - r * 0.16} ${cx} ${cy - r} Z`
  );
}

/** Serrated heat-seal band path, same math as MysteryPack.tsx's Crimp. */
function crimpPath(y: number, h: number, dir: 1 | -1): string {
  const teeth = 30,
    tw = ART_W / teeth;
  const base = dir > 0 ? y + h : y,
    tip = base + dir * 15;
  let d = `M 0 ${base}`;
  for (let i = 0; i < teeth; i++) d += ` L ${i * tw + tw / 2} ${tip} L ${(i + 1) * tw} ${base}`;
  return d + ' Z';
}

/** <ImageSVG>'s flat x/y/width/height props do NOT reliably scale the SVG to fit — logos were
 *  coming out ~3x oversized and cut off mid-word. Passing an explicit `rect` (via Skia.XYWHRect)
 *  instead fixes that for modest downscale ratios (confirmed working for the Megapot logo, ~3x).
 *  For extreme ratios (~12-20x, the loofta white wordmark) `rect` alone isn't enough — see
 *  looftaWhiteSvgAt() above, which bakes the target size into the SVG markup itself so `rect`
 *  here ends up a no-op passthrough rather than doing the actual downscaling. */
function SvgAt({ svg, x, y, width, height }: { svg: ReturnType<(typeof Skia)['SVG']['MakeFromString']>; x: number; y: number; width: number; height: number }) {
  if (!svg) return null;
  return <ImageSVG svg={svg} rect={Skia.XYWHRect(x, y, width, height)} />;
}

function Crimp({ y, h, dir }: { y: number; h: number; dir: 1 | -1 }) {
  const ridges: number[] = [];
  for (let i = 0; i < ART_W; i += 9) ridges.push(i);
  return (
    <Group>
      <Rect x={0} y={y} width={ART_W} height={h} color="#4A0C02" opacity={0.28} />
      {ridges.map((i) => (
        <Rect key={i} x={i} y={y} width={3} height={h} color="#fff" opacity={0.18} />
      ))}
      <Path path={crimpPath(y, h, dir)} color="#4A0C02" opacity={0.28} />
    </Group>
  );
}

function Sparkle({ cx, cy, r, o = 1 }: { cx: number; cy: number; r: number; o?: number }) {
  return <Path path={sparklePath(cx, cy, r)} color="#fff" opacity={o} />;
}

/** Skia's <Text> x/y is the baseline-left origin, not centered — measures the real glyph width
 *  at this font/size so it lands exactly centered on `cx`, instead of an eyeballed offset. */
function CenteredText({ cx, y, text, size, color }: { cx: number; y: number; text: string; size: number; color: string }) {
  const font = defaultFont(size);
  const width = font.measureText(text).width;
  return <SkiaText x={cx - width / 2} y={y} text={text} font={font} color={color} />;
}

/** Small white rounded plate with the Megapot wordmark centered in it, matching web's bottom
 *  badge exactly — web uses a fixed logo width per badge size (210 on the 270-wide front plate,
 *  130 on the 176-wide back plate), NOT a constant proportion of the plate width (210/270=0.78
 *  but 130/176=0.74) — a single `width * 0.78` formula overshoots the smaller back badge. */
function MegapotBadge({ cx, y, width, logoW }: { cx: number; y: number; width: number; logoW: number }) {
  const svg = megapotLogoSvgAt(logoW);
  const logoH = (logoW * 125) / 658;
  const plateH = logoH + 34;
  return (
    <>
      <RoundedRect x={cx - width / 2} y={y} width={width} height={plateH} r={18} color="#FFFDF7" opacity={0.92} />
      <SvgAt svg={svg} x={cx - logoW / 2} y={y + (plateH - logoH) / 2} width={logoW} height={logoH} />
    </>
  );
}

/**
 * Renders ONLY the top-half or bottom-half slice of the pack design, translated so that half's
 * content lands at local y 0..(ART_H/2) — each half becomes its OWN correctly-sized drawAsImage
 * call (760 x 560) instead of rendering the full 760x1120 design once and slicing the resulting
 * pixel buffer in JS afterward. The slice-after-render approach produced badly distorted output
 * (a landscape 270x74 badge came out as a tall vertical capsule) — Skia's offscreen image likely
 * has row-stride padding that a naive `width*height*4` byte-slice doesn't account for, so cutting
 * the buffer at that boundary read semi-garbled rows. Rendering each half as its own real Skia
 * surface sidesteps that entirely: Skia clips whatever's drawn to the canvas's actual bounds, so
 * content positioned outside the translated 0..560 range for a given half simply doesn't appear.
 */
function PackFoilElement({ face, part }: { face: 'front' | 'back'; part: 'top' | 'bot' }) {
  const cx = ART_W / 2,
    cy = 800;
  const halfH = ART_H / 2;
  const shiftY = part === 'top' ? 0 : -halfH;

  return (
    <Group transform={[{ translateY: shiftY }]}>
      <Rect x={0} y={0} width={ART_W} height={ART_H}>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(ART_W, ART_H)}
          colors={['#FF1301', '#FF6A00', '#EAB308', '#FF3D00']}
          positions={[0, 0.42, 0.72, 1]}
        />
      </Rect>

      <Crimp y={0} h={52} dir={1} />
      <Crimp y={ART_H - 52} h={52} dir={-1} />
      <Circle cx={cx} cy={90} r={26} color="#4A0C02" opacity={0.34} />

      {face === 'front' ? (
        <Group>
          <Sparkle cx={120} cy={250} r={26} o={0.9} />
          <Sparkle cx={650} cy={206} r={20} o={0.8} />
          <Sparkle cx={90} cy={430} r={15} o={0.7} />
          <Sparkle cx={676} cy={404} r={28} o={0.85} />
          <Sparkle cx={150} cy={540} r={12} o={0.6} />

          <SvgAt svg={looftaWhiteSvgAt(300)} x={cx - 150} y={150} width={300} height={(300 * 1026) / 3671} />
          <CenteredText cx={cx} y={340} text="MYSTERY" size={88} color="#fff" />
          <CenteredText cx={cx} y={436} text="PACK" size={88} color="#fff" />

          <Circle cx={cx} cy={cy} r={150}>
            <RadialGradient c={vec(cx - 40, cy - 52)} r={168} colors={['#FFF6D8', '#FFD349', '#E08A00']} positions={[0, 0.56, 1]} />
          </Circle>
          <CenteredText cx={cx} y={cy + 70} text="?" size={196} color="#B23A00" />

          <Sparkle cx={cx - 186} cy={cy - 118} r={32} o={0.95} />
          <Sparkle cx={cx + 196} cy={cy + 96} r={24} o={0.9} />
          <Sparkle cx={cx + 150} cy={cy - 150} r={17} o={0.8} />
          <Sparkle cx={cx - 160} cy={cy + 150} r={20} o={0.75} />

          <MegapotBadge cx={cx} y={972} width={270} logoW={210} />
        </Group>
      ) : (
        <Group>
          <SvgAt svg={looftaWhiteSvgAt(180)} x={cx - 90} y={ART_H / 2 - 190} width={180} height={(180 * 1026) / 3671} />
          <CenteredText cx={cx} y={ART_H / 2 - 56} text="MYSTERY PACK" size={36} color="#fff" />
          <MegapotBadge cx={cx} y={ART_H / 2 + 16} width={176} logoW={130} />
          <CenteredText cx={cx} y={ART_H - 96} text="1 ENTRY MIN · NO PURCHASE VALUE" size={16} color="rgba(255,255,255,0.6)" />
        </Group>
      )}
    </Group>
  );
}

export interface PackHalfTexture {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Renders the top and bottom halves of the pack design as two SEPARATE, correctly-sized
 *  (760x560) drawAsImage calls — mirrors the desktop version's packFace(part) result (a real
 *  half-height texture per pack-half mesh) without its slice-the-canvas-afterward approach. An
 *  earlier version rendered the full 760x1120 design once and sliced the resulting pixel buffer
 *  in JS, which produced badly distorted output (a landscape badge came out as a tall vertical
 *  capsule) — Skia's offscreen image likely has row-stride padding a naive `width*height*4` byte
 *  slice doesn't account for. Rendering each half as its own real surface sidesteps that. */
export async function generatePackTexture(face: 'front' | 'back'): Promise<{ top: PackHalfTexture; bot: PackHalfTexture }> {
  const halfH = ART_H / 2;
  const topImage = await drawAsImage(<PackFoilElement face={face} part="top" />, { width: ART_W, height: halfH });
  const topData = await imageToRgba(topImage, ART_W, halfH);
  const botImage = await drawAsImage(<PackFoilElement face={face} part="bot" />, { width: ART_W, height: halfH });
  const botData = await imageToRgba(botImage, ART_W, halfH);
  return {
    top: { data: topData, width: ART_W, height: halfH },
    bot: { data: botData, width: ART_W, height: halfH },
  };
}

export const TICKET_W = 420;
export const TICKET_H = 880;

function TicketElement({ entries, face }: { entries: number; face: 'front' | 'back' }) {
  const looftaO = looftaOrangeSvg();

  return (
    <Group>
      <Rect x={0} y={0} width={TICKET_W} height={TICKET_H} color={face === 'front' ? '#FFFDF7' : '#0B0B0F'} />
      <Rect x={0} y={0} width={TICKET_W} height={14}>
        <LinearGradient start={vec(0, 0)} end={vec(TICKET_W, 14)} colors={['#FF1301', '#EAB308']} />
      </Rect>
      {face === 'front' ? (
        <Group>
          <SvgAt svg={looftaO} x={TICKET_W / 2 - 80} y={50} width={160} height={(160 * 50) / 179} />
          <CenteredText cx={TICKET_W / 2} y={480} text={String(entries).padStart(2, '0')} size={220} color="#0B0B0F" />
          <CenteredText cx={TICKET_W / 2} y={560} text={entries === 1 ? 'ENTRY' : 'ENTRIES'} size={22} color="#6B6B78" />
          <Rect x={0} y={646} width={TICKET_W} height={TICKET_H - 646}>
            <LinearGradient start={vec(0, 646)} end={vec(TICKET_W, TICKET_H)} colors={['#FF1301', '#EAB308']} />
          </Rect>
          <CenteredText cx={TICKET_W / 2} y={760} text="$1.1M" size={60} color="#fff" />
        </Group>
      ) : (
        <Group>
          <SvgAt svg={looftaWhiteSvgAt(225)} x={TICKET_W / 2 - 112.5} y={270} width={225} height={(225 * 1026) / 3671} />
          <CenteredText cx={TICKET_W / 2} y={452} text="MEGAPOT" size={22} color="#7D7B76" />
        </Group>
      )}
    </Group>
  );
}

export async function generateTicketTexture(entries: number, face: 'front' | 'back'): Promise<{ data: Uint8Array; width: number; height: number }> {
  const image = await drawAsImage(<TicketElement entries={entries} face={face} />, { width: TICKET_W, height: TICKET_H });
  const data = await imageToRgba(image, TICKET_W, TICKET_H);
  return { data, width: TICKET_W, height: TICKET_H };
}

function EdgeElement() {
  return (
    <Rect x={0} y={0} width={64} height={560}>
      <LinearGradient start={vec(0, 0)} end={vec(64, 560)} colors={['#FF1301', '#FF6A00', '#EAB308']} />
    </Rect>
  );
}

export async function generateEdgeTexture(): Promise<{ data: Uint8Array; width: number; height: number }> {
  const image = await drawAsImage(<EdgeElement />, { width: 64, height: 560 });
  const data = await imageToRgba(image, 64, 560);
  return { data, width: 64, height: 560 };
}
