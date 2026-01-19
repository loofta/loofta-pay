export type AuthMethod = "near" | "evm" | "solana" | "webauthn" | "ton" | "stellar" | "tron";

export function toIntentsUserId(address: string, method: AuthMethod): string {
	// Simple, readable mapping compatible with INTENTS addressing used server-side
	// Format: "<method>:<identifier>"
	return `${method.toLowerCase()}:${address}`;
}


