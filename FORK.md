# Dark1HGL — project notes

**Repository:** [dark1ltg/Dark1HGL](https://github.com/dark1ltg/Dark1HGL)  
**Based on:** [Heroic Games Launcher](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher) (clean clone, then customized)

Not an official Heroic release channel. Upstream Discord / Patreon / Flathub do not support this build.

## Goals

| Goal                 | Detail                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| GOG library folders  | Steam-style: point at a drive or plug one in; installed GOG games are scanned and imported      |
| GOG-only auto-import | Batch / automatic import is **GOG only** — do not extend to Epic, Amazon, or other stores       |
| One Linux binary     | Ship a single **x86_64 AppImage** — no Flatpak, Windows, macOS, arm64, AUR, or Flathub packages |

## Current release

- Version: **2.22.5-gog.5**
- Releases: https://github.com/dark1ltg/Dark1HGL/releases/latest

## Features vs upstream Heroic

### GOG library folders & auto-import

- Library folders + marker; scan installed GOG games
- Drive watcher: auto-import on connect; re-link moved installs
- Sequential batch import with found / selected / success counts; **Rescan**
- Deep scans; keep selection across scans
- Unplugged drives are not treated as “moved”
- Prefer Proton-CachyOS → Proton-GE → other Proton over system Wine for new imports
- False “New Version Available” badge fixed when import omitted build checksum

### Download queue & GOG updates

- Game updates ahead of redistributables; running games stay visible in the queue
- Redistributable sync only when needed
- Live write progress; disk reads when percent stalls
- Report a problem: update.log / install.log (not only launch.log)

### gogdl

- Linux x64 uses vendored **gogdl 1.3.2** (`vendor/gogdl/`) with cache-delete deferral for [heroic-gogdl#100](https://github.com/Heroic-Games-Launcher/heroic-gogdl/issues/100)
- Wired through `meta/downloadHelperBinaries.ts`

### CI / packaging

- Publish **x86_64 AppImage only** to this repo’s GitHub Releases

## Versioning

Tags: `v2.22.5-gog.N`. See [CHANGELOG.md](CHANGELOG.md).

## Development

```bash
git clone https://github.com/dark1ltg/Dark1HGL.git --recurse-submodules
cd Dark1HGL
pnpm install && pnpm download-helper-binaries
pnpm start
# AppImage:
pnpm dist:linux AppImage --x64 --publish=never
```

Tags matching `v*` run `.github/workflows/draft-release-linux.yml`.
