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
// The loofta WHITE wordmark (3671x1026 native) is NOT used here — every attempt to scale it down
// to pack/ticket size (a ~12-20x downscale) rendered as a huge, unscaled fragment of a single
// letterform (a smooth rounded blob), even via the Skia.XYWHRect `rect` fix below that correctly
// fixes more modest downscale ratios (e.g. the Megapot logo's ~3x). Root cause not fully isolated
// — dropped rather than ship it broken. The much smaller loofta ORANGE mark (179x50 native, only
// ~1.1x downscale on the ticket) renders correctly and is kept.
const LOOFTA_ORANGE_SVG = `<svg width="179" height="50" viewBox="0 0 179 50" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M156.353 49.7919C153.195 49.7919 150.721 48.9386 148.929 47.2319C147.179 45.5253 146.305 43.1359 146.305 40.0639C146.305 36.9919 147.329 34.7733 149.377 33.4079C151.425 31.9999 154.049 31.2959 157.249 31.2959C159.126 31.2959 160.833 31.4239 162.369 31.6799C163.905 31.9359 165.291 32.2986 166.529 32.7679H166.721V31.8079C166.721 30.8266 166.358 30.0586 165.633 29.5039C164.907 28.9066 163.99 28.6293 162.881 28.6719C161.814 28.6719 160.897 28.7359 160.129 28.8639C159.403 28.9919 158.486 29.2053 157.377 29.5039C155.329 30.0159 153.558 29.9733 152.065 29.3759C150.571 28.7786 149.547 27.6053 148.993 25.8559C148.481 24.0213 148.587 22.4853 149.313 21.2479C150.081 20.0106 151.233 19.0506 152.769 18.3679C154.091 17.7279 155.563 17.1946 157.185 16.7679C158.849 16.3413 160.641 16.1279 162.561 16.1279C168.15 16.1279 172.246 17.4933 174.849 20.2239C177.494 22.9119 178.817 27.4346 178.817 33.7919V43.7119C178.817 45.4613 178.283 46.9119 177.217 48.0639C176.15 49.2159 174.678 49.7919 172.801 49.7919C170.753 49.7919 169.217 49.2159 168.193 48.0639C167.211 46.9119 166.721 45.5039 166.721 43.8399V42.3679H165.441C165.441 43.4773 165.227 44.6079 164.801 45.7599C164.417 46.9119 163.585 47.8719 162.305 48.6399C161.067 49.4079 159.083 49.7919 156.353 49.7919ZM156.993 35.7759C156.993 36.5013 157.249 37.0133 157.761 37.3119C158.315 37.6106 159.489 37.7599 161.281 37.7599C162.902 37.7599 164.033 37.6106 164.673 37.3119C165.313 37.0133 165.633 36.5013 165.633 35.7759C165.633 35.0933 165.313 34.6239 164.673 34.3679C164.033 34.0693 162.902 33.9199 161.281 33.9199C159.489 33.9199 158.315 34.0693 157.761 34.3679C157.249 34.6239 156.993 35.0933 156.993 35.7759Z" fill="#FF4A26"/>
<path d="M132.253 49.984C129.992 49.984 127.944 49.472 126.109 48.448C124.317 47.424 122.909 45.9734 121.885 44.096C120.861 42.176 120.349 39.936 120.349 37.376V26.112L117.981 26.432C116.701 26.6027 115.571 26.1547 114.589 25.088C113.608 24.0214 113.117 22.6774 113.117 21.056C113.117 19.4347 113.608 18.112 114.589 17.088C115.571 16.0214 116.701 15.5734 117.981 15.744L120.349 16.064L120.285 11.712C120.243 10.0054 120.733 8.66138 121.757 7.68004C122.781 6.65604 124.275 6.14404 126.237 6.14404C128.2 6.14404 129.715 6.65604 130.781 7.68004C131.848 8.66138 132.339 10.0054 132.253 11.712L132.125 16.064L135.517 15.616C137.821 15.2747 139.571 15.7014 140.765 16.896C141.96 18.048 142.557 19.4347 142.557 21.056C142.557 22.6774 141.96 24.0854 140.765 25.28C139.613 26.432 137.928 26.8587 135.709 26.56L132.125 26.112V35.648C132.125 36.2027 132.317 36.7147 132.701 37.184C133.085 37.6107 133.555 37.7387 134.109 37.568C134.749 37.3974 135.411 37.0347 136.093 36.48C136.819 35.9254 137.736 35.648 138.845 35.648C140.509 35.648 141.789 36.2454 142.685 37.44C143.581 38.6347 144.029 40.1067 144.029 41.856C144.029 43.2214 143.539 44.544 142.557 45.824C141.619 47.0614 140.275 48.064 138.525 48.832C136.776 49.6 134.685 49.984 132.253 49.984Z" fill="#FF4A26"/>
<path d="M96.0017 49.792C94.2097 49.792 92.7377 49.2373 91.5857 48.128C90.4764 46.976 89.9217 45.5467 89.9217 43.84V29.568C88.8124 29.824 87.8097 29.6747 86.9137 29.12C86.0177 28.5653 85.2924 27.7333 84.7377 26.624C84.2257 25.5147 83.9697 24.2987 83.9697 22.976C83.9697 21.6533 84.2471 20.4373 84.8017 19.328C85.3564 18.176 86.0817 17.3013 86.9777 16.704C87.9164 16.1067 88.9404 15.9787 90.0497 16.32C90.2631 13.1627 90.7751 10.368 91.5857 7.936C92.3964 5.46134 93.6337 3.52 95.2977 2.112C97.0044 0.704 99.2231 0 101.954 0C104.3 0 106.178 0.490667 107.586 1.472C108.994 2.41067 109.975 3.584 110.53 4.992C111.127 6.4 111.319 7.82933 111.106 9.28C110.892 10.688 110.316 11.9253 109.378 12.992C108.439 14.016 107.052 14.528 105.218 14.528C103.938 14.528 102.871 14.272 102.018 13.76C101.164 13.248 100.439 12.6293 99.8417 11.904C99.2871 11.136 98.7964 10.4107 98.3697 9.728C97.3031 8.02134 96.2151 7.44534 95.1057 8C94.5511 8.29867 94.2524 8.78933 94.2097 9.472C94.1671 10.112 94.3804 10.8587 94.8497 11.712L96.2577 14.144C96.9831 15.3387 97.7511 16.128 98.5617 16.512C99.3724 16.8533 100.396 16.9387 101.634 16.768L104.706 16.32C106.668 16.0213 108.268 16.5547 109.506 17.92C110.743 19.2853 111.362 20.9707 111.362 22.976C111.362 25.0667 110.722 26.752 109.442 28.032C108.204 29.2693 106.668 29.7813 104.834 29.568L102.146 29.248V43.84C102.146 45.5467 101.591 46.976 100.482 48.128C99.3724 49.2373 97.8791 49.792 96.0017 49.792Z" fill="#FF4A26"/>
<path d="M67.1965 49.92C62.2045 49.92 58.2152 48.448 55.2285 45.504C52.2845 42.5173 50.8125 38.3146 50.8125 32.896C50.8125 29.568 51.4952 26.6453 52.8605 24.128C54.2258 21.6106 56.1245 19.648 58.5565 18.24C61.0312 16.7893 63.9112 16.064 67.1965 16.064C70.8658 16.064 73.9165 16.7893 76.3485 18.24C78.7805 19.648 80.5938 21.6106 81.7885 24.128C83.0258 26.6453 83.6445 29.568 83.6445 32.896C83.6445 38.3146 82.2792 42.5173 79.5485 45.504C76.8605 48.448 72.7432 49.92 67.1965 49.92ZM58.4285 31.808C58.4285 33.1306 59.0898 34.0693 60.4125 34.624C61.7352 35.136 63.9965 35.392 67.1965 35.392C70.3965 35.392 72.6578 35.136 73.9805 34.624C75.3032 34.0693 75.9645 33.1306 75.9645 31.808C75.9645 30.528 75.3032 29.632 73.9805 29.12C72.6578 28.608 70.3965 28.352 67.1965 28.352C63.9965 28.352 61.7352 28.608 60.4125 29.12C59.0898 29.632 58.4285 30.528 58.4285 31.808Z" fill="#FF4A26"/>
<path d="M31.509 49.92C26.517 49.92 22.5277 48.448 19.541 45.504C16.597 42.5173 15.125 38.3146 15.125 32.896C15.125 29.568 15.8077 26.6453 17.173 24.128C18.5383 21.6106 20.437 19.648 22.869 18.24C25.3437 16.7893 28.2237 16.064 31.509 16.064C35.1783 16.064 38.229 16.7893 40.661 18.24C43.093 19.648 44.9063 21.6106 46.101 24.128C47.3383 26.6453 47.957 29.568 47.957 32.896C47.957 38.3146 46.5917 42.5173 43.861 45.504C41.173 48.448 37.0557 49.92 31.509 49.92ZM22.741 31.808C22.741 33.1306 23.4023 34.0693 24.725 34.624C26.0477 35.136 28.309 35.392 31.509 35.392C34.709 35.392 36.9703 35.136 38.293 34.624C39.6157 34.0693 40.277 33.1306 40.277 31.808C40.277 30.528 39.6157 29.632 38.293 29.12C36.9703 28.608 34.709 28.352 31.509 28.352C28.309 28.352 26.0477 28.608 24.725 29.12C23.4023 29.632 22.741 30.528 22.741 31.808Z" fill="#FF4A26"/>
<path d="M6.272 49.792C4.18133 49.792 2.60267 49.2373 1.536 48.128C0.512 47.0187 0 45.632 0 43.968V6.848C0 5.01333 0.512 3.49866 1.536 2.304C2.60267 1.06666 4.18133 0.447998 6.272 0.447998C8.14933 0.447998 9.6 1.06666 10.624 2.304C11.648 3.49866 12.16 4.97066 12.16 6.72V43.968C12.16 45.632 11.648 47.0187 10.624 48.128C9.6 49.2373 8.14933 49.792 6.272 49.792Z" fill="#FF4A26"/>
</svg>`;

const MEGAPOT_LOGO_SVG = `<svg width="658" height="125" viewBox="0 0 658 125" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M203.158 25.9583L209.695 2.73978L146.855 2.73977L113.189 122.51L176.028 122.51L182.565 99.2901L150.206 99.2901L157.804 72.2298L184.609 72.2298L191.065 48.9264L164.26 48.9264L170.798 25.9583L203.158 25.9583Z" fill="#111827"/>
<path d="M285.289 17.6461C282.866 12.2185 278.738 8.02887 272.909 5.07712C267.08 2.1269 259.835 0.651021 251.173 0.651021C243.166 0.65102 236.261 2.01563 230.459 4.7433C224.657 7.47252 219.932 11.231 216.281 16.0188C212.632 20.808 209.909 26.4595 208.111 32.9736L196.098 76.488C193.265 86.4003 192.817 94.9605 194.749 102.17C196.682 109.382 200.837 114.921 207.211 118.792C213.584 122.662 221.973 124.597 232.379 124.597C238.806 124.597 244.923 123.817 250.725 122.259C256.526 120.701 261.334 118.695 265.147 116.246L281.327 58.0311L238.754 58.0311L232.544 80.248L245.536 80.248L240.184 99.2027C239.664 99.4128 239.133 99.5968 238.591 99.7513C237.12 100.167 235.567 100.377 233.932 100.377C231.425 100.377 229.369 99.793 227.764 98.6232C226.155 97.4533 225.12 95.8121 224.657 93.6947C224.195 91.5791 224.371 89.0183 225.188 86.011L239.652 34.4788C240.304 32.2519 241.041 30.4005 241.858 28.9245C242.674 27.4486 243.668 26.3499 244.842 25.625C246.011 24.9017 247.415 24.5386 249.049 24.5386C251.828 24.5386 253.733 25.472 254.768 27.3358C255.803 29.2027 255.967 31.6939 255.259 34.8111L252.48 44.7497L284.592 44.7497L286.798 36.6486C288.215 29.4099 287.714 23.0767 285.289 17.6461Z" fill="#111827"/>
<path d="M321.5 2.73978L268.222 122.51L300.091 122.51L309.798 98.0383L326.356 98.0383L322.48 122.51L353.532 122.51L366.606 2.73979L321.5 2.73978ZM330.175 74.3176L319.245 74.3176L337.34 28.8187L330.175 74.3176Z" fill="#111827"/>
<path d="M456.101 22.369C454.874 16.1332 451.906 11.3022 447.194 7.8791C442.48 4.4529 436.121 2.74211 428.114 2.74211L393.875 2.74211L360.208 122.512L390.689 122.512L402.62 79.9993L409.24 79.9993C417.683 79.9993 424.834 78.8033 430.69 76.4078C436.544 74.0139 441.38 70.3528 445.194 65.4245C449.007 60.4976 451.948 54.1645 454.02 46.4236L454.592 44.1687C456.825 35.8729 457.325 28.6064 456.101 22.369ZM425.661 38.99L424.026 44.7529C422.719 49.4293 421.016 52.8417 418.92 54.9851C416.821 57.1287 414.002 58.1997 410.461 58.1997L408.745 58.1997L418.225 24.4568L419.859 24.4568C421.982 24.4568 423.629 24.9576 424.803 25.9606C425.973 26.9636 426.641 28.5492 426.804 30.722C426.968 32.8934 426.587 35.6504 425.661 38.99Z" fill="#111827"/>
<path d="M586.5 2.74211L579.472 27.8815L599.982 27.8815L573.344 122.512L603.823 122.512L630.381 27.8815L650.891 27.8815L658 2.74212L586.5 2.74211Z" fill="#111827"/>
<path d="M95.6059 2.73977L64.4273 76.0345L74.5244 2.73977L33.6659 2.73977L-4.87825e-06 122.51L27.0479 122.51L47.9043 48.3298L38.8141 122.51L64.4726 122.51L97.3614 46.9111L76.0757 122.51L103.368 122.51L137.036 2.73977L95.6059 2.73977Z" fill="#111827"/>
<path d="M519.087 -6.07209e-06C485.317 -7.94346e-06 457.94 27.9814 457.94 62.5C457.94 97.0186 485.316 125 519.087 125C552.859 125 580.234 97.0186 580.234 62.5C580.234 27.9814 552.859 -4.20055e-06 519.087 -6.07209e-06ZM536.809 116.08C527.222 90.5294 496.846 80.7747 474.683 96.1285C495.494 78.9124 495.186 46.3705 474.05 29.5717C496.499 44.4819 526.683 34.1245 535.784 8.38856C528.847 34.82 547.811 60.9608 574.571 61.8541C547.834 63.2789 529.371 89.7922 536.809 116.08Z" fill="#111827"/>
</svg>`;

let _looftaOrange: ReturnType<(typeof Skia)['SVG']['MakeFromString']>;
let _megapotLogo: ReturnType<(typeof Skia)['SVG']['MakeFromString']>;
function looftaOrangeSvg() {
  if (!_looftaOrange) _looftaOrange = Skia.SVG.MakeFromString(LOOFTA_ORANGE_SVG);
  return _looftaOrange;
}
function megapotLogoSvg() {
  if (!_megapotLogo) _megapotLogo = Skia.SVG.MakeFromString(MEGAPOT_LOGO_SVG);
  return _megapotLogo;
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
 *  It does NOT fix extreme ratios (~12-20x, the loofta white wordmark) — see the comment by
 *  LOOFTA_ORANGE_SVG above for why that logo was dropped rather than shipped broken. */
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

/** Small white rounded plate with the Megapot wordmark centered in it, matching web's bottom badge. */
function MegapotBadge({ cx, y, width }: { cx: number; y: number; width: number }) {
  const svg = megapotLogoSvg();
  const logoW = width * 0.78;
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

          <CenteredText cx={cx} y={280} text="MYSTERY" size={88} color="#fff" />
          <CenteredText cx={cx} y={370} text="PACK" size={88} color="#fff" />

          <Circle cx={cx} cy={cy} r={150}>
            <RadialGradient c={vec(cx - 40, cy - 52)} r={168} colors={['#FFF6D8', '#FFD349', '#E08A00']} positions={[0, 0.56, 1]} />
          </Circle>
          <CenteredText cx={cx} y={cy + 70} text="?" size={196} color="#B23A00" />

          <Sparkle cx={cx - 186} cy={cy - 118} r={32} o={0.95} />
          <Sparkle cx={cx + 196} cy={cy + 96} r={24} o={0.9} />
          <Sparkle cx={cx + 150} cy={cy - 150} r={17} o={0.8} />
          <Sparkle cx={cx - 160} cy={cy + 150} r={20} o={0.75} />

          <MegapotBadge cx={cx} y={1000} width={270} />
        </Group>
      ) : (
        <Group>
          <CenteredText cx={cx} y={ART_H / 2 - 40} text="MYSTERY PACK" size={36} color="#fff" />
          <MegapotBadge cx={cx} y={ART_H / 2 + 16} width={176} />
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
          <CenteredText cx={TICKET_W / 2} y={520} text="MEGAPOT" size={22} color="#7D7B76" />
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
