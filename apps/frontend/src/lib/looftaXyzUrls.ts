/** Public production origin for marketing / product pages linked from the app shell. */
export const LOOFTA_XYZ_ORIGIN = "https://loofta.xyz" as const;

export const looftaXyz = {
  checkout: `${LOOFTA_XYZ_ORIGIN}/checkout`,
  partners: `${LOOFTA_XYZ_ORIGIN}/partners`,
  swap: `${LOOFTA_XYZ_ORIGIN}/swap`,
  about: `${LOOFTA_XYZ_ORIGIN}/about`,
} as const;
