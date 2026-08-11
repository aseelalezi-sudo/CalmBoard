export const retentionClassifications = ["PURGE", "ANONYMIZE", "RETAIN_UNTIL_POLICY", "EXTERNAL_REVOCATION"] as const;

export type RetentionClassification = (typeof retentionClassifications)[number];

export const organizationPurgeDomains = [
  "organization_relational",
  "attachments",
  "attachment_previews",
  "documents",
  "exports",
  "reports",
  "integration_oauth",
  "billing_provider",
  "final_verification",
] as const;

export type OrganizationPurgeDomain = (typeof organizationPurgeDomains)[number];

export type OrganizationPurgePolicy = {
  enabled: boolean;
  classifications?: Record<OrganizationPurgeDomain, RetentionClassification>;
};

export function readOrganizationPurgePolicy(env: NodeJS.ProcessEnv = process.env): OrganizationPurgePolicy {
  if (env.ORGANIZATION_PURGE_ENABLED !== "true") return { enabled: false };
  const serialized = env.DATA_RETENTION_CLASSIFICATIONS_JSON;
  if (!serialized)
    throw new Error("DATA_RETENTION_CLASSIFICATIONS_JSON is required when Organization purge is enabled");
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("DATA_RETENTION_CLASSIFICATIONS_JSON must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("DATA_RETENTION_CLASSIFICATIONS_JSON must be an object");
  }
  const input = parsed as Record<string, unknown>;
  const unexpected = Object.keys(input).filter(
    (domain) => !organizationPurgeDomains.includes(domain as OrganizationPurgeDomain),
  );
  if (unexpected.length) throw new Error(`Unknown retention domains: ${unexpected.sort().join(", ")}`);

  const classifications = {} as Record<OrganizationPurgeDomain, RetentionClassification>;
  for (const domain of organizationPurgeDomains) {
    const classification = input[domain];
    if (!retentionClassifications.includes(classification as RetentionClassification)) {
      throw new Error(`Retention classification is required for ${domain}`);
    }
    classifications[domain] = classification as RetentionClassification;
  }
  const unresolved = organizationPurgeDomains.filter((domain) => classifications[domain] === "RETAIN_UNTIL_POLICY");
  if (unresolved.length) {
    throw new Error(`Organization purge is blocked by unresolved retention policy: ${unresolved.join(", ")}`);
  }
  return { enabled: true, classifications };
}
