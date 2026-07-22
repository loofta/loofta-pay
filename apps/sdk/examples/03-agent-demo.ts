/**
 * Natural-language agent demo — type an instruction, Claude decides whether it's a payment
 * request, and if so calls the pay_human tool for real. This is what the agent-tool export
 * (@loofta/pay-sdk/agent-tool) is actually for: dropping the protocol into an LLM tool-use loop.
 *
 * Uses Claude's Tool Runner (client.beta.messages.toolRunner) so there's no hand-written
 * agentic loop — see the claude-api skill's "Tool Use Patterns" reference if you want to
 * understand what it's doing under the hood.
 *
 * Setup:
 *   ANTHROPIC_API_KEY=...            # or run `ant auth login` once and omit this
 *   LOOFTA_API_KEY=lft_test_...      # from POST /admin/integrators — OR:
 *   LOOFTA_SIGNER_SECRET_KEY=...     # a funded devnet Solana keypair, for the x402 path instead
 *   LOOFTA_API_URL=http://localhost:3001
 *
 *   npx tsx examples/03-agent-demo.ts "send $5 to alice@example.com for the design review"
 *
 * Real payments execute by default once Claude decides to call the tool — pass --yes to skip
 * the confirmation prompt (useful for a recorded take where you don't want the pause on camera).
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import * as readline from "node:readline/promises";
import { LooftaPayClient } from "../src";
import { createPayHumanTool } from "../src/agent-tool";

const MODEL = "claude-opus-4-8";

async function confirm(question: string): Promise<boolean> {
  if (process.argv.includes("--yes")) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return answer.trim().toLowerCase() === "y";
}

async function main() {
  const instruction = process.argv.slice(2).filter((a) => a !== "--yes").join(" ");
  if (!instruction) {
    throw new Error('Pass an instruction, e.g. npx tsx examples/03-agent-demo.ts "pay bob@x.com $5"');
  }

  const looftaApiKey = process.env.LOOFTA_API_KEY;
  const signerSecretKey = process.env.LOOFTA_SIGNER_SECRET_KEY;
  if (!looftaApiKey && !signerSecretKey) {
    throw new Error("Set LOOFTA_API_KEY or LOOFTA_SIGNER_SECRET_KEY");
  }

  const loofta = new LooftaPayClient({
    apiKey: looftaApiKey,
    signer: signerSecretKey,
    baseUrl: process.env.LOOFTA_API_URL || "http://localhost:3001",
  });

  const payHumanDef = createPayHumanTool(loofta);
  const payHumanTool = betaTool({
    name: payHumanDef.name,
    description: payHumanDef.description,
    inputSchema: payHumanDef.input_schema,
    run: async (input: Parameters<typeof payHumanDef.handler>[0]) => {
      const summary = `${input.recipient_type}:${input.recipient} for $${input.amount_usd}`;
      const proceed = await confirm(`\nAbout to pay ${summary} — really send this?`);
      if (!proceed) return JSON.stringify({ error: "Payment declined by operator before execution." });
      console.log(`\n→ Paying ${summary}...`);
      const result = await payHumanDef.handler(input);
      return JSON.stringify(result);
    },
  });

  const anthropic = new Anthropic(); // resolves ANTHROPIC_API_KEY / ant auth profile automatically

  const finalMessage = await anthropic.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 4096,
    system:
      "You help pay people based on natural-language instructions. When the user asks you to " +
      "pay or send money to someone, call pay_human. Confirm what you did afterward in one " +
      "short sentence including the claim link.",
    tools: [payHumanTool],
    messages: [{ role: "user", content: instruction }],
  });

  for (const block of finalMessage.content) {
    if (block.type === "text") console.log(`\n${block.text}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
