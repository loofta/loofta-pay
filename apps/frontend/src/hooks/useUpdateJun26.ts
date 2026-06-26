"use client";

import { useState, useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";

const LOCAL_KEY = "loofta_update_jun26_done";

// Users created at or after this date already have a fresh wallet — no upgrade needed.
const CUTOFF = new Date("2026-06-26T00:00:00Z");

function isNewUser(createdAt: Date | null | undefined): boolean {
  if (!createdAt) return false;
  return createdAt >= CUTOFF;
}

export function isUpdateDone(): boolean {
  try { return localStorage.getItem(LOCAL_KEY) === "1"; } catch { return false; }
}

export function markLocallyDone() {
  try { localStorage.setItem(LOCAL_KEY, "1"); } catch { /* */ }
}

export function useUpdateJun26() {
  const { ready, authenticated, user, getAccessToken } = usePrivy();
  const [show, setShow] = useState(false);
  const privyUserId = user?.id;

  // Show modal as soon as Privy is ready and user is logged in — unless already done
  useEffect(() => {
    if (!ready || !authenticated || !privyUserId) return;

    if (isUpdateDone()) return;

    // New users signed up after the deployment already have a fresh wallet — skip.
    if (isNewUser(user?.createdAt)) {
      markLocallyDone();
      return;
    }

    // Not done locally: show modal immediately, then check backend in background
    // to sync cross-device (if done on another device, hide without forcing the flow again)
    setShow(true);

    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const res = await fetch("/api/users/update-jun26", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.completed) {
            markLocallyDone();
            setShow(false);
          } else if (isUpdateDone()) {
            // localStorage says done but DB doesn't have the record — backfill it.
            // Happens when the /complete endpoint was missing during the upgrade.
            fetch("/api/users/update-jun26/complete", {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
            }).catch(() => {});
            setShow(false);
          }
        }
      } catch {
        // Backend unreachable — modal stays visible, which is correct
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, privyUserId]);

  // On tab return: hide if done on another tab, re-show if not done and logged in
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (isUpdateDone() || isNewUser(user?.createdAt)) {
        setShow(false);
      } else if (authenticated && privyUserId) {
        setShow(true);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [authenticated, privyUserId]);

  return { show };
}
