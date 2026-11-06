import { createHash } from "node:crypto";

export const BASELINE_TABLE = "drizzle.__calmboard_development_baseline";
export const REVIEWED_PREFIX_LENGTH = 67;
export const REVIEWED_PREFIX_DIGEST = "a0e4e933a28f0d38f04c2a0694bcb58f4d373ff2acf483bd0069e63ea6923d3b";
export const DEVELOPMENT_HASH_EXCEPTIONS = [
  {
    tag: "0040_secret_reptil",
    historical: "8bb14833c0608cadfe328befb0e0c68c20b6e0e4a4b4730d7698f595d4122b71",
    current: "0eb5feac648d7301c283736bd9797bdd0fba5699f6db1ee2a22b38878220a473",
  },
  {
    tag: "0041_productive_roland_deschain",
    historical: "d666c6d25ad5c2127505f091ce0af217a77058dfa44aea93aa12ddf8c98afab8",
    current: "916e0f56f7b27f2a3bd317a963605689967f84c5e55460c72023a574135334a2",
  },
];

export function canonicalJson(value) {
  return JSON.stringify(value, (_, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}
export const digest = (value) => createHash("sha256").update(canonicalJson(value)).digest("hex");
export const migrationManifest = (migrations) =>
  migrations.map(({ idx, tag, when, hash }) => ({ idx, tag, when, hash }));
export const normalizedHistory = (rows) =>
  rows
    .map(({ id, hash, created_at }) => ({ id, hash, created_at: String(created_at) }))
    .sort((a, b) => Number(a.created_at) - Number(b.created_at) || a.id - b.id);
export function assertDevelopmentEnvironment(environment) {
  if (!["development", "local", "test"].includes(environment))
    throw new Error("A development baseline cannot be created or used in this environment.");
}
export async function databaseIdentity(client) {
  return (
    await client.query(
      "select (select system_identifier::text from pg_control_system()) as system_identifier, oid::text as database_oid, datname as database_name from pg_database where datname=current_database()",
    )
  ).rows[0];
}

export function validateDevelopmentBaseline({ document, documentHash, identity, migrations, rows, environment }) {
  assertDevelopmentEnvironment(environment);
  if (digest(document) !== documentHash || document.version !== 1 || document.scope !== "development")
    throw new Error("Invalid development baseline document.");
  if (canonicalJson(document.identity) !== canonicalJson(identity))
    throw new Error("Development baseline belongs to another database identity.");
  const prefix = migrations.slice(0, REVIEWED_PREFIX_LENGTH);
  if (
    prefix.length !== REVIEWED_PREFIX_LENGTH ||
    digest(migrationManifest(prefix)) !== REVIEWED_PREFIX_DIGEST ||
    document.manifestDigest !== REVIEWED_PREFIX_DIGEST
  )
    throw new Error("Development baseline migration prefix changed.");
  const timestamps = new Set(prefix.map((entry) => String(entry.when)));
  const history = normalizedHistory(rows.filter((row) => timestamps.has(String(row.created_at))));
  if (history.length !== REVIEWED_PREFIX_LENGTH || digest(history) !== document.historyDigest)
    throw new Error("Development baseline historical records changed.");
  if (canonicalJson(document.exceptions) !== canonicalJson(DEVELOPMENT_HASH_EXCEPTIONS))
    throw new Error("Development baseline exceptions changed.");
  if (
    !document.reason?.trim() ||
    !Number.isFinite(Date.parse(document.approvedAt)) ||
    !/^[a-f0-9]{64}$/.test(document.evidence?.receiptDigest || "") ||
    !/^[a-f0-9]{64}$/.test(document.evidence?.archiveSha256 || "") ||
    !/^[a-f0-9]{64}$/.test(document.evidence?.catalogDigest || "")
  )
    throw new Error("Development baseline evidence is incomplete.");
  return document.exceptions;
}

export async function readDevelopmentBaseline(client, { migrations, rows, environment }) {
  const present = (await client.query("select to_regclass($1) is not null as present", [BASELINE_TABLE])).rows[0]
    .present;
  if (!present) return [];
  assertDevelopmentEnvironment(environment);
  const records = (await client.query(`select document, document_hash from ${BASELINE_TABLE}`)).rows;
  if (records.length !== 1) throw new Error("Expected exactly one development baseline decision.");
  const identity = await databaseIdentity(client);
  return validateDevelopmentBaseline({
    document: records[0].document,
    documentHash: records[0].document_hash,
    identity,
    migrations,
    rows,
    environment,
  });
}
