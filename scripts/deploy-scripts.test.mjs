import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const restoreScript = await readFile(new URL("../deploy/restore.sh", import.meta.url), "utf8");

test("restore drill stays isolated from the live Compose stack", () => {
  assert.match(
    restoreScript,
    /RESTORE_COMPOSE_FILE="\$\{RESTORE_COMPOSE_FILE:-\$SCRIPT_DIR\/docker-compose\.restore\.yml\}"/,
  );
  assert.match(restoreScript, /docker compose --project-name "\$RESTORE_PROJECT_NAME"/);
});

test("restore is portable across database role names", () => {
  assert.match(restoreScript, /pg_restore[\s\S]*--clean --if-exists --no-owner --no-privileges/);
});
