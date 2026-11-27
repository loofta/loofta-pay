import type { Metadata } from "next";
import { RipPackPage } from "@/components/ample-pack/RipPackPage";

export const metadata: Metadata = { title: "Rip your free pack", description: "Your first payment on Loofta comes with a free Ample pack." };

export default function PackPage() {
  return <RipPackPage />;
}
