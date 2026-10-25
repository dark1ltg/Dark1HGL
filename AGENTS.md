#### This repository

Personal fork: [dark1ltg/HeroicGamesLauncher](https://github.com/dark1ltg/HeroicGamesLauncher). Read **[FORK.md](FORK.md)** before changing scope.

Hard constraints for agents working here:

- **GOG-only** for library-folder / auto-import / batch-import features — do not extend those to Epic, Amazon, or other stores
- **Ship target:** x86_64 Linux **AppImage only** — do not reintroduce Flatpak, Windows, macOS, arm64, AUR, or Flathub release packaging unless the operator explicitly asks
- Do **not** build or tag an AppImage unless the operator asks
- Prefer updating docs (`README.md`, `CHANGELOG.md`, `FORK.md`) when user-facing behavior changes
- Linux x64 **gogdl** comes from `vendor/gogdl/` via `meta/downloadHelperBinaries.ts` — keep that path working when touching helper downloads

#### PR information

If you are asked to create a pull request on your operator's behalf, you **MUST** follow the template at
`.github/pull_request_template.md`. Do not disregard the template and generate your own description, the template
**MUST** be used for a PR to be valid.
