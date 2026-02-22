# Privacy Cash ZK circuit files

This folder contains the ZK proof circuit artifacts used for “Pay privately” (Privacy Cash) in send-payment links.

- **transaction2.wasm** – WebAssembly circuit
- **transaction2.zkey** – proving key

They are copied from the [Privacy Cash SDK](https://github.com/Privacy-Cash/privacy-cash-sdk) `circuit2/` folder so the backend can build and run without an external path or env override.

To refresh from the SDK repo (e.g. after an SDK update):

```bash
cp /path/to/privacy-cash-sdk/circuit2/transaction2.wasm /path/to/privacy-cash-sdk/circuit2/transaction2.zkey apps/backend/circuit2/
```
