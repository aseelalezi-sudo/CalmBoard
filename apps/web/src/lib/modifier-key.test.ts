import assert from "node:assert/strict";
import { it } from "node:test";
import { modifierKeyLabel } from "./modifier-key";

it("uses the platform's own modifier key in shortcut hints", () => {
  assert.equal(modifierKeyLabel("MacIntel"), "⌘");
  assert.equal(modifierKeyLabel("iPhone"), "⌘");
  assert.equal(modifierKeyLabel("Win32"), "Ctrl");
  assert.equal(modifierKeyLabel("Linux x86_64"), "Ctrl");
  assert.equal(modifierKeyLabel(""), "Ctrl");
});
