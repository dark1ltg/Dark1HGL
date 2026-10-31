# Vendored gogdl (linux x86_64)

Used by **Dark1HGL**. Zipapp **gogdl 1.3.2** with the V2 cache-delete ordering fix for [heroic-gogdl#100](https://github.com/Heroic-Games-Launcher/heroic-gogdl/issues/100).

## Why

Upstream `Heroic-Games-Launcher/heroic-gogdl` **v1.3.0** can hang GOG V2 updates when a shared cache chunk is deleted before the writer reads it. This build defers those deletes and flushes Writer exception prints to `update.log`.

`meta/downloadHelperBinaries.ts` copies `gogdl_linux_x86_64` → `public/bin/x64/linux/gogdl` for linux x64.

## Rebuild

Build a linux x86_64 zipapp from a gogdl tree with the cache-delete deferral (managers `FileDiff` / `FilePatchDiff`) and Writer `flush=True`, version `1.3.2`, then:

```bash
cp gogdl_linux_x86_64 /path/to/Dark1HGL/vendor/gogdl/
pnpm download-helper-binaries
public/bin/x64/linux/gogdl --version   # expect 1.3.2
```
