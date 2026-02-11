import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Sp3ndStep = "url" | "cart" | "payment" | "redirect" | "paid";

export type Sp3ndCartItem = { product_title?: string; title?: string; price?: number; quantity?: number; image_url?: string; product_id?: string };

export type Sp3ndCartDetails = {
  items?: Sp3ndCartItem[];
  subtotal?: number;
  total?: number;
  tax?: number;
  tax_amount?: number;
  shipping_amount?: number;
  platform_fee?: number;
} | null;

export type Sp3ndShipping = {
  first_name: string;
  last_name: string;
  address_line_1: string;
  address_line_2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  phoneCountryCode: string;
  phone: string;
};

const defaultShipping: Sp3ndShipping = {
  first_name: "",
  last_name: "",
  address_line_1: "",
  address_line_2: "",
  city: "",
  state: "",
  postal_code: "",
  country: "United States",
  phoneCountryCode: "+1",
  phone: "",
};

type Sp3ndState = {
  step: Sp3ndStep;
  lastOrderNumber: string | null;
  cartItems: Array<{ url: string; quantity: number }>;
  addMoreUrl: string;
  addMoreQty: number;
  cartId: string | null;
  cartDetails: Sp3ndCartDetails;
  shipping: Sp3ndShipping;
  email: string;
  hydrated: boolean;
  // Actions
  setStep: (step: Sp3ndStep) => void;
  setLastOrderNumber: (v: string | null) => void;
  setCartItems: (v: Array<{ url: string; quantity: number }>) => void;
  setCartItemsBy: (fn: (prev: Array<{ url: string; quantity: number }>) => Array<{ url: string; quantity: number }>) => void;
  setAddMoreUrl: (v: string) => void;
  setAddMoreQty: (v: number) => void;
  setCartId: (v: string | null) => void;
  setCartDetails: (v: Sp3ndCartDetails) => void;
  setShipping: (v: Partial<Sp3ndShipping> | ((prev: Sp3ndShipping) => Sp3ndShipping)) => void;
  setEmail: (v: string) => void;
  setHydrated: (v: boolean) => void;
  resetOrder: () => void;
};

export const useSp3ndStore = create<Sp3ndState>()(
  persist(
    (set) => ({
      step: "url",
      lastOrderNumber: null,
      cartItems: [{ url: "", quantity: 1 }],
      addMoreUrl: "",
      addMoreQty: 1,
      cartId: null,
      cartDetails: null,
      shipping: defaultShipping,
      email: "",
      hydrated: false,

      setStep: (step) => set({ step }),
      setLastOrderNumber: (v) => set({ lastOrderNumber: v }),
      setCartItems: (v) => set({ cartItems: v }),
      setCartItemsBy: (fn) => set((s) => ({ cartItems: fn(s.cartItems) })),
      setAddMoreUrl: (v) => set({ addMoreUrl: v }),
      setAddMoreQty: (v) => set({ addMoreQty: v }),
      setCartId: (v) => set({ cartId: v }),
      setCartDetails: (v) => set({ cartDetails: v }),
      setShipping: (v) =>
        set((s) => ({
          shipping: typeof v === "function" ? v(s.shipping) : { ...s.shipping, ...v },
        })),
      setEmail: (v) => set({ email: v }),
      setHydrated: (v) => set({ hydrated: v }),
      resetOrder: () =>
        set({
          step: "url",
          lastOrderNumber: null,
          cartId: null,
          cartDetails: null,
          cartItems: [{ url: "", quantity: 1 }],
          addMoreUrl: "",
          addMoreQty: 1,
          shipping: defaultShipping,
          email: "",
        }),
    }),
    {
      name: "loofta-sp3nd-order",
      partialize: (s) => ({
        step: s.step,
        lastOrderNumber: s.lastOrderNumber,
        cartItems: s.cartItems,
        addMoreUrl: s.addMoreUrl,
        addMoreQty: s.addMoreQty,
        cartId: s.cartId,
        cartDetails: s.cartDetails,
        shipping: s.shipping,
        email: s.email,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (!error) {
          state?.setHydrated(true);
        }
      },
    }
  )
);
