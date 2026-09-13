/**
 * looftapot design tokens — ported verbatim from the design spec. Single source of truth for
 * color/radius/space; components should read from here instead of ad-hoc hex strings.
 */
export const color = {
  // brand
  brandRed: '#FF1301',
  brandRedAlt: '#FF0F00',
  brandOrange: '#FF4A26', // primary fill — solid, not gradient
  brandYellow: '#EAB308',
  // dark surfaces
  bgInk: '#0F0F12', // screen background
  bgInkSoft: '#1A1A22', // raised chip / input
  surface1: 'rgba(255,255,255,0.03)', // card
  surface3: 'rgba(255,255,255,0.06)',
  borderSoft: 'rgba(255,255,255,0.10)',
  borderSofter: 'rgba(255,255,255,0.05)',
  borderStrong: 'rgba(255,255,255,0.15)',
  // text
  fg: '#FFFFFF',
  fg2: '#94A3B8', // body
  fg3: '#64748B', // labels
  fg4: '#475569', // faint
  // status
  success: '#34D399', // shielded / won
  warn: '#F59E0B',
  danger: '#EF4444',
} as const;

export const radius = { sm: 6, md: 12, lg: 16, xl: 24, pill: 9999 } as const;

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 } as const;

/** Calm soft-shadow treatment for primary CTAs — no glowing red halos. */
export const primaryShadow = {
  shadowColor: color.brandOrange,
  shadowOpacity: 0.25,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: 8 },
  elevation: 6,
} as const;
