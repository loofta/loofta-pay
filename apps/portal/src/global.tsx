import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { PayoutPortal, type PayoutPortalProps } from "./index";

/**
 * For sites without React:
 *   <div id="payouts"></div>
 *   <script src=".../loofta-portal.global.js"></script>
 *   <script>LooftaPortal.mount("#payouts", { getToken: () => fetch("/loofta-token").then(r => r.json()).then(j => j.token) })</script>
 */
export function mount(target: string | HTMLElement, props: PayoutPortalProps): () => void {
  const el = typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
  if (!el) throw new Error(`LooftaPortal.mount: target ${String(target)} not found`);
  const root = createRoot(el);
  root.render(createElement(PayoutPortal, props));
  return () => root.unmount();
}
