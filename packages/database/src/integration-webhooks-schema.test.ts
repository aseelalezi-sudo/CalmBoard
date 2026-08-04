import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { integrationWebhookEndpoints, integrationWebhookReceipts } from "./schema.js";

describe("integration webhook replay schema", () => {
  it("stores only a hash of the unguessable endpoint token", () => {
    const columns = getTableColumns(integrationWebhookEndpoints);
    assert.equal(columns.organizationId.notNull, true);
    assert.equal(columns.workspaceId.notNull, true);
    assert.equal(columns.endpointKeyHash.notNull, true);
    assert.equal(columns.createdBy.notNull, true);
    assert.equal("endpointToken" in columns, false);
    assert.equal("signingSecret" in columns, false);
  });

  it("records delivery identity and payload digest without retaining webhook bodies", () => {
    const columns = getTableColumns(integrationWebhookReceipts);
    assert.equal(columns.endpointId.notNull, true);
    assert.equal(columns.deliveryId.notNull, true);
    assert.equal(columns.payloadSha256.notNull, true);
    assert.equal(columns.receivedAt.notNull, true);
    assert.equal("payload" in columns, false);
    assert.equal("rawBody" in columns, false);
  });
});
