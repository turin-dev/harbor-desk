# npm publishing

Harbor Desk publishes the server-side `harbor-desk` package from the tagged
GitHub Release workflow. The workflow uses npm Trusted Publishing through
GitHub Actions OIDC; it does not use an `NPM_TOKEN` or another long-lived write
credential.

## One-time npm configuration

Configure the package's Trusted Publisher in npm with these exact values:

- Package: `harbor-desk`
- Repository owner: `turin-dev`
- Repository: `harbor-desk`
- Workflow filename: `.github/workflows/release.yml`

The publisher must be configured before a release tag is dispatched. The
workflow intentionally fails closed when npm rejects the OIDC exchange, so a
GitHub Release is not published with a misleading npm status.

## Release behavior

The release workflow builds and validates one exact tarball, then the npm job:

1. checks the root, tag, and tarball versions;
2. uses Node.js 24 with npm 11.5.1 or newer;
3. refuses to overwrite an existing exact npm version;
4. publishes a new preview with the `preview` dist-tag and provenance; and
5. verifies the published repository metadata and integrity value.

The GitHub Release is published only after that verification succeeds. Preview
versions do not replace npm's `latest` dist-tag. Use an exact version when
testing a preview:

```powershell
npm view harbor-desk@0.5.1 version
npm view harbor-desk dist-tags --json
npx --yes harbor-desk@0.5.1 --version
```

## Re-running an existing release

After changing the workflow, use `workflow_dispatch` with the existing tag,
for example `v0.5.1`. The workflow checks the already-published-version case
without attempting an overwrite, refreshes the GitHub release assets and notes,
and verifies the public npm metadata again.

If the npm package is unavailable or the Trusted Publisher configuration is
wrong, do not replace the workflow with a guessed token. Fix the npm publisher
configuration and rerun the tagged workflow instead.
