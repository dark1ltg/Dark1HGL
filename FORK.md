# dark1ltg fork notes

This repository is a **personal fork** of [Heroic Games Launcher](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher), maintained at [dark1ltg/HeroicGamesLauncher](https://github.com/dark1ltg/HeroicGamesLauncher).

It is **not** an official Heroic release channel. Upstream Discord/Patreon/Flathub support does not apply to builds from this fork.

## Goals

| Goal                 | Detail                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| GOG library folders  | Steam-style folders: point Heroic at a drive (or plug one in) and installed GOG games are scanned and imported |
| GOG-only auto-import | Batch / automatic import is **GOG only** — do not extend to Epic, Amazon, or other stores                      |
| One Linux binary     | Ship a single **x86_64 AppImage** — no Flatpak, Windows, macOS, arm64, AUR, or Flathub packages from this fork |

## Current release

- Version: **2.22.5-gog.5**
- Releases: https://github.com/dark1ltg/HeroicGamesLauncher/releases
- Latest AppImage: https://github.com/dark1ltg/HeroicGamesLauncher/releases/latest

## Feature summary (since fork creation)

### GOG library folders & auto-import

- Add library folders; scan for installed GOG games and import in bulk
- Watch mounts: auto-import when a drive connects; re-link moved installs
- Import dialog: found / selected / imported counts; one-at-a-time import; Rescan
- Deep scans (nested install folders); keep selection across scans
- Unplugged drives are not treated as “moved” (no wrong re-link)
- Prefer installed Proton (CachyOS / GE / etc.) over system Wine for new imports
- Fresh imports no longer all show “New Version Available” when the build checksum was missing

### Download queue & GOG updates

- Start GOG **game** updates ahead of redistributables
- Keep a running game visible while redistributables are queued
- Stop re-downloading GOG redistributables on every update when they are already present
- Live progress: bytes written to disk; disk reads when percent stalls
- Report a problem can open **update** and **install** logs (not only launch.log)

### gogdl

- Linux x64 uses a **vendored gogdl 1.3.2** zipapp (`vendor/gogdl/`) with the cache-delete ordering fix for [heroic-gogdl#100](https://github.com/Heroic-Games-Launcher/heroic-gogdl/issues/100)
- Installed by `pnpm download-helper-binaries` via `meta/downloadHelperBinaries.ts`

### CI / packaging

- Workflows build and publish the **x86_64 AppImage only** to this fork’s GitHub Releases
- Upstream-only workflows (Flatpak, Windows, macOS, AUR, Flathub, bug-template updater) removed or disabled so fork CI stays green

## Versioning

Fork AppImage tags use the scheme `2.22.5-gog.N` / `v2.22.5-gog.N` (N = 1, 2, …). See [CHANGELOG.md](CHANGELOG.md).

## Development (this fork)

```bash
git clone https://github.com/dark1ltg/HeroicGamesLauncher.git --recurse-submodules
cd HeroicGamesLauncher
pnpm install
pnpm download-helper-binaries   # installs vendored linux x64 gogdl among other helpers
pnpm start
```

Build the AppImage:

```bash
pnpm dist:linux AppImage --x64 --publish=never
```

Release tags that match `v*` run `.github/workflows/draft-release-linux.yml` and publish to GitHub Releases.

## Upstream

Base was upstream Heroic around `509a34fe` (2026-10-25). Prefer merging or cherry-picking carefully from upstream; do not re-enable multi-platform release packaging unless the fork goals change.
