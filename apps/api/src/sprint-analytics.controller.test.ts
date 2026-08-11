import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { parseLimit, parseTimezone } from "./sprint-analytics.validation.js";

test("parseLimit - validates limit parameters", () => {
  assert.equal(parseLimit(undefined), 10);
  assert.equal(parseLimit(null), 10);
  assert.equal(parseLimit(""), 10);

  assert.equal(parseLimit("20"), 20);
  assert.equal(parseLimit(50), 50);
  assert.equal(parseLimit("1"), 1);

  assert.throws(() => parseLimit("51"), BadRequestException);
  assert.throws(() => parseLimit("0"), BadRequestException);
  assert.throws(() => parseLimit("-5"), BadRequestException);
  assert.throws(() => parseLimit("abc"), BadRequestException);
  assert.throws(() => parseLimit("1.5"), BadRequestException);
});

test("parseTimezone - validates IANA timezones", () => {
  assert.equal(parseTimezone(undefined), "UTC");
  assert.equal(parseTimezone(null), "UTC");
  assert.equal(parseTimezone(""), "UTC");

  assert.equal(parseTimezone("America/New_York"), "America/New_York");
  assert.equal(parseTimezone("Asia/Riyadh"), "Asia/Riyadh");

  assert.throws(() => parseTimezone("Invalid/Timezone"), BadRequestException);
  assert.throws(() => parseTimezone(123), BadRequestException);
});
