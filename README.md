# Heroic Games Launcher (dark1ltg fork)

[![GitHub release](https://img.shields.io/github/v/release/dark1ltg/HeroicGamesLauncher?style=for-the-badge)](https://github.com/dark1ltg/HeroicGamesLauncher/releases/latest)
[![GPLv3 license](https://img.shields.io/github/license/dark1ltg/HeroicGamesLauncher?style=for-the-badge&color=blue)](https://github.com/dark1ltg/HeroicGamesLauncher/blob/main/COPYING)

**Personal fork** of [Heroic Games Launcher](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher) focused on **GOG library folders**, smoother GOG updates, and a single **Linux x86_64 AppImage**.

This is **not** the official Heroic project. For upstream docs, Discord, Flatpak, Windows/macOS builds, and sponsorship, use the [upstream repository](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher).

Full fork history and design constraints: **[FORK.md](FORK.md)** · Release notes: **[CHANGELOG.md](CHANGELOG.md)**

## What this fork is for

- **Steam-style GOG library folders** — add folders / plug in a drive; installed GOG games are found and imported
- **GOG-only auto-import** — do not expect Epic/Amazon batch import here
- **One shipping binary** — x86_64 Linux AppImage only (no Flatpak / Windows / macOS packages from this fork)
- **GOG update UX** — clearer queue ordering, live write/read progress, update & install logs in Report a problem
- **Patched gogdl (linux x64)** — vendored 1.3.2 build that avoids the [cache-delete hang](https://github.com/Heroic-Games-Launcher/heroic-gogdl/issues/100)

Epic, Amazon, Wine/Proton, and the rest of Heroic still exist in the codebase (inherited from upstream), but **releases and documented support for this fork are the Linux AppImage + GOG workflow above**.

## Install (Linux x86_64)

1. Download `Heroic-*-linux-x86_64.AppImage` from the [latest release](https://github.com/dark1ltg/HeroicGamesLauncher/releases/latest)
2. `chmod +x Heroic-*-linux-x86_64.AppImage`
3. Run it (double-click or `./Heroic-*-linux-x86_64.AppImage`)

Current latest: **[2.22.5-gog.5](https://github.com/dark1ltg/HeroicGamesLauncher/releases/tag/v2.22.5-gog.5)**

## Notable fork features

### GOG library folders

- Settings / library folders for GOG installs (local disks and removable drives)
- Auto-scan on connect; re-link when a game folder moves
- Import UI: counts for found / selected / imported; Rescan; deep nested scans
- Sensible defaults: prefer an installed Proton build over system Wine when importing

### GOG downloads & updates

- Game updates can run ahead of redistributable jobs; running games stay visible in the queue
- Avoid re-fetching redistributables that are already installed
- Progress shows bytes written; when percent stalls, disk reads are shown
- Report a problem can attach update.log / install.log, not only launch.log

### Helper binaries

`pnpm download-helper-binaries` still fetches Legendary, Nile, Comet, etc. For **linux x64 gogdl**, it copies the patched zipapp from [`vendor/gogdl/`](vendor/gogdl/README.md) instead of upstream v1.3.0.

## Development

```bash
git clone https://github.com/dark1ltg/HeroicGamesLauncher.git --recurse-submodules
cd HeroicGamesLauncher
pnpm install
pnpm download-helper-binaries
pnpm start
```

Build the AppImage this fork ships:

```bash
pnpm dist:linux AppImage --x64 --publish=never
```

Useful checks: `pnpm codecheck`, `pnpm lint`, `pnpm test`.

Agent / PR conventions for this repo: [AGENTS.md](AGENTS.md). Broader upstream contributing notes: [CONTRIBUTING.md](CONTRIBUTING.md).

## Releases & changelog

- GitHub Releases: https://github.com/dark1ltg/HeroicGamesLauncher/releases
- Version tags: `v2.22.5-gog.N` (see [CHANGELOG.md](CHANGELOG.md) and [FORK.md](FORK.md))

## Upstream & credits

Based on Heroic Games Launcher (GPL-3.0). Heroic would not exist without Legendary, gogdl, Nile, Comet, Proton/Wine tooling, and many other projects — see the [upstream README credits](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher#credits).

## License

[GPL-3.0-only](COPYING) — same as upstream Heroic.
