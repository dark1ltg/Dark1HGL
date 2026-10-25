# Vendored gogdl (linux x86_64)

Zipapp build of [dark1ltg/heroic-gogdl](https://github.com/dark1ltg/heroic-gogdl) `fix/cache-delete-ordering` at version **1.3.2**.

## Why

Upstream `Heroic-Games-Launcher/heroic-gogdl` v1.3.0 can hang GOG V2 updates when a shared cache chunk is deleted before the writer reads it ([heroic-gogdl#100](https://github.com/Heroic-Games-Launcher/heroic-gogdl/issues/100)). This build defers those deletes until after the file's chunk tasks and flushes Writer exception prints to `update.log`.

`meta/downloadHelperBinaries.ts` installs this binary for linux x64 instead of downloading upstream.

## Rebuild

```bash
# from a checkout of dark1ltg/heroic-gogdl on fix/cache-delete-ordering
python3 -m pip install -e .
python3 scripts/zipapp.py   # or the project's zipapp build steps
cp gogdl_linux_x86_64 /path/to/HeroicGamesLauncher/vendor/gogdl/
```
