/** Plain-language explanation of what an asset is, shown at the top of its Info tab. */
export type AssetKind = "Stock" | "Pre-IPO" | "Meme" | "Coin";

export type AssetAbout = { title: string; lines: string[] };

/** The big coins people look for, in one or two sentences. Anything else falls back to the CoinGecko text. */
const MAJORS: Record<string, string> = {
  SOL: "Solana is the blockchain this app runs on. SOL pays the small network fee on every transaction and is what people stake to secure the network.",
  WSOL: "Wrapped SOL is SOL in token form, so it works like any other token. It always equals one SOL.",
  BTC: "Bitcoin is the first and biggest cryptocurrency, often called digital gold. Its supply is capped at 21 million coins.",
  WBTC: "A version of Bitcoin that lives on Solana, so you can hold and trade it like any other token. Each one is backed by real Bitcoin.",
  CBBTC: "Coinbase's wrapped Bitcoin on Solana. Each token is backed by one Bitcoin held by Coinbase.",
  ETH: "Ether is the coin of Ethereum, the biggest network for apps and tokens. It pays fees there and is the second largest crypto.",
  WETH: "Ether as a token on Solana. Each one is backed by one real ETH held on Ethereum.",
  USDC: "A dollar stablecoin from Circle. One USDC is meant to always be worth one US dollar, backed by cash and short-term US treasuries.",
  USDT: "A dollar stablecoin from Tether. One USDT is meant to stay at one US dollar.",
  JUP: "The token of Jupiter, the main trading engine on Solana. Holders vote on how the project is run.",
  JTO: "The token of Jito, which lets people stake SOL and earn extra rewards from network tips. Holders vote on the project.",
  BONK: "The first big dog meme coin on Solana. It has no product behind it, its price follows attention and community.",
  WIF: "A meme coin of a dog wearing a pink hat. No product behind it, its price follows attention.",
  RAY: "The token of Raydium, one of the oldest trading pools on Solana.",
  PYTH: "The token of Pyth, a network that delivers live prices to apps on many blockchains.",
  HYPE: "The token of Hyperliquid, a fast exchange for perpetual futures. It is used for fees and by people who help run the network.",
};

export function assetAbout(kind: AssetKind | undefined, name: string, symbol: string): AssetAbout | null {
  if (kind === "Pre-IPO") {
    return {
      title: `What is ${name}?`,
      lines: [
        `${name} is a company that is not on the stock market yet. This token follows the price of its private shares, so you can get in before it goes public.`,
        "Each token is backed by shares held by a custodian. You own the token, not a share, so there is no vote and no dividend.",
        "There is no stock exchange behind it, so the price comes from this token's own market and can jump or sit still. It trades day and night.",
      ],
    };
  }
  if (kind === "Stock") {
    return {
      title: `What is ${name}?`,
      lines: [
        `${name} is a company listed on the stock market. This token follows its share price, so you can buy a slice of it with USDC from your phone.`,
        "Each token is backed by real shares held by a custodian. You own the token, not a share, so there is no vote, but dividends are passed on in most cases.",
        "The token trades day and night. The real share only trades when the stock market is open, so on nights and weekends the price can drift a little from it.",
      ],
    };
  }
  const known = MAJORS[symbol.toUpperCase()];
  if (known) return { title: `What is ${name}?`, lines: [known] };
  return null;
}
