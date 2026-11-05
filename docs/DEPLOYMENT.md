# Release and Linux server deployment

Status: release **configuration** and local deployment tests are prepared. No release has been published by this task; no deployment or ModsTest test on `redmagic.club` has been performed. Installation requires access to the server's filesystem or the Foundry Setup administrator, not merely a GM world account.

## Release assets and stable URLs

The tag workflow validates JavaScript, unit tests, Chromium fixtures, deployment tests and the package. A stable tag must exactly match `v<module.json version>`, currently `v0.1.0`. It uploads all four assets to a draft release before publishing it as latest. Ordinary branch pushes and PRs only validate and upload a CI artifact. The target Foundry and D&D5e versions remain 14 / 6.0.6; in-game certification is still pending.

After review/merge and when ready to publish, a maintainer can tag the intended commit:

```sh
git tag v0.1.0 <reviewed-commit>
git push origin v0.1.0
```

Do not retag an existing version. A rerun fails if the release already exists instead of overwriting published assets; if an upload fails, inspect the unpublished draft and fix/delete that draft before rerunning. Once published:

| Asset | Stable latest URL |
| --- | --- |
| Foundry installation Manifest | `https://github.com/DraculaCradle/bg3-video-hud/releases/latest/download/module.json` |
| ZIP | `https://github.com/DraculaCradle/bg3-video-hud/releases/latest/download/bg3-video-hud.zip` |
| Linux deployment script | `https://github.com/DraculaCradle/bg3-video-hud/releases/latest/download/deploy_linux.py` |
| SHA-256 checksums | `https://github.com/DraculaCradle/bg3-video-hud/releases/latest/download/SHA256SUMS` |

These are configured URLs, not currently verified live download endpoints. The manifest's `download` uses the immutable **versioned** `releases/download/v0.1.0/bg3-video-hud.zip` URL so that its version and content agree. Subsequent releases must update `module.json` version/download and `package.json`/lockfile together. The installed ZIP has `module.json` at its root, all local/transitive JavaScript imports, CSS and documentation; no upstream module source, worlds, private references or credentials are bundled. Both upstream modules must be installed separately.

## Prerequisites

- Linux, Python **3.9+**, a local trusted ZIP and `deploy_linux.py` (from `dist/` after `npm run package`, or the same versioned release). No pip/npm packages are required **on the server**.
- Identify the actual Foundry **user data root** from your server configuration or process `--dataPath` argument. `--data-dir` must point to the directory **containing** `Data/`, not the application install directory and not `Data/modules/`. No absolute installation path or service name is assumed.
- Existing `Data/modules`, D&D5e **6.0.6** at `Data/systems/dnd5e`, and both public modules >=0.8.0 at `Data/modules/bg3-hud-core` and `Data/modules/bg3-hud-dnd5e`. Tested integration target remains 0.8.0. The script checks manifests but does not download, modify or enable those dependencies.
- Back up the test world and stop Foundry using your actual systemd unit, container manager or process supervisor. The script does not guess a service name, stop/restart processes, or claim to detect all running servers. `--server-stopped` is the administrator's explicit declaration.
- Run as the Foundry service user where possible. Existing module uid/gid are preserved by default. A first installation as root requires `--owner USER[:GROUP]`; output files use 0644, directories 0755. Unprivileged users cannot silently change ownership to another user or an unrelated group. Parent-directory permissions and sufficient staging space are checked. ACLs, capabilities and SELinux labels are not automatically recreated; apply your server's normal labeling policy before restart if relevant.

## Inspect, then deploy

Use your actual values for these shell variables; they are intentionally not defaulted to any server path:

```sh
foundry_user_data='/replace/with/actual/user-data-root'
release_files='/replace/with/directory-containing-the-four-assets'
foundry_service_user='replace-with-service-account'

cd "$release_files"
sha256sum --check SHA256SUMS

# After stopping your real service/container:
python3 deploy_linux.py --data-dir "$foundry_user_data" \
  --zip bg3-video-hud.zip --owner "$foundry_service_user" \
  --server-stopped --dry-run

python3 deploy_linux.py --data-dir "$foundry_user_data" \
  --zip bg3-video-hud.zip --owner "$foundry_service_user" \
  --server-stopped
```

`FOUNDRY_DATA_DIR` can supply the data root instead of `--data-dir`. `--backup-dir /your/chosen/backup-parent` changes the default `<data-dir>/.bg3-video-hud-backups`. The ZIP may additionally be checked against a trusted expected digest with `--sha256 <64-hex-characters>`. Release checksums detect corruption; establish the release source and review the script before executing it. Download all four assets from the **same versioned release** to avoid a latest-release race between separate requests. TLS/checksum verification must remain enabled.

`--dry-run` validates paths, permissions, ownership, payload/dependencies and the current module without creating a lock, stage, backup or target. It still requires the stopped-server declaration. A successful dry run does not guarantee that permissions/disk space cannot change before the real operation.

## Transaction and recovery

1. Validate ZIP CRCs, size/file limits, module identity/target, root manifest assets and the transitive local JavaScript import graph. Reject path traversal, links, special files, encrypted and duplicate entries. A linked target or existing linked/special module files are rejected instead of following them.
2. Acquire the module-specific advisory lock in `Data/modules`, stage on the same filesystem, set ownership/modes and verify the staged bytes.
3. For upgrades, copy **all existing module files**, including local extras, into a private timestamped backup with `deployment.json`; verify the copy before touching the live module. Backups are retained without automatic pruning. Keep enough space on the chosen backup filesystem; backup failures leave the live module unchanged.
4. Rename the old module into the temporary transaction directory, rename the new module into place and verify every installed byte. These are two atomic renames with a short gap; this is why Foundry must be stopped. Updates never merge stale old files into the new package.
5. On a caught error, Ctrl-C or SIGTERM, restore the exact old directory, or remove an incomplete first installation. If rollback itself fails, preserve the old directory and verified backup and report both recovery locations. Exit is nonzero on failure. The persistent lock file is intentional; do not delete it to work around another active installer.

To restore a verified backup later, stop Foundry again and use the **backup directory printed by the successful earlier deployment**:

```sh
python3 deploy_linux.py --data-dir "$foundry_user_data" \
  --rollback '/actual/backup-parent/timestamp-and-suffix' \
  --server-stopped
```

The current module is backed up before restoration too. This operation restores module files, not world databases or actor flags. Checks do not make power loss, kernel failure or SIGKILL recoverable automatically. If an uncatchable interruption leaves `Data/modules/.bg3-video-hud-stage-*/previous`, keep Foundry stopped, preserve that directory and the verified backup, and restore with administrator review; do not delete transaction directories blindly. Other installers must not change this module concurrently; only this script observes its advisory lock.

Restart Foundry using the real service/container manager, then enable this module and its dependencies in **ModsTest**, opt in per client, and complete [the in-game checklist](MANUAL_TESTS.md) as both GM and Player1. These server and world steps remain **NOT RUN** until server access is available. Do not treat the local temporary-directory deployment tests or Chromium fixtures as a live-server result.
