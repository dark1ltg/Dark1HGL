import { Dirent, existsSync } from 'graceful-fs'
import { readdir, readFile } from 'fs/promises'
import { basename, dirname, join, parse, sep } from 'path'
import { t } from 'i18next'

import { libraryManagerMap } from 'backend/storeManagers'
import { GlobalConfig } from 'backend/config'
import { GameConfig } from 'backend/game_config'
import { isLinux, isMac, isWindows } from 'backend/constants/environment'
import { gamesConfigPath } from 'backend/constants/paths'
import { notify } from 'backend/dialog/dialog'
import { logError, logInfo, LogPrefix } from 'backend/logger'
import {
  removeSpecialcharacters,
  sendGameStatusUpdate,
  writeConfig
} from 'backend/utils'
import type {
  GOGBatchImportResult,
  GOGGameDotInfoFile,
  GOGScanResult,
  GogInstallPlatform
} from 'common/types/gog'

// Safety stop for a pathological tree. Real game folders are far shallower.
const MAX_SCAN_DEPTH = 32

const SKIPPED_DIRECTORIES = new Set([
  '$recycle.bin',
  'system volume information',
  'windows',
  'node_modules',
  'proc',
  'sys',
  'dev'
])

const INFO_FILE_REGEX = /^goggame-(\d+)\.info$/

interface DetectedGame {
  appName: string
  title: string
  path: string
  platform: GogInstallPlatform
}

async function readRootInfoFile(
  dir: string,
  fileNames: string[]
): Promise<{ appName: string; title: string } | undefined> {
  const infoFiles = fileNames.filter((name) => INFO_FILE_REGEX.test(name))
  if (!infoFiles.length) return

  const infos: GOGGameDotInfoFile[] = []
  for (const file of infoFiles) {
    try {
      infos.push(
        JSON.parse(
          await readFile(join(dir, file), 'utf-8')
        ) as GOGGameDotInfoFile
      )
    } catch (error) {
      logError(
        [`Auto-import: could not read ${join(dir, file)}`, error],
        LogPrefix.Gog
      )
    }
  }
  if (!infos.length) return

  // DLCs ship their own info file next to the base game's one
  const root = infos.find((info) => info.gameId === info.rootGameId) ?? infos[0]
  const appName = root.rootGameId || root.gameId
  if (!appName) return

  return { appName: String(appName), title: root.name }
}

async function readLinuxGameinfo(
  dir: string
): Promise<{ appName: string; title: string } | undefined> {
  try {
    const lines = (await readFile(join(dir, 'gameinfo'), 'utf-8')).split('\n')
    const appName = lines[4]?.trim()
    if (!appName || !/^\d+$/.test(appName)) return
    return { appName, title: lines[0]?.trim() || appName }
  } catch {
    return
  }
}

async function listFileNames(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

/**
 * Mirrors the layouts `gogdl import` understands, so anything detected here
 * can be imported through the regular import flow.
 */
async function detectGame(
  dir: string,
  entries: Dirent[]
): Promise<DetectedGame | undefined> {
  const names = entries.map((entry) => entry.name)

  // Linux native installs: <dir>/gameinfo, <dir>/start.sh, <dir>/game/
  const looksLikeLinuxInstall =
    names.includes('gameinfo') ||
    (names.includes('game') && names.includes('start.sh'))
  if (looksLikeLinuxInstall) {
    const gameDir = join(dir, 'game')
    const linuxGame =
      (await readRootInfoFile(gameDir, await listFileNames(gameDir))) ??
      (await readLinuxGameinfo(dir))
    if (linuxGame) {
      return { ...linuxGame, path: dir, platform: 'linux' }
    }
  }

  const windowsGame = await readRootInfoFile(dir, names)
  if (windowsGame) {
    return { ...windowsGame, path: dir, platform: 'windows' }
  }

  if (dir.endsWith('.app') && names.includes('Contents')) {
    const resources = join(dir, 'Contents', 'Resources')
    const macGame = await readRootInfoFile(
      resources,
      await listFileNames(resources)
    )
    if (macGame) {
      return { ...macGame, path: dir, platform: 'osx' }
    }
  }

  return
}

async function walk(
  dir: string,
  depth: number,
  found: DetectedGame[]
): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  const game = await detectGame(dir, entries)
  if (game) {
    found.push(game)
    return
  }

  if (depth >= MAX_SCAN_DEPTH) return

  for (const entry of entries) {
    // Dirent.isDirectory() is false for symlinks, which avoids loops
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    if (SKIPPED_DIRECTORIES.has(entry.name.toLowerCase())) continue
    await walk(join(dir, entry.name), depth + 1, found)
  }
}

// Children of these directories are drives or mount points. If the nearest
// folder that still exists is one of them, the game's drive is unplugged.
function isMountParent(dir: string) {
  if (
    dir === '/' ||
    dir === '/mnt' ||
    dir === '/media' ||
    dir === '/run/media' ||
    dir === '/Volumes'
  ) {
    return true
  }
  return /^\/media\/[^/]+$/.test(dir) || /^\/run\/media\/[^/]+$/.test(dir)
}

function volumeIsPresent(target: string) {
  if (isWindows) {
    const root = parse(target).root
    return !!root && existsSync(root)
  }
  let current = target
  for (;;) {
    const parent = dirname(current)
    if (parent === current) return false
    if (existsSync(parent)) return !isMountParent(parent)
    current = parent
  }
}

function isInside(root: string, target: string) {
  if (target === root) return true
  const prefix = root.endsWith(sep) ? root : root + sep
  return target.startsWith(prefix)
}

// Library folders that are saved but not currently mounted. A game whose
// install path is on one of these is unplugged, not moved.
function offlineLibraryRoots(): string[] {
  const folders = GlobalConfig.get().getSettings().gogAutoImportFolders ?? []
  return folders
    .map((folder) => (typeof folder === 'string' ? folder : folder.path))
    .filter((folder) => folder && !existsSync(folder))
}

// The saved install path is gone, and it is not on a drive that is simply
// unplugged. Another copy found while the real drive is offline is left alone.
function needsRelink(installPath: string | undefined, foundPath: string) {
  if (!installPath || installPath === foundPath || existsSync(installPath)) {
    return false
  }
  // The drive that held this game is gone. Another copy must not take its place.
  if (!volumeIsPresent(installPath)) return false
  return !offlineLibraryRoots().some((root) => isInside(root, installPath))
}

function isPlatformSupported(platform: GogInstallPlatform) {
  if (platform === 'osx') return isMac
  if (platform === 'linux') return isLinux
  return true
}

export const isActionable = (game: GOGScanResult) =>
  game.status === 'importable' || game.status === 'moved'

// One copy per game. Two copies means the user has to pick; guessing would
// point the game at the wrong folder.
export function chooseAutoImports(games: GOGScanResult[]): GOGScanResult[] {
  const byApp = new Map<string, GOGScanResult[]>()
  for (const game of games.filter(isActionable)) {
    const copies = byApp.get(game.appName) ?? []
    copies.push(game)
    byApp.set(game.appName, copies)
  }

  const chosen: GOGScanResult[] = []
  for (const [appName, copies] of byApp) {
    if (copies.length === 1) {
      chosen.push(copies[0])
    } else {
      logInfo(
        `Auto-import: ${appName} was found in ${copies.length} folders, leaving it for you to choose`,
        LogPrefix.Gog
      )
    }
  }
  return chosen
}

export async function scanForGogGames(
  folders: string[]
): Promise<GOGScanResult[]> {
  const detected: DetectedGame[] = []
  for (const folder of folders) {
    if (!folder || !existsSync(folder)) continue
    logInfo(`Auto-import: scanning ${folder}`, LogPrefix.Gog)
    await walk(folder, 0, detected)
  }

  const seenPaths = new Set<string>()
  const results: GOGScanResult[] = []
  for (const game of detected) {
    if (seenPaths.has(game.path)) continue
    seenPaths.add(game.path)

    const gameInfo = libraryManagerMap.gog.getGameInfo(game.appName)
    let status: GOGScanResult['status'] = 'importable'
    if (!gameInfo) status = 'notOwned'
    else if (!isPlatformSupported(game.platform)) status = 'unsupportedPlatform'
    else if (gameInfo.is_installed) {
      status = needsRelink(gameInfo.install?.install_path, game.path)
        ? 'moved'
        : 'installed'
    }

    results.push({
      ...game,
      title: gameInfo?.title || game.title || basename(game.path),
      status
    })
  }

  logInfo(
    `Auto-import: found ${results.length} GOG game(s), ${
      results.filter(isActionable).length
    } to import or re-link`,
    LogPrefix.Gog
  )
  return results.sort((a, b) => a.title.localeCompare(b.title))
}

async function setDefaultWineSettings(appName: string, title: string) {
  if (isWindows) return
  // Respect any settings the user already made for this game
  if (existsSync(join(gamesConfigPath, `${appName}.json`))) return

  const { defaultWinePrefixDir, wineVersion, wineCrossoverBottle } =
    GlobalConfig.get().getSettings()
  const gameSettings = await GameConfig.get(appName).getSettings()
  await writeConfig(appName, {
    ...gameSettings,
    winePrefix: join(defaultWinePrefixDir, removeSpecialcharacters(title)),
    wineVersion,
    wineCrossoverBottle
  })
}

let importQueue: Promise<void> = Promise.resolve()

async function runImport(
  games: Array<{ appName: string; path: string }>
): Promise<GOGBatchImportResult> {
  const result: GOGBatchImportResult = { imported: [], failed: [] }
  const handled = new Set<string>()

  for (const { appName, path } of games) {
    if (handled.has(appName)) {
      logInfo(
        `Auto-import: skipping extra copy of ${appName} at ${path}`,
        LogPrefix.Gog
      )
      continue
    }
    handled.add(appName)

    const gameInfo = libraryManagerMap.gog.getGameInfo(appName)
    if (!gameInfo) continue
    const isRelink = !!gameInfo.is_installed
    if (isRelink && !needsRelink(gameInfo.install.install_path, path)) {
      continue
    }

    sendGameStatusUpdate({ appName, runner: 'gog', status: 'importing' })
    try {
      if (isRelink) {
        const relinked = libraryManagerMap.gog.relinkInstalledGame(
          appName,
          path
        )
        if (relinked) result.imported.push(path)
        else result.failed.push(path)
      } else {
        const { abort, error } = await libraryManagerMap.gog
          .getGame(appName)
          .importGame(path)
        if (abort || error) {
          result.failed.push(path)
        } else {
          const platform =
            libraryManagerMap.gog.getGameInfo(appName)?.install.platform
          if (platform === 'windows') {
            await setDefaultWineSettings(appName, gameInfo.title)
          }
          result.imported.push(path)
        }
      }
    } catch (error) {
      logError(
        [`Auto-import: failed to import ${appName}`, error],
        LogPrefix.Gog
      )
      result.failed.push(path)
    }
    sendGameStatusUpdate({ appName, runner: 'gog', status: 'done' })
  }

  logInfo(
    `Auto-import: imported ${result.imported.length}, failed ${result.failed.length}`,
    LogPrefix.Gog
  )
  if (result.imported.length || result.failed.length) {
    notify({
      title: t('notify.gogAutoImport.title', 'GOG auto-import'),
      body: result.failed.length
        ? t(
            'notify.gogAutoImport.summaryWithFailures',
            '{{imported}} game(s) imported, {{failed}} failed',
            {
              imported: result.imported.length,
              failed: result.failed.length
            }
          )
        : t('notify.gogAutoImport.summary', '{{imported}} game(s) imported', {
            imported: result.imported.length
          })
    })
  }
  return result
}

// Manual imports wait for a scan that's already running instead of being
// dropped, and the caller gets the result of its own request.
export function importGogGames(
  games: Array<{ appName: string; path: string }>
): Promise<GOGBatchImportResult> {
  const job = importQueue.then(() => runImport(games))
  importQueue = job.then(
    () => undefined,
    () => undefined
  )
  return job
}
