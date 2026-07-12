/**
 * Same two families as apps/frontend (globals.css/tailwind.config.ts): Clash Display for
 * titles, Clash Grotesk for everything else. Web loads these from Fontshare's CDN via
 * @font-face; React Native has no CSS/CDN font loading, so we bundle the local TTFs from
 * apps/video/public/fonts (the only place in the repo that already vendors them as files)
 * and register them with expo-font instead.
 */
export const FONT_ASSETS = {
  'ClashDisplay-Bold': require('../assets/fonts/ClashDisplay-Bold.ttf'),
  'ClashDisplay-Semibold': require('../assets/fonts/ClashDisplay-Semibold.ttf'),
  'ClashGrotesk-Regular': require('../assets/fonts/ClashGrotesk-Regular.ttf'),
  'ClashGrotesk-Medium': require('../assets/fonts/ClashGrotesk-Medium.ttf'),
  'ClashGrotesk-Semibold': require('../assets/fonts/ClashGrotesk-Semibold.ttf'),
  'ClashGrotesk-Bold': require('../assets/fonts/ClashGrotesk-Bold.ttf'),
};

/** Titles/headings — matches web's `font-display` (Clash Display) convention. */
export const FONT_TITLE = 'ClashDisplay-Bold';
export const FONT_TITLE_SEMIBOLD = 'ClashDisplay-Semibold';

/** Body copy — matches web's `font-sans`/`font-grotesk` (Clash Grotesk) convention, the
 *  default font for nearly all non-heading text on the web app. Previously bundled but never
 *  applied on mobile, so body text was falling back to the OS system font. */
export const FONT_BODY = 'ClashGrotesk-Regular';
export const FONT_BODY_MEDIUM = 'ClashGrotesk-Medium';
export const FONT_BODY_SEMIBOLD = 'ClashGrotesk-Semibold';
export const FONT_BODY_BOLD = 'ClashGrotesk-Bold';
