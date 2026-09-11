# Publishing Pi Web Space

- npm: `@wjbfks/pi-web-space`, public, maintained by npm user `wjbfks`.
- Source: https://github.com/WJBFks/pi-web-space
- Commands: `pws` and `pi-web-space`; default port `40141`.
- First package version: `0.1.9`, the fork's independent release version.
- Retain the upstream MIT license and copyright notice. Compatibility keys beginning with `pi-web:` or `@agegr/pi-web/session-liveness` are not package identities and must not be renamed.

## Prepare without publishing

Use a separate checkout so production output never overwrites a running development server's `.next` directory. Commit the source changes first, then clone the intended commit into a separate directory. Do not copy local `.env`, `.pi`, credentials, or development output into it.

In the release checkout:

```bash
npm ci
npm run build
npm run release:check
npm pack --json
```

`prepack` checks the package identity, command aliases, license, production build and embedded version. No script automatically publishes or increments the version. A build must be rerun after changing source or version; the version check alone does not detect every stale source change.

Review the tarball file list and size. It must include the production `.next/server`, `.next/static`, runtime dependencies declared in `package.json`, CLI and LICENSE. Development output, caches, secrets and source maps must not be shipped. The dependencies themselves are installed by npm and are not bundled into the tarball.

Install the tarball into a separate temporary directory with production dependencies only. Verify both `--help` commands and start the packaged server on an unused loopback port with `--no-open`. Verify the page and manifest, then stop it. Use an empty `PI_CODING_AGENT_DIR` for this check; do not expose personal sessions.

`node-pty` is a native dependency. Installation must resolve a binary for the target OS/architecture or compile one with that platform's build prerequisites. A successful Linux check does not establish Windows or macOS compatibility.

## Publish the reviewed tarball (manual final step)

Only after deciding to publish, authenticate interactively. Never put tokens or passwords into this repository.

```bash
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
# Expected account: wjbfks
npm publish ./wjbfks-pi-web-space-0.1.9.tgz --access public --registry=https://registry.npmjs.org/
```

Complete npm's authentication / 2FA prompts. Publish the exact reviewed tarball, not a different working directory. Publication is not performed by the preparation commands above.

## After successful publication

```bash
npm view @wjbfks/pi-web-space@0.1.9 version dist.integrity --registry=https://registry.npmjs.org/
```

Remove the “first publication pending” note from the READMEs. Create release notes for this fork and a new, unused Git tag (for example `pws-v0.1.9`, avoiding inherited upstream tags), then publish a GitHub Release in `WJBFks/pi-web-space`. Never overwrite an upstream tag or reuse an already published npm version.

For subsequent releases, explicitly select and update the version in `package.json` and `package-lock.json`, commit it, and repeat preparation in a fresh checkout.
