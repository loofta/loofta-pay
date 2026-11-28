import type { Metadata } from "next";
import { RipPackPage } from "@/components/ample-pack/RipPackPage";

export const metadata: Metadata = { title: "Rip your free pack", description: "Pay $10 on Loofta and rip a free Ample pack of bonus tickets." };

export default function PackPage() {
  return <RipPackPage />;
}
