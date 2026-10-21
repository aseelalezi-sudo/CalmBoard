import { BlockList, isIP } from "node:net";

export type TrustProxyOption = false | string[] | ((address: string, hop: number) => boolean);

const PRIVATE_RANGES: ReadonlyArray<readonly [string, number, "ipv4" | "ipv6"]> = [
  ["127.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["::1", 128, "ipv6"],
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
];

function privateNetworks() {
  const list = new BlockList();
  for (const [network, prefix, family] of PRIVATE_RANGES) list.addSubnet(network, prefix, family);
  return list;
}

// Fastify no longer accepts a bare hop count because it cannot validate the immediate peer.
// A forwarding hop is trusted only when it is within the configured depth and its address is
// either listed in TRUST_PROXY_CIDRS or, when that list is empty, a private/loopback address.
export function resolveTrustProxy(env: NodeJS.ProcessEnv = process.env): TrustProxyOption {
  const hops = Number(env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isInteger(hops) || hops <= 0) return false;

  const cidrs = (env.TRUST_PROXY_CIDRS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const trusted = new BlockList();
  for (const cidr of cidrs) {
    const [address = "", prefix] = cidr.split("/");
    const family = isIP(address) === 6 ? "ipv6" : "ipv4";
    if (!isIP(address)) throw new Error(`TRUST_PROXY_CIDRS contains an invalid address: ${cidr}`);
    if (prefix === undefined) trusted.addAddress(address, family);
    else trusted.addSubnet(address, Number(prefix), family);
  }
  const allowed = cidrs.length > 0 ? trusted : privateNetworks();

  return (address, hop) => {
    if (hop >= hops) return false;
    const mapped = address.startsWith("::ffff:") ? address.slice(7) : address;
    const family = isIP(mapped);
    if (!family) return false;
    return allowed.check(mapped, family === 6 ? "ipv6" : "ipv4");
  };
}
