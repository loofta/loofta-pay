import { NEAR_INTENTS_TEST_MODE } from "@/config/nearIntents";

type AddressRole = "sender" | "recipient";

function isEvmChain(chain: string) {
	const c = chain.toLowerCase();
	return ["ethereum", "arbitrum", "polygon", "bsc", "avalanche", "optimism", "base", "fantom", "gnosis", "linea", "zksync", "scroll", "monad"]
		.some((n) => c.includes(n));
}

function isSolana(chain: string) {
	return chain.toLowerCase().includes("sol");
}

function isNear(chain: string) {
	const c = chain.toLowerCase();
	return c.includes("near");
}

function isTon(chain: string) {
	return chain.toLowerCase().includes("ton");
}

function isAptos(chain: string) {
	return chain.toLowerCase().includes("aptos");
}

function isCardano(chain: string) {
	const c = chain.toLowerCase();
	return c.includes("cardano") || c.includes("ada");
}

// Deterministic but simple hex from a string
function hexFromString(input: string, length: number) {
	let h = 0x811c9dc5; // FNV-1a basis
	for (let i = 0; i < input.length; i++) {
		h ^= input.charCodeAt(i);
		h = (h * 0x01000193) >>> 0;
	}
	const hex = h.toString(16).padStart(8, "0");
	const repeated = hex.repeat(Math.ceil(length / hex.length)).slice(0, length);
	return repeated.toLowerCase();
}

// Simple base58-ish set for Solana/Ton style placeholders
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58FromString(input: string, length: number) {
	let acc = "";
	let idx = 0;
	while (acc.length < length) {
		const code = input.charCodeAt(idx % input.length);
		acc += B58[(code + idx) % B58.length];
		idx++;
	}
	return acc;
}

// Bech32-ish for Cardano (lowercase set used by bech32)
const B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function bech32FromString(input: string, length: number) {
	let acc = "";
	let idx = 0;
	while (acc.length < length) {
		const code = input.charCodeAt(idx % input.length);
		acc += B32[(code + idx) % B32.length];
		idx++;
	}
	return acc;
}

function nearImplicitFromSeed(seed: string) {
	// NEAR implicit account id: 64 hex chars, lowercase, no prefix
	return hexFromString(seed, 64);
}

export function getMockAddressForChain(chain: string, role: AddressRole): string {
	// Prefer realistic, valid-looking formats per chain family
	if (isEvmChain(chain)) {
		// EVM: 20-byte hex
		const seed = `evm-${chain}-${role}`;
		return `0x${hexFromString(seed, 40)}`;
	}
	if (isSolana(chain)) {
		// Solana: base58 32-44 chars
		const seed = `sol-${chain}-${role}`;
		return base58FromString(seed, 44);
	}
	if (isNear(chain)) {
		// NEAR: implicit account id (64 hex). Works consistently across validators.
		const base = role === "sender" ? "sender" : "recipient";
		return nearImplicitFromSeed(`${base}-${chain}-${NEAR_INTENTS_TEST_MODE ? "test" : "prod"}`);
	}
	if (isCardano(chain)) {
		// Cardano: bech32 address starting with 'addr1'
		const seed = `ada-${chain}-${role}`;
		return `addr1q${bech32FromString(seed, 52)}`;
	}
	if (isTon(chain)) {
		// TON: base64url-like (not validating checksum)
		const seed = `ton-${chain}-${role}`;
		return `EQ${base58FromString(seed, 46)}`; // typical length ~48
	}
	if (isAptos(chain)) {
		// Aptos: 32-byte hex, displayed with 0x prefix
		const seed = `aptos-${chain}-${role}`;
		return `0x${hexFromString(seed, 64)}`;
	}
	// Fallback: EVM-style
	const seed = `fallback-${chain}-${role}`;
	return `0x${hexFromString(seed, 40)}`;
}

export function getMockSender(chain: string) {
	return getMockAddressForChain(chain, "sender");
}

export function getMockRecipient(chain: string) {
	return getMockAddressForChain(chain, "recipient");
}

export function getMockUserAuth(): { authMethod: "solana"; userAddress: string } {
	// Use a known-good Solana base58 (32-byte pubkey) seen in examples/docs
	// Ref: defuse-frontend network trace and docs
	return { authMethod: "solana", userAddress: "Fj6wgB92stPhFBdEmz1TD9sH32KtboXYj69uxBbSvXTX" };
}

export function getKnownGoodAddressForFamily(family: string, role: AddressRole): string {
	const fam = family.toLowerCase();
	if (fam === "solana") {
		// 32-byte base58 pubkey string
		return "Fj6wgB92stPhFBdEmz1TD9sH32KtboXYj69uxBbSvXTX";
	}
	if (fam === "ethereum") {
		// Any 20-byte 0x hex
		return "0xEC523839fd5Aa275115d382A996Db616A3a7465F";
	}
	if (fam === "near") {
		// Implicit account id
		return nearImplicitFromSeed(`${role}-near-known-good`);
	}
	if (fam === "cardano") {
		// Use deterministic bech32 mock; API tends to validate format
		return `addr1q${bech32FromString(`ada-known-${role}`, 52)}`;
	}
	if (fam === "aptos") {
		return `0x${hexFromString("aptos-known-good", 64)}`;
	}
	if (fam === "ton") {
		return `EQ${base58FromString("ton-known-good", 46)}`;
	}
	// Default to EVM
	return "0xEC523839fd5Aa275115d382A996Db616A3a7465F";
}

