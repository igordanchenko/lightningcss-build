# Contributing

Thank you for taking the time to contribute to `lightningcss-build`.

## Code of Conduct

`lightningcss-build` has adopted the
[Contributor Covenant](https://www.contributor-covenant.org/) as its Code of
Conduct, and we expect project participants to adhere to it. Please read
[the full text](CODE_OF_CONDUCT.md) so that you can understand what actions will
and will not be tolerated.

## Submitting an Issue

Open an issue at <https://github.com/igordanchenko/lightningcss-build/issues>.
Please include:

- Node version (`node --version`).
- A minimal repro — ideally the `lightningcss-build` command, the `src/` tree,
  and the observed vs. expected output.
- For watch-mode issues, the sequence of edits that triggered the bug.

For security issues, **do not open a public issue** — see
[`SECURITY.md`](SECURITY.md).

## Sending a Pull Request

1. For non-trivial changes, open an issue first to align on the approach.
2. Fork the repository and create a topic branch from `main`.
3. Add tests for any behavior changes.
4. Run `npm run ci` locally — it must pass before you submit.
5. Open a PR, link the issue if applicable, and describe what changed and why.

### Setup

```sh
git clone https://github.com/igordanchenko/lightningcss-build.git
cd lightningcss-build
npm install
```

### Scripts

| Script         | Purpose                                  |
| -------------- | ---------------------------------------- |
| `npm test`     | Run the Vitest suite                     |
| `npm run lint` | Run ESLint                               |
| `npm run ci`   | Lint + test (what CI runs on every push) |

To run a single test file or match by name:

```sh
npx vitest run test/build.test.js
npx vitest run -t "name substring"
```

### Commit messages

Commits must follow
[Conventional Commits](https://www.conventionalcommits.org/). `commitlint` runs
on every commit via Husky and will reject messages that don't conform.

Prefer narrow, focused commits — semantic-release derives the version bump and
changelog entry from each commit's type and body.

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`, `build`.

### Code style

- ESLint and Prettier run on staged files via `lint-staged`. You normally don't
  need to run them manually — the pre-commit hook formats and fixes on its own.
- If a hook fails, fix the reported issue and re-stage rather than bypassing
  with `--no-verify`.

### Tests

The test suite spawns the real CLI via `child_process.spawn` against
`bin/cli.js` in a temporary directory. This is intentional — it exercises `argv`
parsing, exit codes, and stderr formatting the same way a user would.

When adding behavior, prefer adding a test that drives the CLI end-to-end over a
unit test against an internal helper. See `test/helpers.js` for the
temp-directory and watcher helpers (`startWatcher`, `waitFor`).

### Releases

Releases are automated by
[semantic-release](https://github.com/semantic-release/semantic-release) on
merges to `main`. You do not need to bump the version or edit `CHANGELOG.md`.

## License

By contributing code to this repository, you agree to license your contributions
under the project's [MIT License](LICENSE).
