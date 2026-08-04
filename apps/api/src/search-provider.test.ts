import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/calmboard_test";

const { createSearchProvider, emptySearchResults, MAX_SEARCH_QUERY_LENGTH, PostgreSqlSearchProvider } =
  await import("./search-provider.js");
const { SearchController } = await import("./operations.controller.js");
type SearchProvider = import("./search-provider.js").SearchProvider;

describe("search provider abstraction", () => {
  it("selects PostgreSQL by default and normalizes the configured provider name", () => {
    assert.ok(createSearchProvider({}) instanceof PostgreSqlSearchProvider);
    assert.ok(createSearchProvider({ SEARCH_PROVIDER: "  PostgreSQL " }) instanceof PostgreSqlSearchProvider);
  });

  it("accepts an external adapter registry without changing the controller contract", () => {
    const externalProvider: SearchProvider = {
      provider: "external-test",
      async search() {
        return emptySearchResults();
      },
    };
    const selected = createSearchProvider({ SEARCH_PROVIDER: "EXTERNAL" }, { external: () => externalProvider });
    assert.equal(selected, externalProvider);
  });

  it("fails closed when a configured provider has no adapter", () => {
    assert.throws(
      () => createSearchProvider({ SEARCH_PROVIDER: "missing" }),
      (error: unknown) =>
        error instanceof ServiceUnavailableException &&
        error.getStatus() === 503 &&
        error.message === "Search provider 'missing' is not configured.",
    );
  });

  it("routes normalized, tenant-scoped searches through the injected provider", async () => {
    const calls: Array<{ query: string; organizationId?: string; workspaceId?: string; actorId?: string }> = [];
    const provider: SearchProvider = {
      provider: "test",
      async search(context, query) {
        calls.push({ query, ...context });
        return emptySearchResults();
      },
    };
    const controller = new SearchController(provider);

    assert.deepEqual(await controller.search("  Atlas  ", "org-1", "workspace-1", "actor-1"), emptySearchResults());
    assert.deepEqual(calls, [
      { query: "Atlas", organizationId: "org-1", workspaceId: "workspace-1", actorId: "actor-1" },
    ]);

    assert.deepEqual(controller.search("a", "org-1", "workspace-1", "actor-1"), emptySearchResults());
    assert.equal(calls.length, 1);
    assert.throws(
      () => controller.search("x".repeat(MAX_SEARCH_QUERY_LENGTH + 1), "org-1", "workspace-1", "actor-1"),
      /q must not exceed 200 characters/,
    );
    assert.equal(calls.length, 1);
  });
});
