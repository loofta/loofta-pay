// Must be imported before anything else (see app/_layout.tsx) — Hermes doesn't provide these
// Node/Web globals natively, and @solana/web3.js, viem, and @privy-io/expo's dependency chain
// all assume at least one of them is present.

// global.crypto.getRandomValues — needed by viem/@noble (pulled in via @privy-io/expo).
import 'react-native-get-random-values';

// global.Buffer — needed by @solana/web3.js (e.g. Buffer.from(base64Tx, 'base64')). Using
// globalThis (not Node's `global`) so this doesn't need @types/node — pulling that in would let
// TypeScript think other Node-only APIs (fs, process, ...) are available here too, which they
// aren't in Hermes.
import { Buffer } from 'buffer';
if (typeof (globalThis as any).Buffer === 'undefined') {
  (globalThis as any).Buffer = Buffer;
}
