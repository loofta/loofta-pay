/**
 * Everything the support assistant is allowed to know. It is written by hand for the people who get paid, in plain
 * words, and it is the ONLY knowledge the model ever sees: no source code, no settings, no internal names, no
 * addresses. To teach the bot something new, add it here. To stop it saying something, delete it here.
 */
export const SUPPORT_KNOWLEDGE = `
ABOUT
Loofta lets companies pay people by email in USDC (a digital dollar). The person who is paid opens a withdraw page that carries the paying company's name, signs in with their email and chooses how to take the money.

GETTING PAID
- A payout arrives as an email. Open the link in it and sign in with the SAME email address the payout was sent to.
- If the page says there is nothing to withdraw: the company may not have funded the payout yet, or you signed in with a different email. Sign out and sign in with the address that received the email.
- Loofta does not decide who is paid, how much or when. That is the company's decision. For questions about an amount or timing, ask the company that paid you.

WAYS TO TAKE THE MONEY
- USDC on Solana: sent to any Solana wallet address you choose. This is the fastest route and usually arrives within seconds.
- Other tokens: swapped and sent to an address on another network such as Bitcoin or Ethereum. It takes a few minutes and depends on the network.
- Bank or cards: cash to a bank account or debit card through a payment provider. The time depends on the provider and on your bank, and the page shows what applies before you confirm.
- Private P2P: someone sends you the money through an app such as Wise, PayPal, Revolut or Venmo. You choose the app and your handle. It finishes when a buyer sends the money, so the time varies. It starts at $10. It is paid 1% under the market rate, which is how a buyer is found quickly, and the page shows that 1% before you confirm.
- A company can switch some routes off, so you may not see all four.

FEES
- You see the fees before you confirm anything. There can be two: Loofta's fee, which is $0.10 plus 0.5% of the amount on every way of withdrawing, and a fee the paying company chooses. They are always listed separately.
- Private P2P is also paid 1% under the market rate. That 1% is shown as its own line before you confirm.
- The amount you will receive after fees is shown before you confirm.

CANCELLING
- A Private P2P cash-out can be cancelled until a buyer has paid. After a buyer has paid it cannot be cancelled.
- A cash-out that is still preparing can be cancelled.
- Once money has been sent to a wallet address or a bank, it cannot be taken back by Loofta.

SAFETY
- Loofta staff never ask for a password, a recovery phrase, a private key or a sign-in code. Never share these with anyone, including this chat.
- Always check the wallet address or handle before you confirm. A wrong address cannot be fixed afterwards.
- Loofta never messages first to ask for money or for you to move funds.

WHAT THIS CHAT CANNOT DO
- It cannot change a payout, refund money, reverse a transfer or see anyone else's account.
- It cannot give financial, tax or legal advice.
`.trim();

/** Quick questions shown as buttons. Answered instantly, without the model. Edit the wording freely. */
export const SUPPORT_FAQ: Array<{ id: string; question: string; answer: string }> = [
  {
    id: 'nothing',
    question: 'It says there is nothing to withdraw',
    answer:
      'This usually means one of two things. The company has not funded your payout yet, or you signed in with a different email than the one that received the payout. Try signing out and signing in with the address from the email. If it still says nothing, ask the company that paid you whether the payout has been sent.',
  },
  {
    id: 'speed',
    question: 'How long does a cash-out take?',
    answer:
      'USDC to a Solana wallet usually arrives within seconds. Other tokens take a few minutes. Bank and card cash-outs depend on the provider and your bank, and Private P2P finishes when a buyer sends the money. The page shows what applies before you confirm.',
  },
  {
    id: 'cancel',
    question: 'Can I cancel a cash-out?',
    answer:
      'A Private P2P cash-out can be cancelled until a buyer has paid. After that it cannot be cancelled. A cash-out that is still preparing can be cancelled. The card for your latest cash-out at the top of the page has a Cancel button, and cancelling finishes right there. Keep the page open while it works.',
  },
  {
    id: 'fees',
    question: 'What are the fees?',
    answer:
      'You see every fee before you confirm. Loofta charges $0.10 plus 0.5% on every withdrawal. If the company set a fee, that is listed separately. Private P2P is also paid 1% under the market rate. All of it is shown before you confirm, with the amount you will receive.',
  },
  {
    id: 'wrong-address',
    question: 'I sent to the wrong address',
    answer:
      'Money sent to a wallet address or a bank cannot be taken back by Loofta. Please press "Talk to a person" so our team can look at your case, and do not share any recovery phrase or password with anyone.',
  },
];

/** Words that mean the person wants a human. Checked before the model is asked anything. */
export const WANTS_HUMAN = /\b(human|real person|live agent|an agent|support team|(talk|speak) to (a |an |the )?(person|someone|team|agent))\b/i;
