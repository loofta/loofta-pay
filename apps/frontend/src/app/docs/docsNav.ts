export interface DocsNavPage {
  slug: string; // "" = section index page
  title: string;
}

export interface DocsNavSection {
  section: string;
  pages: DocsNavPage[];
}

export const DOCS_NAV: DocsNavSection[] = [
  {
    section: "Getting started",
    pages: [
      { slug: "", title: "Introduction" },
      { slug: "authentication", title: "Authentication" },
    ],
  },
  {
    section: "Receive payments",
    pages: [
      { slug: "receive-payments", title: "Create a payment link" },
      { slug: "checkout-page", title: "The checkout page" },
    ],
  },
  {
    section: "Integrate",
    pages: [
      { slug: "code-examples", title: "Code examples" },
      { slug: "agent-skill", title: "Agent skill" },
    ],
  },
  {
    section: "Coming soon",
    pages: [{ slug: "send-payments", title: "Send payments API" }],
  },
];
