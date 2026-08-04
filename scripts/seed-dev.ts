if (process.env.NODE_ENV === "production") {
  throw new Error("Development seed cannot run with NODE_ENV=production.");
}

async function main() {
  const { pool, runDevelopmentSeed } = await import("../packages/database/src/index");
  try {
    const result = await runDevelopmentSeed();
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
