import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { checkDevelopmentPorts, developmentEnvironment, developmentTargets } from "./dev-all.mjs";

test("custom development ports are shared by web, API, realtime and worker", () => {
  const env = developmentEnvironment({ PORT: "5000", API_PORT: "5500", WORKER_HEALTH_PORT: "5002" });
  assert.equal(env.APP_URL, "http://localhost:5000");
  assert.equal(env.NEXT_PUBLIC_API_URL, "http://localhost:5500");
  assert.equal(env.NEXT_PUBLIC_REALTIME_URL, "http://localhost:5500");
  assert.deepEqual(
    developmentTargets(env).map(({ port }) => port),
    [5000, 5500, 5002],
  );
});

test("a stale local APP_URL follows the web port, including an inherited terminal value", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const env = developmentEnvironment({ PORT: "5000", APP_URL: `http://${host}:3000` });
    assert.equal(env.APP_URL, `http://${host}:5000`);
    assert.equal(env.PORT, "5000");
  }
  assert.equal(developmentEnvironment({ PORT: "80", APP_URL: "http://localhost:3000" }).APP_URL, "http://localhost");
});

test("explicit remote origins are preserved and invalid API origins still fail", () => {
  assert.equal(
    developmentEnvironment({ PORT: "5000", APP_URL: "https://dev.example.com" }).APP_URL,
    "https://dev.example.com",
  );
  assert.throws(
    () => developmentEnvironment({ NEXT_PUBLIC_API_URL: "http://localhost:5500" }),
    /NEXT_PUBLIC_API_URL uses port 5500/,
  );
});

test("invalid ports, collisions and unknown targets are rejected", () => {
  for (const value of ["", "0", "-1", "65536", "3000abc"]) {
    assert.throws(() => developmentEnvironment({ PORT: value }), /PORT must be an integer/);
  }
  assert.throws(() => developmentTargets(developmentEnvironment({ PORT: "4000" })), /different ports/);
  assert.throws(() => developmentTargets(developmentEnvironment({}), ["unknown"]), /Usage:/);
  assert.deepEqual(
    developmentTargets(developmentEnvironment({}), ["api"]).map(({ name }) => name),
    ["api"],
  );
});

test("development launcher cannot override a production or staging environment", () => {
  assert.throws(() => developmentEnvironment({ NODE_ENV: "production" }), /local development/);
  assert.throws(() => developmentEnvironment({ DEPLOY_ENV: "staging" }), /local development/);
});

test("port preflight detects a real occupied port without stopping its owner", async () => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  try {
    await assert.rejects(
      checkDevelopmentPorts([{ name: "web", key: "PORT", port, host: "127.0.0.1" }]),
      /already in use.*Change PORT/,
    );
    assert.equal(server.listening, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  await checkDevelopmentPorts([{ name: "web", key: "PORT", port, host: "127.0.0.1" }]);
});
