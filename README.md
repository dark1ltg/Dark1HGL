# Dark1HGL

[![GitHub release](https://img.shields.io/github/v/release/dark1ltg/Dark1HGL?style=for-the-badge)](https://github.com/dark1ltg/Dark1HGL/releases/latest)
[![GPLv3 license](https://img.shields.io/github/license/dark1ltg/Dark1HGL?style=for-the-badge&color=blue)](https://github.com/dark1ltg/Dark1HGL/blob/main/COPYING)

**Dark1HGL** is a personal, GOG-focused game launcher maintained by [dark1ltg](https://github.com/dark1ltg).

It started as a clean clone of [Heroic Games Launcher](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher) and diverged for one job: **Steam-style GOG library folders** on Linux, shipped as a single **x86_64 AppImage**.

This is **not** the official Heroic project and is **not** supported on Heroic’s Discord, Patreon, or Flathub.

- Project notes: **[FORK.md](FORK.md)**
- Changelog: **[CHANGELOG.md](CHANGELOG.md)**
- Releases: https://github.com/dark1ltg/Dark1HGL/releases

## What Dark1HGL adds

| Area                | Behavior                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| GOG library folders | Point at folders or plug in a drive; installed GOG games are found and imported                                              |
| Auto-import         | GOG **only** — not Epic, not Amazon                                                                                          |
| Import UI           | Found / selected / imported counts; sequential import; **Rescan**                                                            |
| Defaults            | Prefer installed Proton (CachyOS → GE → other) over system Wine on import                                                    |
| Update badge        | Fresh imports no longer all show “New Version Available” when the build checksum was missing                                 |
| Redistributables    | Sync only when needed (not on every update)                                                                                  |
| Download queue      | Game updates can run ahead of redistributables; running games stay visible                                                   |
| Progress UI         | Bytes written; disk reads when percent stalls; update/install logs in Report a problem                                       |
| gogdl (linux x64)   | Vendored **1.3.2** with cache-delete ordering fix ([#100](https://github.com/Heroic-Games-Launcher/heroic-gogdl/issues/100)) |
| Releases            | **x86_64 Linux AppImage only** — no Flatpak, Windows, macOS, or arm64 packages                                               |

Epic/Amazon/Wine code still exists in the tree (inherited from Heroic). **This project’s supported product is the Linux AppImage + GOG library-folder workflow.**

## Install

1. Download `Heroic-*-linux-x86_64.AppImage` from the [latest release](https://github.com/dark1ltg/Dark1HGL/releases/latest)  
   (artifact name still uses the Heroic product id for updater continuity)
2. `chmod +x Heroic-*-linux-x86_64.AppImage`
3. Run it

**Current latest:** [2.22.5-gog.5](https://github.com/dark1ltg/Dark1HGL/releases/tag/v2.22.5-gog.5) — includes library folders through gog.4 plus queue/progress/redistributable work and vendored gogdl 1.3.2.

## Development

```bash
git clone https://github.com/dark1ltg/Dark1HGL.git --recurse-submodules
cd Dark1HGL
pnpm install
pnpm download-helper-binaries   # linux x64 gogdl comes from vendor/gogdl/
pnpm start
```

Build the AppImage this project ships:

```bash
pnpm dist:linux AppImage --x64 --publish=never
```

See [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## License & upstream

GPL-3.0-only ([COPYING](COPYING)), same as Heroic. Dark1HGL would not exist without Heroic and the tools it wraps (Legendary, gogdl, Nile, Comet, Proton/Wine, …) — see [upstream credits](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher#credits).
