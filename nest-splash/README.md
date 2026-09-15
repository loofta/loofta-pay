# Loofta Nest — splash integration (Next.js)

## Install
```bash
npm i three
npm i -D @types/three
```

## Files
- `nest-splash.css` — palette tokens (light + `.ns-dark`), fonts, card/label styles. Import once (e.g. in `app/nest-earn/layout.tsx`): `import "./nest-splash.css"`.
- `NestHero.tsx.txt` — rename to `NestHero.tsx` after copying into your app (the `.txt` suffix just keeps it out of this kit's own build). Client component: the interactive 3D nest (drag to orbit, hover eggs for ticker · weight · price · change, news egg pulses). Props: `stocks`, `height`.
- `page.tsx.txt` — rename to `page.tsx` after copying. The full splash page (hero, Event Ledger, press strip, How it works, Pricing) wired to `NestHero`. Drop into `app/nest-earn/` (rename/merge with your existing page).

## Wire real data
- `stocks` prop: feed live prices/weights from your xStocks service; `news: true` marks the event-hit position (it pulses + label always visible).
- Sign-in buttons call `onSignIn` — pass your auth handler.
- Fonts load from Google (Instrument Serif + Instrument Sans) via the CSS file.

## Dark variant
Wrap any subtree in `class="ns-dark"` to switch to the dark-green palette.

## Notes
- The hero disposes its WebGL context on unmount (safe with fast refresh / route changes).
- Favicons for outlets/eggs come from `google.com/s2/favicons` — swap for local assets if you want zero third-party requests.
