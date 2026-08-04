import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeAuthClient } from "./auth.controller";

describe("authentication client description", () => {
  it("stores a readable browser and device without trusting client labels", () => {
    assert.deepEqual(
      describeAuthClient("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36"),
      { device: "Windows device", browser: "Google Chrome" },
    );
    assert.deepEqual(describeAuthClient("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) Version/17.5 Safari/604.1"), {
      device: "iPhone",
      browser: "Safari",
    });
  });
});
