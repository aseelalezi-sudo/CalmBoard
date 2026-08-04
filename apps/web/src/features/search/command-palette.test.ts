import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Command Palette is backed by the shared Search API instead of loaded workspace arrays", async () => {
  const [paletteSource, shellSource] = await Promise.all([
    readFile(new URL("./command-palette.tsx", import.meta.url), "utf8"),
    readFile(new URL("../shell/calmboard-app.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(paletteSource, /useCommandSearch\(/);
  assert.doesNotMatch(paletteSource, /tasks\.filter|projects\.filter|docs\.filter|members\.filter/);
  const paletteInvocation = shellSource.match(/<CommandPalette[\s\S]*?\/>/)?.[0] ?? "";
  assert.match(paletteInvocation, /scope=/);
  assert.doesNotMatch(paletteInvocation, /tasks=|docs=|members=/);
});
