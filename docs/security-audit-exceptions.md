# Dependency audit exceptions

CI runs `pnpm audit --audit-level high` over every dependency, including development tooling. An advisory may be
ignored only when no patched release exists, and only with a reason recorded here and in `pnpm.auditConfig.ignoreGhsas`
in the root `package.json`. Review this list whenever dependencies are upgraded and remove an entry as soon as a fix is
published.

| Advisory                                                                 | Package        | Why it is ignored                                                                                                                                                                                                                             | Review  |
| ------------------------------------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | `braces` 3.0.3 | Stack exhaustion when expanding an attacker-controlled brace pattern. No patched version exists (3.0.3 is the latest release). It is only reachable through `eslint-config-next` → `fast-glob` → `micromatch`, which expand repository paths. | Monthly |

## How to remove an exception

1. Check `npm view <package> versions` for a release that satisfies the advisory's patched range.
2. Add a `pnpm.overrides` entry for it, or upgrade the parent package.
3. Delete the ID from `pnpm.auditConfig.ignoreGhsas` and the row above, then run `pnpm audit --audit-level high`.
