import { timingSafeEqual } from "node:crypto";

export function validMetricsAuthorization(authorization: string | undefined, token: string) {
  const supplied = Buffer.from(authorization ?? "", "utf8");
  const expected = Buffer.from(`Bearer ${token}`, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
