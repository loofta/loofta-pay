# React Native handoff — Mystery Pack

The mobile build of the pack opening. No three.js: the artwork is `react-native-svg`
and the open sequence is `react-native-reanimated`, with perspective transforms
faking the depth of the halves tearing apart.

**Rename each file to drop the trailing `.txt`** — the suffix only exists so this
design system's in-browser compiler ignores them.

| File | Rename to | What it is |
| --- | --- | --- |
| `MysteryPack.tsx.txt` | `MysteryPack.tsx` | The pack itself, front or back |
| `MegapotTicket.tsx.txt` | `MegapotTicket.tsx` | The vertical entry ticket |
| `MysteryPackOpening.tsx.txt` | `MysteryPackOpening.tsx` | Full tap-to-open sequence |

## Install

```bash
npm i react-native-svg react-native-reanimated
```

Add the Reanimated plugin to `babel.config.js` (must be last):

```js
plugins: ['react-native-reanimated/plugin']
```

## Use

```tsx
import MysteryPackOpening from '@/components/MysteryPackOpening';

<MysteryPackOpening
  onResult={(entries) => awardTickets(entries)}
  assets={{
    logoWhite:   require('@/assets/brand/loofta-white.png'),
    logoDark:    require('@/assets/brand/loofta.png'),
    megapotDark: require('@/assets/brand/megapot-black.png'),
  }}
/>
```

Or drop the pack in on its own:

```tsx
<MysteryPack width={280} logoWhite={logoWhite} megapotDark={megapotDark} />
<MysteryPack width={280} face="back" logoWhite={logoWhite} megapotDark={megapotDark} />
<MegapotTicket width={180} entries={5} logo={logoDark} />
```

## Assets

Pass logos as `require(...)` image sources. Export PNGs at 3× from this project's
`assets/logo/loofta.svg`, `assets/logo/loofta_white.svg`, and
`assets/logo/partners/megapot-black.svg` — or wire up
`react-native-svg-transformer` and pass the SVG components instead.

## Fonts

Components default to `ClashDisplay-Medium` and `ClashGrotesk-Semibold`; load them
with `expo-font` (or link the TTFs from this project's `fonts/` folder) and override
via the `displayFont` / `bodyFont` props if your names differ.

## Odds

`1 entry 68%` · `5 entries 25%` · `10 entries 7%` — the `ODDS` table at the top of
`MysteryPackOpening.tsx`. Swap `roll()` for your server's result to make it authoritative.
