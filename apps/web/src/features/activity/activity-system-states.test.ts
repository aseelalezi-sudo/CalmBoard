import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./activity-view.tsx", import.meta.url), "utf8");

test("audit activity is permission-aware and does not expose empty exports", () => {
  assert.match(source, /ctx\.can\("audit\.view"\)/);
  assert.match(source, /tone="permission"/);
  assert.match(source, /disabled=\{!hasActivities\}/);
  assert.match(source, /canViewAudit \? \(/);
});

test("audit CSV escapes every heading and persisted value", () => {
  assert.match(source, /export function escapeCsvCell/);
  assert.match(source, /\.map\(escapeCsvCell\)/);
  assert.match(source, /head\.map\(escapeCsvCell\)/);
  assert.match(source, /replace\(\/"\/g, '""'\)/);
});

test("audit metadata uses accessible icons and directional isolation", () => {
  assert.match(source, /<time[^>]+dateTime=\{a\.createdAt\}/);
  assert.match(source, /<IconClock/);
  assert.match(source, /<IconGlobe/);
  assert.match(source, /<bdi dir="ltr">\{a\.ip\}<\/bdi>/);
  assert.doesNotMatch(source, /🕒|🌐/);
  assert.doesNotMatch(source, /text-slate-|dark:text-zinc-|divide-slate-/);
});
