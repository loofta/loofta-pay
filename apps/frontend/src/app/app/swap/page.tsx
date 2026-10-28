"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SwapPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/app/wallet?tab=swap");
  }, [router]);
  return null;
}
