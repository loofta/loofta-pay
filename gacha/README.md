# React handoff — Loofta Gacha Pack

White / black / gold gacha booster in the classic collectible-pack layout, with a
pokéball medallion and Loofta branding. Front and back.

Canvas-rendered from a shared art module — **no dependencies**, no three.js.

**Rename each file to drop the trailing `.txt`** — the suffix only exists so this
design system's in-browser compiler ignores them.

| File | Rename to | What it is |
| --- | --- | --- |
| `gachaArt.js.txt` | `gachaArt.js` | The artwork (single source of truth, 760 × 1120) |
| `GachaPack.tsx.txt` | `GachaPack.tsx` | React component |

## Use

```tsx
import GachaPack, { renderGachaPackPNG } from '@/components/GachaPack';

<GachaPack width={320} />                 // front
<GachaPack width={320} face="back" />     // back
<GachaPack width={320} flippable />       // click to flip in 3D

// export a share image
const blob = await renderGachaPackPNG('front', 2);
```

Renders at `devicePixelRatio` so it stays sharp on retina. Images load once per
unique asset set and are shared across every instance on the page.

## Assets

Defaults point at `/brand/*`. Copy these into `public/brand/`:

| From this project | To |
| --- | --- |
| `assets/logo/loofta_white.svg` | `public/brand/loofta_white.svg` |
| `assets/logo/loofta.svg` | `public/brand/loofta.svg` |
| `assets/logo/partners/megapot-black.svg` | `public/brand/megapot-black.svg` |
| `assets/logo/partners/megapot-white.svg` | `public/brand/megapot-white.svg` |

Using different paths? Pass the `assets` prop — unset keys fall back to the defaults:

```tsx
<GachaPack width={320} assets={{ logoWhite: '/img/loofta-white.svg' }} />

// same override shape on the PNG export
await renderGachaPackPNG('front', 2, { logoWhite: '/img/loofta-white.svg' });
```

To change them app-wide instead, edit `DEFAULT_ASSETS` at the top of `GachaPack.tsx`.

## Fonts

The artwork sets `"Clash Display"` and `"Clash Grotesk"` on the canvas, so load them
in the host app (TTFs are in this project's `fonts/` folder). The component waits on
`document.fonts.ready` before drawing, so text renders in the brand faces rather than
a fallback.

## Editing the artwork

Everything lives in `gachaArt.js` — sweeps, gold arcs, medallion, star row, lockup.
It's the same file this design system uses for `Gacha Pack.html`, so keep them in sync
if you change one.
