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

Add the package as a dev dependency and two scripts:

```json
"devDependencies": { "changelog-tools": "github:xrnavigation/changelog-tools" },
"scripts": {
	"changelog:add": "changelog-note",
	"changelog:note:check": "check-changelog-note --staged"
}
```

Then `npm run changelog:add` writes a note (add `-- --help` for flags), and `npm run changelog:note:check` checks the staged change.

## Tests

`npm test`
