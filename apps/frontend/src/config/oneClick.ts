export const DEFAULT_ONECLICK_REFUND_TO =
	process.env.NEXT_PUBLIC_DEFAULT_ONECLICK_REFUND_TO ||
	process.env.NEXT_PUBLIC_ONECLICK_REFUND_TO ||
	"";
export const DEFAULT_RECIPIENT =
	process.env.NEXT_PUBLIC_DEFAULT_RECIPIENT ||
	process.env.NEXT_PUBLIC_ONECLICK_RECIPIENT ||
	"";

export const ONECLICK_API_BASE =
	process.env.NEXT_PUBLIC_ONECLICK_API_BASE ||
	"https://1click.chaindefuser.com";

// Backward-compatible aliases
export const ONECLICK_REFUND_TO = DEFAULT_ONECLICK_REFUND_TO;
export const ONECLICK_RECIPIENT = DEFAULT_RECIPIENT;

export function haveRequiredAddresses() {
	return Boolean(ONECLICK_REFUND_TO && ONECLICK_RECIPIENT);
}


