# Vendored gogdl (linux x86_64)

Zipapp **gogdl 1.3.2** with the V2 cache-delete ordering fix for [heroic-gogdl#100](https://github.com/Heroic-Games-Launcher/heroic-gogdl/issues/100).

## Why

Upstream `Heroic-Games-Launcher/heroic-gogdl` **v1.3.0** can hang GOG V2 updates when a shared cache chunk is deleted before the writer reads it. This build:

1. Defers those `DELETE_FILE` tasks until after the file’s chunk tasks
2. Flushes Writer exception prints so they appear in Heroic’s `update.log`

`meta/downloadHelperBinaries.ts` copies `gogdl_linux_x86_64` into `public/bin/x64/linux/gogdl` for linux x64 (other platforms still download upstream release assets).

## Rebuild

Build a linux x86_64 zipapp from a gogdl tree that includes the cache-delete deferral (managers `FileDiff` / `FilePatchDiff` task ordering) and Writer `flush=True`, versioned `1.3.2`, then:

```bash
cp gogdl_linux_x86_64 /path/to/HeroicGamesLauncher/vendor/gogdl/
pnpm download-helper-binaries
public/bin/x64/linux/gogdl --version   # expect 1.3.2
```
