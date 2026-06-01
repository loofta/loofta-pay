# Loofta Swap — Security Audit Report
Date: 2026-05-30 | Mode: Full (8/10 gate)

## Critical
- F-1: NEXT_PUBLIC_PRIVY_APP_SECRET in apps/frontend/.env.production — exposed in JS bundle, rotate immediately
- F-2: Supabase service role key in frontend .env.production — bypasses all RLS

## High
- F-3: Recipient email/twitter stored plaintext in DB (payments.recipient_email, send_payment_links.recipient_identifier)
- F-4: Legacy x-privy-user-id auth header — no cryptographic ownership proof
- F-5: select('*') fetches burner_encrypted_secret on every link load
- F-6: 2 critical CVEs (xlsx prototype pollution), 25 high CVEs (@reown/appkit)

## Medium
- F-7: Two different SEND_PAYMENT_ENC_KEY values across env files (backend vs frontend)
- F-8: PRIVACY_CASH_SOLANA_PRIVATE_KEY not confirmed KMS-wrapped in production
- F-9: No rate limiting on POST /claims create endpoints

## Info
- F-10: PRIVY_AUTH_PRIVATE_KEY — confirm KMS in prod
- F-11: CI/CD pipeline is well-secured (SHA-pinned, no hardcoded secrets)
