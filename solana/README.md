# Solana smart contracts

Private USDC payments on Magic Block Private Ephemeral Rollup (PER).

## Install Anchor (and Solana CLI)

You need **Anchor** and the **Solana CLI** to build and deploy. From a terminal:

**1. Install Rust** (if needed):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

**2. Install Solana CLI** (required for `cargo build-sbf` — Anchor uses it to build programs). Run the **official installer** (do not use `cargo install solana`). Prefer the Anza URL (current maintainer); use the other if you get SSL or connection errors:

```bash
# Preferred (Anza)
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
```

If that fails (e.g. `curl: (35) SSL_ERROR_SYSCALL`), try:

```bash
# Legacy Solana URL
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
```

**If both curl installs fail** (network/firewall), install from a prebuilt tarball:

1. Open https://github.com/anza-xyz/agave/releases/latest
2. Download **solana-release-x86_64-apple-darwin.tar.bz2** (macOS) or the matching Linux artifact
3. Extract and add `bin` to PATH:

```bash
tar -jxf solana-release-x86_64-apple-darwin.tar.bz2
cd solana-release/
export PATH="$PWD/bin:$PATH"
# Persist: echo 'export PATH="/full/path/to/solana-release/bin:$PATH"' >> ~/.zshrc
```

**In the same terminal**, add Solana to PATH and verify immediately (use the path the installer printed if it’s different):

```bash
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cargo build-sbf --version
solana --version
```

If both commands work, **persist PATH** by appending to your shell config:

```bash
echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

If `cargo build-sbf --version` still says “no such command”, the Solana bin directory is not on PATH. Check that it exists:

```bash
ls "$HOME/.local/share/solana/install/active_release/bin" | grep cargo
```

You should see `cargo-build-sbf`. If the directory doesn’t exist, run the install script again and use the path it prints.

**3. Install Anchor** (recommended: via AVM so you can switch versions):

```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest
```

Or install a specific Anchor version directly:

```bash
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked --tag v0.32.1
```

Check:

```bash
anchor --version
solana --version
```

## Layout

- `programs/private-payments/` — Anchor program (deposits, vault, config, payment request, audit log)
- `Cargo.toml` — workspace and dependencies
- `Anchor.toml` — Anchor / Solana config
- `migrations/deploy.ts` — deploy script

## Build & deploy

From this directory (`solana/`):

```bash
anchor build
anchor deploy --provider.cluster devnet
```

IDL and program binary are in `target/`. Copy `target/idl/private_payments.json` into the app if needed.

## One-time setup

After first deploy, call `initialize_config(platform_authority)` with your backend keypair’s public key (the one in `PRIVATE_PAYMENTS_PLATFORM_SECRET`). The program will store it in the config PDA; only that key can use `pay_with_authorization` and write to the audit log.

## What’s next (after `anchor build`)

1. **Deploy to devnet** (from `solana/`):
   ```bash
   solana config set --url devnet
   solana airdrop 2   # if your default keypair needs SOL
   anchor deploy --provider.cluster devnet
   ```
   Uses wallet `~/.config/solana/id.json` by default (see `Anchor.toml`).

2. **Initialize program config** (once per deploy):  
   Call the `initialize_config(platform_authority)` instruction with the **public key** of the keypair you use in the backend for `PRIVATE_PAYMENTS_PLATFORM_SECRET`. You can do this via a small script using `@coral-xyz/anchor` and the IDL in `target/idl/private_payments.json`, or from your backend if it has the keypair and Solana RPC.

3. **App config**:  
   Ensure the frontend/backend use the same program id (`Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS` if you didn’t change it), PER RPC URL, and that the backend has `PRIVATE_PAYMENTS_PLATFORM_SECRET` set.

4. **Test**:  
   On the claim page (`/c/[id]`), for a Solana USDC private claim, use “Pay privately” and complete deposit → delegate → private transfer (see `docs/PRIVATE_USDC_PAYMENT_STEPS.md`).

## Troubleshooting

- **`error: no such command: build-sbf`** — Solana CLI is not on your PATH. Add Solana’s `bin` directory to `PATH` (see step 2 above) and ensure `cargo build-sbf --version` works before running `anchor build`.

- **`Failed to install platform-tools: Permission denied (os error 13)`** — `cargo build-sbf` needs to write platform-tools into `~/.cache/solana`. Create the dir and ensure it’s writable, then retry:

  ```bash
  mkdir -p ~/.cache/solana
  chmod 755 ~/.cache/solana
  cd solana && anchor build
  ```

  If it still fails, check that your Solana install dir is writable (e.g. `$HOME/.local/share/solana`). If you installed from a tarball into a read-only location, move it to a writable path or reinstall with the official script.

- **`feature edition2024 is required`** (e.g. from `blake3`) — Solana’s build toolchain uses an older Cargo that doesn’t support edition 2024. The workspace `Cargo.toml` pins `blake3` to 1.8.2 via `[patch.crates-io]`. If you still see the error, run `cargo update -p blake3` in `solana/`, then `anchor build` again.
