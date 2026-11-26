# ANY-917 validation

## Integration with ANY-916

After #89 landed on `main` at `f67a11ae53cd6e675e1d31e8b5eb503f08307d6d`, #88 adopted that dependency graph. It resolves Vitest, its mocker and V8 coverage to 5.1.2, Vite to 8.3.8, WXT to 0.21.5, and Undici to 7.30.2. The two package files differ from that revision only in the Node engine range. The registration tests retain the upstream mock reset and strict typing alongside the one-shot mock and stronger recovery assertions from #88.

The merged lockfile SHA-256 is `32166579c5b285a6f44fc633d3210dc24137c2569cdbfdd30de1d05b62355dce`. Trivy 0.76.2 with the recorded database reported zero findings in the complete merged lockfile. An inventory run with `--list-all-pkgs` confirmed 695 npm packages. The findings register reflects the merged package versions. The sections below preserve the earlier comparison and its command output.

The baseline is `gushinets/PromptTune` at `dad28ff8f26991a366837e6dcea82cc13eeb6252`, fetched from `origin/main`. The `codex/any-917` branch combines the extension dependency changes from #71 and the Undici package entry from #65.

| Candidate | Head | Base | Required CI at candidate head |
| --- | --- | --- | --- |
| [#65](https://github.com/gushinets/PromptTune/pull/65) | `65ca90540593f9516e9977dce19705259206d49e` | `c4340d458c2550cb77a640c4f3b7e81346ee0c88` | [Passed](https://github.com/gushinets/PromptTune/actions/runs/45346337352/job/138282336790) |
| [#68](https://github.com/gushinets/PromptTune/pull/68) | `70914a7e2ae12eb98d460c5a9386728d8fe51af6` | `c4340d458c2550cb77a640c4f3b7e81346ee0c88` | [Failed](https://github.com/gushinets/PromptTune/actions/runs/45346348455/job/138282322418) |
| [#69](https://github.com/gushinets/PromptTune/pull/69) | `d02d9cee04c53c223c93d657dc566aedaf34dd70` | `c4340d458c2550cb77a640c4f3b7e81346ee0c88` | [Failed](https://github.com/gushinets/PromptTune/actions/runs/45346351793/job/138282498913) |
| [#71](https://github.com/gushinets/PromptTune/pull/71) | `7699230aaf8e8a34ef9bd2453edde151f0635a3e` | `c4340d458c2550cb77a640c4f3b7e81346ee0c88` | [Failed](https://github.com/gushinets/PromptTune/actions/runs/45346370782/job/138282337528) |

The extension trees of #68, #69 and #71 were identical. GitHub returned no formal reviews or inline comments for these four PRs. #65 and #69 were open, and #68 and #71 were closed without merging. ANY-918 can begin independent ESLint dependency work. Its #59 proposal overlaps the Vitest coverage resolution, and the final transitive audit needs the combined lockfile. [ANY-918](https://linear.app/paveldik/issue/ANY-918)

## Dependency selection

`vitest`, `@vitest/mocker` and `@vitest/coverage-v8` resolve to 5.1.1. Coverage declares an exact peer dependency on Vitest 5.1.1. Vitest accepts Node 22.13.0 and resolves its Vite peer to the existing top-level Vite 8.0.8. The nested Vite 7.3.2 under WXT's `vite-node` remains in the graph. The obsolete `coverage.all` setting was removed. The explicit inclusion patterns still cover eligible files that the tests do not load. The configuration uses the default worker pool and has no worker-specific options or IDs. [Vitest 4 migration guide](https://v4.vitest.dev/guide/migration) · [Vitest 5 migration guide](https://vitest.dev/guide/migration/)

The #71 dependency graph removes 54 lockfile paths and adds seven, including the relocated mocker. It updates shared Babel, source-map and glob-matching dependencies used by the new test graph. Among existing paths the only additional version change beyond #71 is `undici` 7.24.8 → 7.30.2, within jsdom 28.1.0's `^7.21.0` requirement. There is one installed Undici path in each lockfile. There are no installed `glob` or `tinypool` paths in the combined lockfile. The change uses upstream releases and requires no overrides.

The PR review follow-up aligns the extension engine declaration with Vitest's supported Node versions: `^22.13.0 || ^24.0.0 || >=26.0.0`. The existing minimum stays at 22.13.0. Node 23 was already excluded by jsdom's engine range, and Vitest 5 also excludes Node 25. The follow-up changes only the root engine metadata in the lockfile. Trivy returned the same 73 matches using the recorded database. The new lockfile SHA-256 is `963824fdf6eb504dd2330222c5783f2ec34eb44c84fe1e711a66ff122e3c4d50`.

## Registration timeout

The midnight interleaving test installed a persistent replacement on the shared `browser.alarms.get` mock. Each call created a new pending promise. The test released its own call, but the implementation survived teardown. Vitest 5 inherits the Vitest 4 behavior where `vi.restoreAllMocks()` restores spies and leaves plain `vi.fn()` implementations in place. Clearing mock history also leaves implementations in place. During the later installation test the background reached `cleanupSelections()`, which awaited the selection-cleanup alarm lookup. There was no resolver for that call.

The fix scopes the deferred response to one invocation. The recovery test asserts the welcome URL, confirms that registration waits for storage recovery, fires the timestamp alarm on a newly initialized background, and checks the original date, the registration marker, the single request and alarm cleanup. The production path and the 5-second test limit are unchanged.

## Local checks

Runs used Windows x64, PowerShell, Node 22.13.0 and npm 10.9.2. Commands below run from `extension`. Each dependency set was installed with `npm ci --no-audit` in an isolated directory with a dedicated npm cache and temporary directory. Trivy provided the security check. The first exploratory install used host Node 24 and stalled during npm audit. A test invocation before that install finished could not resolve the executable. The recorded comparison starts with a clean install on the CI Node version.

| Configuration | Command or selection | Result |
| --- | --- | --- |
| Baseline Vitest 3.2.4 | Target only, then entire registration file | 1/1 and 17/17 passed |
| #71 Vitest 5.1.1 | Target only | 1/1 passed |
| #71 Vitest 5.1.1 | Midnight test and target in file order | Target timed out at 5 seconds |
| #71 Vitest 5.1.1 | Entire registration file | 16 passed, target timed out at 5 seconds |
| #71 with only the one-shot mock change | Midnight test and target in file order | 2/2 passed |
| Combined lockfile and final tests | Pair, target only three times, then entire registration file | 2/2, 3 × 1/1, 17/17 passed |
| Combined lockfile | `npm run test:coverage` | 453/453 tests in 30 files. Line coverage 87.11% |
| Combined lockfile | `npm run lint`, `npm run typecheck`, `npm run format:check` | All passed |

```powershell
npm test -- __tests__/installation-registration.test.ts -t 'opens welcome despite'
npm test -- __tests__/installation-registration.test.ts -t 'overtakes slow install cleanup|opens welcome despite'
npm test -- __tests__/installation-registration.test.ts
```

The [command output](test-output.log) retains the original timeout and the follow-up control results.

## Trivy

Both scans targeted an isolated directory containing one exact copy of `extension/package-lock.json`. The local JSON report exposes package-level results. The repository workflow uses the same scanner version and dev-dependency setting and scans the checkout root into SARIF.

Use one downloaded database for both scans. The recorded database is schema 2, updated at `2026-11-25T13:07:24.554567818Z` and downloaded at `2026-11-25T14:53:07.7368769Z`. Its SHA-256 is `1581858ec699c28954260a6ef6ce88d151a6ef374b05b060bf5eafd33114146a`. The input files had SHA-256 values `a667ff02580444bf12d6681e00876cc248494ea18be1e2b636df7e9fb9465b65` (baseline) and `8324036ba0c0d5c4cde88321b0b7298ac729435c75a8ebd042769809db592c71` (combined).

```powershell
trivy --cache-dir $cache fs --download-db-only
trivy --cache-dir $cache --version
foreach ($revision in 'baseline', 'final') {
    trivy --cache-dir $cache fs --skip-db-update --skip-java-db-update --offline-scan `
      --scanners vuln --include-dev-deps --format json `
      --output "$evidence/$revision-scan.json" "$evidence/$revision"
}
```

Both scans exited 0. The [findings register](findings.csv) accounts for the scoped rows below. Scanner matching and package presence are recorded separately. No exploit testing or scanner exceptions were applied.

| Package | Baseline matches | Baseline Critical | Final matches |
| --- | ---: | ---: | ---: |
| `vitest` | 2 | 1 | 0 |
| `@vitest/mocker` | 2 | 0 | 0 |
| `tinypool` | 2 | 2 | 0 |
| `glob` | 1 | 0 | 0 |
| `undici` | 29 | 0 | 0 |
| **Total** | **36** | **3** | **0** |

The complete lockfile scan reported 116 → 73 rows. Six `brace-expansion` 2.1.0 matches and one `minimatch` 9.0.9 match also disappeared with the old coverage subtree. Other installed versions still have matches. They remain outside ANY-917 and are covered by the follow-up dependency work.

## Release packaging

The [release workflow](../../.github/workflows/release-extension.yml) installs dev dependencies with `npm ci`. This installs Vitest, its V8 coverage provider, and the jsdom → Undici dependency. The npm prepare lifecycle runs `wxt prepare`. The packaging script invokes `wxt zip`, which uses WXT and Vite to build the browser assets. The workflow has no test or coverage step.

```powershell
npm run build
$env:VITE_BACKEND_MODE = 'fastapi'
$env:VITE_API_BASE_URL = 'https://api.anytoolai.store'
npm run zip -- --browser chrome
npm run zip -- --browser firefox
```

All three commands succeeded. Each browser ZIP had 24 entries. Inspection of the archive paths and packaged JavaScript found no test dependency paths or bundle markers. Firefox also generated a separate source ZIP, which the workflow's `*-${{ matrix.browser }}.zip` upload filter excludes. Archive hashes and entry lists are in the [command output](test-output.log).
