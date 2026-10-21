const code = "text-orange-300";

export function TelegramBot() {
  return (
    <article>
      <h1 className="text-3xl font-medium text-slate-100 mb-3">Pay on Telegram</h1>
      <p className="text-base text-slate-400 leading-relaxed mb-6">
        <a href="https://t.me/looftapay_bot" target="_blank" rel="noreferrer" className="text-orange-300 underline underline-offset-2">@looftapay_bot</a>{" "}
        lets you pay anyone on Telegram in USDC, from a chat or a group, without opening an app. You
        type who and how much, check the card, and tap Confirm.
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Get started</h2>
      <ol className="list-decimal list-inside space-y-2 text-base text-slate-300 mb-6">
        <li>Sign in to Loofta with the same Telegram account you use in the bot.</li>
        <li>Open <span className={code}>/app/auto-pay</span>, accept the terms and turn auto-pay on. This lets the bot pay from your wallet, within limits you set.</li>
        <li>Add money. In the bot, send <code className={code}>/fund</code> and tap Add money.</li>
        <li>Message the bot and pay.</li>
      </ol>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">What you can do</h2>
      <div className="space-y-4 text-base text-slate-300 mb-6">
        <div>
          <p className="text-slate-100 font-medium">Pay one person</p>
          <p><code className={code}>pay $5 to @someone</code> or <code className={code}>send 5$ to @someone</code>. Both words work, and the dollar sign can go before or after the amount.</p>
          <p>On a phone, tapping <code className={code}>/pay</code> in the command list sends it straight away, so the bot asks "Who do you want to pay, and how much?". Reply with <code className={code}>@someone 5</code> and it carries on. The same works for <code className={code}>/payprivately</code>.</p>
        </div>
        <div>
          <p className="text-slate-100 font-medium">Pay up to 5 people in one message</p>
          <p>Give each person their own amount: <code className={code}>pay $5 to @someone, $10 to @another and $2 to @third</code>. You can also write one amount for several people: <code className={code}>pay $5 to @someone @another</code> pays each of them $5. One Confirm tap pays everyone, and you get a link for each payment.</p>
        </div>
        <div>
          <p className="text-slate-100 font-medium">Pay privately</p>
          <p><code className={code}>pay $5 privately to @someone</code> or <code className={code}>/payprivately 5 @someone</code>. The card then lets you pick a delay (how long it can take to arrive) and a split (how many smaller parts it is sent in). The default is up to 10 minutes and a random split. You can also type them: <code className={code}>delay 30m split 4</code>. Private payments start at $1.</p>
        </div>
        <div>
          <p className="text-slate-100 font-medium">Pay from a group</p>
          <p>Add the bot to a group. Reply to someone's message with <code className={code}>/pay 5</code> to pay its author, or type <code className={code}>/pay 5 @someone</code>. In a group the bot only reads commands and messages that mention it, and the Confirm card is posted in the group for you alone to tap.</p>
        </div>
        <div>
          <p className="text-slate-100 font-medium">Someone not on Loofta yet</p>
          <p>They get a claim link and can collect the money by signing in with their Telegram account. A $0.10 claim fee applies, and the card shows it before you confirm.</p>
        </div>
      </div>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Commands</h2>
      <ul className="space-y-2 text-base text-slate-300 mb-6">
        <li><code className={code}>/pay</code> and <code className={code}>/payprivately</code>: pay people.</li>
        <li><code className={code}>/balance</code>: your balance.</li>
        <li><code className={code}>/fund</code>: your wallet address and a button to add money.</li>
        <li><code className={code}>/withdraw</code>: opens Loofta on withdraw, to cash out to a bank, a cash app or another wallet. Anyone can use it.</li>
        <li><code className={code}>/history</code>: your recent payments.</li>
        <li><code className={code}>/settings</code>: your limits and a link to change them.</li>
        <li><code className={code}>/help</code>: this guide, in short.</li>
      </ul>
      <p className="text-base text-slate-400 mb-6">
        Balance, fund, history and settings only work in a private chat with the bot.
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Fees</h2>
      <p className="text-base text-slate-400 mb-3">Every fee is on the card before you confirm, with the total from your wallet.</p>
      <div className="overflow-x-auto mb-6">
        <table className="w-full text-base text-left text-slate-300">
          <thead>
            <tr className="text-slate-400">
              <th className="py-2 pr-4 font-medium">Fee</th>
              <th className="py-2 pr-4 font-medium">Amount</th>
              <th className="py-2 font-medium">When</th>
            </tr>
          </thead>
          <tbody className="align-top">
            <tr className="border-t border-white/10">
              <td className="py-2 pr-4">Loofta</td>
              <td className="py-2 pr-4">0.2% of the amount</td>
              <td className="py-2">Every payment</td>
            </tr>
            <tr className="border-t border-white/10">
              <td className="py-2 pr-4">Claim fee</td>
              <td className="py-2 pr-4">$0.10</td>
              <td className="py-2">The person is not on Loofta yet</td>
            </tr>
            <tr className="border-t border-white/10">
              <td className="py-2 pr-4">Private payment fee</td>
              <td className="py-2 pr-4">About $0.20 plus 0.2% of the amount</td>
              <td className="py-2">Private payments only, shown as one line</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-base text-slate-400 mb-6">
        Network fees are covered by Loofta. A private payment adds the privacy network's fee, which
        is why it costs a little more.
      </p>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">Limits and safety</h2>
      <ul className="list-disc list-inside space-y-2 text-base text-slate-300 mb-6">
        <li>Every payment waits for your Confirm tap. Only you can confirm your own card, and it expires after 5 minutes.</li>
        <li>You set a maximum per payment (up to $500) and a daily maximum on <span className={code}>/app/auto-pay</span>. They are checked on every payment, and for a multi-payment message on the total.</li>
        <li>The bot knows you by your Telegram account, never by a name you type, and it only pays from the wallet linked to that account.</li>
        <li>You can turn auto-pay off at any time. That removes the bot's permission from your wallet.</li>
        <li>A payment that has been sent cannot be reversed by Loofta, so check the usernames on the card.</li>
      </ul>

      <h2 className="text-xl font-medium text-slate-100 mt-8 mb-3">If something does not work</h2>
      <ul className="list-disc list-inside space-y-2 text-base text-slate-300">
        <li><span className="text-slate-100">The bot says to sign in:</span> sign in to Loofta with the Telegram account you are messaging from.</li>
        <li><span className="text-slate-100">It says to turn on auto-pay:</span> accept the terms on <span className={code}>/app/auto-pay</span>.</li>
        <li><span className="text-slate-100">It says your balance is too low:</span> the total includes fees. Use <code className={code}>/fund</code>.</li>
        <li><span className="text-slate-100">It says the recipient has no username:</span> the person needs a Telegram username to be paid.</li>
        <li><span className="text-slate-100">Nothing happens in a group:</span> start your message with <code className={code}>/pay</code> or mention the bot, and make sure it can post in the group.</li>
      </ul>
    </article>
  );
}
