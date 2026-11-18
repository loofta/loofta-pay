"use client";

import { useLogin, usePrivy } from "@privy-io/react-auth";

/** Whether the visitor is signed in, and the call that opens the Loofta sign in. Browsing is open, trading needs an account. */
export function useSignIn() {
  const { ready, authenticated } = usePrivy();
  const { login } = useLogin();
  return { authed: ready && authenticated, signIn: () => login() };
}
