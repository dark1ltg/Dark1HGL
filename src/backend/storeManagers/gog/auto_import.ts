import { Dirent, existsSync } from 'graceful-fs'
import { readdir, readFile } from 'fs/promises'
import { basename, join } from 'path'
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

// Deep enough for layouts like <drive>/Games/GOG/<Game>, shallow enough to
// keep scanning a multi-terabyte drive fast.
const MAX_SCAN_DEPTH = 4

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

// The game is known to Heroic but its old location is gone, e.g. the drive
// got a different letter or mount point
function needsRelink(installPath: string | undefined, foundPath: string) {
  return !!installPath && installPath !== foundPath && !existsSync(installPath)
}

function isPlatformSupported(platform: GogInstallPlatform) {
  if (platform === 'osx') return isMac
  if (platform === 'linux') return isLinux
  return true
}

export const isActionable = (game: GOGScanResult) =>
  game.status === 'importable' || game.status === 'moved'

export async function scanForGogGames(
  folders: string[]
): Promise<GOGScanResult[]> {
  const detected: DetectedGame[] = []
  for (const folder of folders) {
    if (!folder || !existsSync(folder)) continue
    logInfo(`Auto-import: scanning ${folder}`, LogPrefix.Gog)
    await walk(folder, 0, detected)
  }

  const seen = new Set<string>()
  const results: GOGScanResult[] = []
  for (const game of detected) {
    if (seen.has(game.appName)) continue
    seen.add(game.appName)

    const gameInfo = libraryManagerMap.gog.getGameInfo(game.appName)
    let status: GOGScanResult['status'] = 'importable'
    if (!gameInfo) status = 'notOwned'
    else if (!isPlatformSupported(game.platform)) status = 'unsupportedPlatform'
    else if (gameInfo.is_installed) {
      status = needsRelink(gameInfo.install.install_path, game.path)
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

let batchInProgress = false

export async function importGogGames(
  games: Array<{ appName: string; path: string }>
): Promise<GOGBatchImportResult> {
  const result: GOGBatchImportResult = { imported: [], failed: [] }
  if (batchInProgress) {
    logInfo('Auto-import: an import is already running', LogPrefix.Gog)
    return result
  }
  batchInProgress = true

  try {
    for (const { appName, path } of games) {
      const game = libraryManagerMap.gog.getGame(appName)
      const gameInfo = libraryManagerMap.gog.getGameInfo(appName)
      if (!gameInfo) continue
      const isRelink = gameInfo.is_installed
      if (isRelink && !needsRelink(gameInfo.install.install_path, path)) {
        continue
      }

      sendGameStatusUpdate({ appName, runner: 'gog', status: 'importing' })
      try {
        const { abort, error } = await game.importGame(path)
        if (abort || error) {
          result.failed.push(appName)
        } else {
          const platform =
            libraryManagerMap.gog.getGameInfo(appName)?.install.platform
          if (platform === 'windows' && !isRelink) {
            await setDefaultWineSettings(appName, gameInfo.title)
          }
          result.imported.push(appName)
        }
      } catch (error) {
        logError(
          [`Auto-import: failed to import ${appName}`, error],
          LogPrefix.Gog
        )
        result.failed.push(appName)
      }
      sendGameStatusUpdate({ appName, runner: 'gog', status: 'done' })
    }
  } finally {
    batchInProgress = false
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
