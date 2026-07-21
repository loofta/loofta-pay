export const PAY_WITH_EMAIL_FAQ = [
  {
    question: "Do I need the recipient's wallet address to pay them?",
    answer:
      "No. All you need is an email address or a social handle, X, Telegram, whatever you already have for them. Loofta resolves it to a payment behind the scenes, so there's no address to copy, no ENS to look up, and no risk of sending to the wrong chain.",
  },
  {
    question: "What if they've never used crypto before?",
    answer:
      "It still works. They get a private claim link the moment you send, and the payment sits there waiting even if they've never touched a wallet in their life. When they open it, they're walked through claiming it, no prior account or crypto knowledge required.",
  },
  {
    question: "How do they actually get the money?",
    answer:
      "When they open the claim link, they choose: create a Loofta account and hold the USDC directly, or send it straight to any wallet address they already have on another chain or token. From a Loofta balance, cashing out to a bank is one more step after that, not part of the claim itself.",
  },
  {
    question: "Which stablecoin do they receive?",
    answer:
      "USDC. If they claim into a Loofta account, it lands as USDC. If they claim out to another wallet, they can pick a different token or chain during claim — Loofta handles the conversion so you don't have to ask what they hold.",
  },
  {
    question: "What happens if they never claim it?",
    answer:
      "Nothing expires automatically. The payment just sits open until they claim it. If you need the funds back before that happens, you can reclaim them from your account at any time.",
  },
  {
    question: "Do I need to already hold crypto to send a payment?",
    answer:
      "No. You fund your Loofta balance with a card or bank transfer, then send USDC to anyone's email or handle from there. You don't need to manage a wallet or hold crypto yourself to pay someone who does.",
  },
  {
    question: "Can I keep the payment private?",
    answer:
      "Yes. Flip on Shielded mode and MagicBlock hides the link between sender and recipient on-chain. Loofta is non-custodial, so only you ever hold your keys.",
  },
];
