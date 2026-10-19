// Frontend-only stand-in for the future billing backend. Every function here is pure and works on
// plain objects, so each one can later be replaced by a call to the real billing API without
// touching the screens in BillingDemo.tsx.

export type Interval = "month" | "quarter" | "year";
export type SubStatus = "active" | "past_due" | "cancelled";

export interface Plan {
  id: string;
  name: string;
  price: number;
  interval: Interval;
}
export interface Subscription {
  plan: Plan;
  next: Date;
  status: SubStatus;
}
export interface Charge {
  date: Date;
  amount: number;
  ok: boolean;
}
export type MailKind = "welcome" | "reminder" | "receipt" | "low" | "failed" | "cancelled";
export interface Mail {
  kind: MailKind;
  subject: string;
  date: Date;
  plan: Plan;
  email: string;
  next?: Date;
  balance?: number;
}
export interface SubscriberRow {
  who: string;
  plan: string;
  price: number;
  interval: Interval;
  next: Date;
  status: SubStatus;
  prepaid: string;
  fresh: boolean;
}

/** Loofta fee on each charge, in percent. Grapevine pilot rate. */
export const FEE_PERCENT = 0.5;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDate = (x: Date) => `${x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`;
export const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const EVERY: Record<Interval, string> = { month: "every month", quarter: "every 3 months", year: "every year" };
export const BILLED: Record<Interval, string> = { month: "Monthly", quarter: "Every 3 months", year: "Yearly" };

export function addInterval(x: Date, interval: Interval): Date {
  const months = interval === "year" ? 12 : interval === "quarter" ? 3 : 1;
  const r = new Date(x.getFullYear(), x.getMonth() + months, 1);
  const lastDay = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(x.getDate(), lastDay));
  return r;
}
export function addDays(x: Date, n: number): Date {
  const r = new Date(x);
  r.setDate(r.getDate() + n);
  return r;
}

export const START_DATE = new Date(2026, 9, 19);

export const SEED_PLANS: Plan[] = [
  { id: "core-m", name: "Core", price: 399, interval: "month" },
  { id: "core-y", name: "Core Yearly", price: 3588, interval: "year" },
  { id: "pro-m", name: "Pro", price: 1299, interval: "month" },
];

/** Invented example subscribers so the dashboard looks lived in. */
export const SEED_SUBSCRIBERS: SubscriberRow[] = [
  { who: "Northbeam Labs", plan: "Core", price: 399, interval: "month", next: new Date(2026, 9, 24), status: "active", prepaid: "Covers 3 payments", fresh: false },
  { who: "Kelp Finance", plan: "Pro", price: 1299, interval: "month", next: new Date(2026, 10, 2), status: "active", prepaid: "Covers 2 payments", fresh: false },
  { who: "Orbit Wallet", plan: "Core Yearly", price: 3588, interval: "year", next: new Date(2027, 0, 14), status: "active", prepaid: "Covers 1 payment", fresh: false },
  { who: "Meridian Swap", plan: "Pro", price: 1299, interval: "month", next: new Date(2026, 9, 17), status: "past_due", prepaid: "Needs $1,299.00", fresh: false },
];

export const MAIL_SUBJECT = (kind: MailKind, plan: Plan): string =>
  ({
    welcome: `Welcome to Grapevine ${plan.name}, your receipt`,
    reminder: "Your Grapevine payment is coming up",
    receipt: `Receipt: ${money(plan.price)} paid to Grapevine`,
    low: "Top up to keep Grapevine running",
    failed: "Action needed: your Grapevine payment did not go through",
    cancelled: "Your Grapevine subscription is cancelled",
  })[kind];

export function monthlyValue(price: number, interval: Interval): number {
  return interval === "year" ? price / 12 : interval === "quarter" ? price / 3 : price;
}

export function slugId(name: string, interval: Interval): string {
  return `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${interval.charAt(0)}`;
}
