import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

export async function migrationFixture(sql = ["select 1;", "select 2;"]) {
  const directory = await mkdtemp(join(tmpdir(), "calmboard-migration-tests-"));
  await mkdir(join(directory, "meta"));
  const entries = sql.map((_, index) => ({
    idx: index,
    version: "7",
    tag: `${String(index).padStart(4, "0")}_test`,
    when: 1000 + index,
    breakpoints: true,
  }));
  const journal = { version: "7", dialect: "postgresql", entries };
  await Promise.all(sql.map((content, index) => writeFile(join(directory, `${entries[index].tag}.sql`), content)));
  const writeJournal = (value = journal) => writeFile(join(directory, "meta/_journal.json"), JSON.stringify(value));
  await writeJournal();
  return {
    directory,
    journal,
    writeJournal,
    read: (index) => readFile(join(directory, `${entries[index].tag}.sql`)),
    write: (index, content) => writeFile(join(directory, `${entries[index].tag}.sql`), content),
    async cleanup() {
      const target = resolve(directory);
      if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("calmboard-migration-tests-"))
        throw new Error("Unsafe migration fixture cleanup path");
      await rm(target, { recursive: true, force: true });
    },
  };
}
