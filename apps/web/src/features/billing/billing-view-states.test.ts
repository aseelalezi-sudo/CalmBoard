import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./billing-view.tsx", import.meta.url), "utf8");
const checkout = readFileSync(new URL("./use-billing-checkout.ts", import.meta.url), "utf8");

test("billing fails closed and prevents concurrent checkout operations", () => {
  assert.match(source, /ctx\.can\("billing\.manage"\)/);
  assert.match(source, /tone="permission"/);
  assert.match(source, /const billingBusy = checkoutLoading !== null \|\| portalLoading/);
  assert.match(source, /disabled=\{billingBusy\}/);
  assert.match(source, /disabled=\{p\.id === current \|\| billingBusy\}/);
  assert.match(checkout, /const busyRef = useRef\(false\)/);
  assert.match(checkout, /if \(busyRef\.current \|\| !ctx\.activeOrg/);
  assert.match(checkout, /busyRef\.current = true/);
  assert.match(checkout, /busyRef\.current = false/);
});

test("development billing is explicit and missing destinations fail safely", () => {
  assert.match(checkout, /Local development subscription updated without a real charge/);
  assert.match(checkout, /if \(!result\.url\) throw new Error\("Missing billing destination"\)/);
  assert.doesNotMatch(checkout, /Subscription updated in simulation mode \(Stripe-ready\)/);
});

test("billing localizes plan, seat, amount, and pending labels", () => {
  assert.match(source, /export function formatBillingAmount/);
  assert.match(source, /new Intl\.NumberFormat/);
  assert.match(source, /fmtNumber\(usedSeats, ctx\.locale\)/);
  assert.match(source, /ctx\.t\("جارٍ المعالجة\.\.\."/);
  assert.doesNotMatch(source, /⌛|\{current\}<\/Badge>/);
});

test("billing uses semantic controls, surfaces, and directional isolation", () => {
  assert.match(source, /<Btn/);
  assert.match(source, /sm:grid-cols-2 xl:grid-cols-4/);
  assert.match(source, /<bdi dir="ltr"/);
  assert.match(source, /<time[^>]+dateTime=\{inv\.createdAt\}/);
  assert.doesNotMatch(source, /text-slate-|dark:text-zinc-|divide-slate-/);
});
