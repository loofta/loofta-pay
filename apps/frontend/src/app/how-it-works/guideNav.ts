export interface GuideNavPage {
  slug: string; // "" = section index page
  title: string;
}

export interface GuideNavSection {
  section: string;
  pages: GuideNavPage[];
}

export const GUIDE_NAV: GuideNavSection[] = [
  {
    section: "Payments",
    pages: [
      { slug: "", title: "Overview" },
      { slug: "send", title: "Send a payment" },
      { slug: "payment-links", title: "Payment links" },
      { slug: "terminal", title: "Terminal" },
    ],
  },
  {
    section: "Balance",
    pages: [
      { slug: "deposit", title: "Deposit" },
      { slug: "withdraw", title: "Withdraw" },
    ],
  },
  {
    section: "Megapot",
    pages: [
      { slug: "megapot", title: "How Megapot works" },
      { slug: "gift-tickets", title: "Gift a ticket" },
    ],
  },
  {
    section: "Rewards & giveaways",
    pages: [
      { slug: "rewards", title: "Rewards" },
      { slug: "giveaways", title: "Giveaways" },
    ],
  },
  {
    section: "Privacy",
    pages: [{ slug: "privacy", title: "How private payments work" }],
  },
];
