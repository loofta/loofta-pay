/**
 * Browser shim for @coral-xyz/anchor. The CJS build only exports Wallet when !isBrowser,
 * so we re-export Anchor and provide a Wallet class that wraps a Keypair (same API as NodeWallet).
 */
const anchor = require('@coral-xyz/anchor-node');

class Wallet {
  constructor(payer) {
    this.payer = payer;
  }
  async signTransaction(tx) {
    if (tx.version !== undefined) {
      tx.sign([this.payer]);
    } else {
      tx.partialSign(this.payer);
    }
    return tx;
  }
  async signAllTransactions(txs) {
    return txs.map((tx) => {
      if (tx.version !== undefined) {
        tx.sign([this.payer]);
      } else {
        tx.partialSign(this.payer);
      }
      return tx;
    });
  }
  get publicKey() {
    return this.payer.publicKey;
  }
}

module.exports = { ...anchor, Wallet };
