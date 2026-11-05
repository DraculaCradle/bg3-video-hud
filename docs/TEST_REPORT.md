# Test report — 2026-11-05

Scope: the v0.1.0 MVP and Linux installer at base commit `4bcdc95`, with the additional real-keyboard/viewport browser checks in this change. Tests ran in the cloud development machine, not the remote Foundry server. No player/world data was modified.

| Check | Observed result | Boundary |
| --- | --- | --- |
| `npm run check` | Passed; manifest/versioned download URL, asset paths and 12 JS files | Static validation |
| `npm test` | 22 passed, 0 failed, 0 skipped | Model, ownership, system-call delegation and User flag persistence with document doubles |
| `npm run test:browser` | 31 passed, 0 failed, 0 skipped | Real Chromium DOM/CSS/input with Foundry API fixtures |
| `npm run test:deploy` | 22 passed, 0 failed, 0 skipped | Actual temporary-directory file installation/backup/restore with injected failures |
| `npm run package` | Passed; root manifest, 12-file ZIP, transitive JS imports and separate deployment script | Local build artifacts |
| `sha256sum --check SHA256SUMS` in `dist/` | ZIP, manifest and deployment script all passed | Local artifact integrity |
| `git diff --check` | Passed | Patch whitespace |
| Remote HTTPS connectivity | Blocked; curl exit 56, CONNECT tunnel HTTP 403 from cloud proxy | The request did not reach the Foundry application |
| Remote deployment / ModsTest acceptance | **NOT RUN** | No server filesystem/Setup access is configured; server connectivity is blocked |
| GitHub Release publication / release URLs | **NOT RUN** | Workflow and URLs are configured; no release was published by this task |

Total executed automated tests: **75 passed, 0 failed, 0 skipped**. These counts do not include the blocked/unrun remote checks. This report does not claim GitHub Actions or release workflows have run remotely.

## Additional browser evidence

The Node runner uses Chromium DevTools to change the real viewport to 390×844, 650×900 and 1440×900. It checks that the HUD stays within the viewport, does not overflow horizontally, retains a nonzero scrollable panel area and switches from one column to three at the intended breakpoint.

The runner sends native DevTools keyboard input rather than calling a click handler for the new keyboard checks. Enter activates Edit; Enter on an order button changes the actual rendered item order and restores focus after rerender; Tab reaches the named Original HUD control; Enter on that control removes the custom HUD and restores the upstream shell. The existing unload-cleanup test still runs afterward. A first attempt omitted Enter's text event in the driver; that driver error was corrected and all seven added checks passed on rerun. No runtime code change was necessary for these new checks.

Earlier browser coverage remains in place for permission changes, actor/scene changes, system cancellation/errors, busy locks, namespaced persistent edits, malformed/foreign drops and upstream restoration. Deployment tests verify the actual built runtime payload, permission and checksum rejection, verified backups, caught interruption/error rollback, and retention of recovery data when rollback itself cannot complete.

## Remaining real-world acceptance

The remote world and GM/player account names have been provided. The current running cloud instance still lacks an effective allowlist entry for the server, even though configuration changes were saved separately. The 403 above is proxy evidence, not a Foundry login or application failure. No additional credential is inferred from it.

Once the running task can reach the server and an authorized server filesystem/Foundry Setup deployment route is available, install the tested ZIP, verify the real Foundry/system/dependency versions, use a backed-up ModsTest world, and execute [the full manual checklist](MANUAL_TESTS.md) as GM and ordinary player. Real spell/pact consumption, activity selection, concentration, target templates, rest dialogs, chat cards and multiplayer permissions remain unverified. Local fixtures and temporary data directories do not close any of those acceptance items.
