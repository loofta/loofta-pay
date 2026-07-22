import { LooftaPayClient } from "./client";
import type { RecipientType } from "./types";

/**
 * A thin tool definition wrapping `LooftaPayClient.payHuman` — shaped like an Anthropic
 * tool-use definition (name/description/input_schema + a handler), since that's directly usable
 * as-is and trivially adaptable to other agent frameworks (LangChain, OpenAI function-calling,
 * MCP, etc.) by lifting the schema/handler out.
 */
export function createPayHumanTool(client: LooftaPayClient) {
  return {
    name: "pay_human",
    description:
      "Pay a real person with stablecoin (USDC) by their email address, username, or social handle (Twitter/Discord/GitHub/Telegram). Returns a claim link the recipient uses to receive the funds.",
    input_schema: {
      type: "object" as const,
      properties: {
        recipient_type: {
          type: "string" as const,
          enum: ["email", "username", "twitter", "discord", "github", "telegram"] as RecipientType[],
          description: "How the recipient is identified",
        },
        recipient: {
          type: "string" as const,
          description: "Email address, username, or social handle (no @ needed)",
        },
        amount_usd: {
          type: "number" as const,
          description: "Amount in USD to send",
        },
        note: {
          type: "string" as const,
          description: "Optional note attached to the payment",
        },
      },
      required: ["recipient_type", "recipient", "amount_usd"] as const,
    },
    handler: async (input: {
      recipient_type: RecipientType;
      recipient: string;
      amount_usd: number;
      note?: string;
    }) => {
      const result = await client.payHuman({
        to: { type: input.recipient_type, value: input.recipient },
        amount: input.amount_usd,
        description: input.note,
      });
      return {
        payment_id: result.paymentId,
        claim_link: result.claimLink,
        status: result.status,
      };
    },
  };
}
