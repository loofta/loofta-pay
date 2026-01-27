interface SolanaWallet {
  isConnected: boolean;
  publicKey: {
    toString(): string;
  };
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  signMessage(message: Uint8Array, encoding: string): Promise<{ signature: Uint8Array }>;
  signTransaction(transaction: any): Promise<any>;
  on(event: string, callback: () => void): void;
}

interface Window {
  solana?: SolanaWallet;
}
