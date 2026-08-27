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
    // The full "how do I actually integrate this" path, in the order you'd walk it: get a key,
    // see the code, try the same thing live, then optionally hand it to a coding agent. Code
    // examples and Try it used to sit in different sections (Setup vs. a separate "Integrate")
    // even though they're the same step — read the snippet, then click the live version of it —
    // so they're grouped together here instead of split apart.
    section: "Setup",
    pages: [
      { slug: "api-key", title: "API key & branding" },
      { slug: "code-examples", title: "Code examples" },
      { slug: "try-it", title: "Try it" },
      { slug: "agent-skill", title: "Agent skill" },
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
    section: "Send payments",
    pages: [{ slug: "send-payments", title: "Pay a recipient" }],
  },
];
