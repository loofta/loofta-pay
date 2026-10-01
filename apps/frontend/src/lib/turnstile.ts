/**
 * The real Turnstile sitekey's Cloudflare dashboard allowed-hostnames list needs `localhost`
 * (and 127.0.0.1) added before guest sends will work from a local dev server — confirmed via
 * client error 110200, "Domain not authorized", while testing the guest send flow. This is the
 * first place in the repo that actually renders a Turnstile widget, so nothing surfaced that
 * before now. Fix it in the Cloudflare dashboard (Turnstile → this site → Settings → Hostname
 * Management), not by swapping in a different key here — this app runs its backend against
 * .env.production.local locally too (see apps/backend/package.json's start:dev:prod-data), and
 * a real-sitekey token can only be verified with the matching real secret, so both sides always
 * need to agree on the same real key pair regardless of which env file is loaded.
 */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!;
