import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COMMON_NAMED_ICONS, POPULAR_EMOJIS } from "./icon-picker";
import { resolveEntityIcon } from "./entity-icon";

describe("IconPicker constants and entity resolution", () => {
  it("includes canonical named icons that all resolve to valid named components", () => {
    assert.ok(COMMON_NAMED_ICONS.length >= 20);
    for (const iconName of COMMON_NAMED_ICONS) {
      const resolved = resolveEntityIcon(iconName, "project");
      assert.equal(
        resolved.type,
        "named",
        `Expected icon "${iconName}" in COMMON_NAMED_ICONS to resolve to named type`,
      );
    }
  });

  it("includes popular emojis that all resolve to valid emoji type", () => {
    assert.ok(POPULAR_EMOJIS.length >= 20);
    for (const emoji of POPULAR_EMOJIS) {
      const resolved = resolveEntityIcon(emoji, "project");
      assert.equal(resolved.type, "emoji", `Expected emoji "${emoji}" in POPULAR_EMOJIS to resolve to emoji type`);
    }
  });
});
