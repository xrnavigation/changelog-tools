# changelog-tools

The one copy of the changelog note helper and checker used by every Audiom repository. Fix them here; no repository keeps its own copy.

## Pull request check

In a repository's `.github/workflows/changelog.yml`:

```yaml
on:
  pull_request:
    branches: [master]
    types: [opened, synchronize, reopened]

permissions:
  contents: read

jobs:
  notes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: xrnavigation/changelog-tools@main
        with:
          base: ${{ github.event.pull_request.base.sha }}
          head: ${{ github.event.pull_request.head.sha }}
```

The check compares the pull request against the commit where its branch left the base branch. It fails when product files change without a new `.changelog/<id>.json`, or when a published note is edited.

## Writing a note

Add a new `.changelog/<id>.json` with each behavior, API, dependency or operational change, direct commits included. Use a stable lowercase ID, a category (Added, Changed, Deprecated, Removed, Fixed or Security) and a concrete summary of the outcome. Optional `details` give technical context. Breaking changes need `"breaking": true` and a `migration` string. Internal work needs `"kind": "internal"` and a specific `reason`.

```json
{"id":"loader-retry","category":"Fixed","summary":"Retry temporary source failures without losing the current map."}
```

```json
{"id":"build-cleanup","kind":"internal","reason":"Simplify build diagnostics without changing shipped behavior."}
```

Published notes are immutable; a correction is a new note. Don't reuse IDs or edit old notes to satisfy the check.

In a repository with a `package.json`, add the package as a dev dependency and two scripts:

```json
"devDependencies": { "changelog-tools": "git+https://github.com/xrnavigation/changelog-tools.git" },
"scripts": {
	"changelog:add": "changelog-note",
	"changelog:note:check": "check-changelog-note --staged"
}
```

Then `npm run changelog:add` writes a note (add `-- --help` for flags), and `npm run changelog:note:check` checks the staged change. Without a `package.json`, run `npx -p git+https://github.com/xrnavigation/changelog-tools.git changelog-note`.

For a merge that went in without a note, the front end's `node scripts/changelog.mjs pending <source> <checkout>` lists it; add a recovery note in the owning repository with `--integration FULL_SHA`.

## Tests

`npm test`
