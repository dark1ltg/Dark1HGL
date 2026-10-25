import { existsSync } from 'graceful-fs'
import { readdir, rm, writeFile } from 'fs/promises'
import { userInfo } from 'os'
import { join, sep } from 'path'

import { libraryManagerMap } from 'backend/storeManagers'
import { GlobalConfig } from 'backend/config'
import { isMac, isWindows } from 'backend/constants/environment'
import { sendFrontendMessage } from 'backend/ipc'
import { logError, logInfo, LogPrefix } from 'backend/logger'
import { importGogGames, isActionable, scanForGogGames } from './auto_import'
import type { GOGLibraryFolder } from 'common/types/gog'

// Like Steam's libraryfolder.vdf: lets Heroic recognise a library folder on
// a drive that comes back under a different letter or mount point
export const LIBRARY_MARKER_FILE = 'heroic-gog-library.json'
const MARKER_SEARCH_DEPTH = 2
const POLL_INTERVAL_MS = 10_000

const getFolders = () =>
  GlobalConfig.get().getSettings().gogAutoImportFolders ?? []

const isAutoImportEnabled = () =>
  !!GlobalConfig.get().getSettings().gogAutoImportEnabled

function saveFolders(folders: string[]) {
  GlobalConfig.get().setSetting('gogAutoImportFolders', folders)
}

export function listLibraryFolders(): GOGLibraryFolder[] {
  return getFolders().map((path) => ({ path, available: existsSync(path) }))
}

export async function addLibraryFolder(
  path: string
): Promise<GOGLibraryFolder[]> {
  const folders = getFolders()
  if (!folders.includes(path)) saveFolders([...folders, path])
  folderAvailability.set(path, existsSync(path))

  try {
    await writeFile(
      join(path, LIBRARY_MARKER_FILE),
      JSON.stringify({ createdBy: 'Heroic Games Launcher', store: 'gog' })
    )
  } catch (error) {
    // Read-only drives still work, they just won't be found after a remount
    logError(
      [`Library folders: could not write marker in ${path}`, error],
      LogPrefix.Gog
    )
  }
  return listLibraryFolders()
}

export async function removeLibraryFolder(
  path: string
): Promise<GOGLibraryFolder[]> {
  saveFolders(getFolders().filter((folder) => folder !== path))
  folderAvailability.delete(path)
  // Otherwise the folder would be re-added the next time the drive mounts
  await rm(join(path, LIBRARY_MARKER_FILE), { force: true }).catch(() => {})
  return listLibraryFolders()
}

async function listChildDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => join(dir, entry.name))
  } catch {
    return []
  }
}

async function getMountRoots(): Promise<string[]> {
  if (isWindows) {
    return 'CDEFGHIJKLMNOPQRSTUVWXYZ'
      .split('')
      .map((letter) => `${letter}:\\`)
      .filter((root) => existsSync(root))
  }
  if (isMac) return listChildDirs('/Volumes')

  const user = userInfo().username
  const bases = ['/media', `/media/${user}`, `/run/media/${user}`, '/mnt']
  const roots = new Set<string>()
  for (const base of bases) {
    for (const dir of await listChildDirs(base)) {
      if (!bases.includes(dir)) roots.add(dir)
    }
  }
  return [...roots]
}

export async function findMarkedFolders(
  root: string,
  depth = 0
): Promise<string[]> {
  if (existsSync(join(root, LIBRARY_MARKER_FILE))) return [root]
  if (depth >= MARKER_SEARCH_DEPTH) return []

  const found: string[] = []
  for (const child of await listChildDirs(root)) {
    found.push(...(await findMarkedFolders(child, depth + 1)))
  }
  return found
}

const folderAvailability = new Map<string, boolean>()
let knownMounts = new Set<string>()
let queue: Promise<void> = Promise.resolve()

function enqueue(task: () => Promise<void>) {
  queue = queue
    .then(task)
    .catch((error) =>
      logError(
        ['Library folders: background task failed', error],
        LogPrefix.Gog
      )
    )
}

async function scanAndImport(folders: string[]) {
  if (!isAutoImportEnabled() || !folders.length) return
  const found = await scanForGogGames(folders)
  const toImport = found.filter(isActionable)
  if (toImport.length) await importGogGames(toImport)
}

async function adoptMarkedFolders(mounts: string[]): Promise<string[]> {
  const folders = getFolders()
  const adopted: string[] = []
  for (const mount of mounts) {
    for (const folder of await findMarkedFolders(mount)) {
      if (folders.includes(folder) || adopted.includes(folder)) continue
      logInfo(`Library folders: found GOG library at ${folder}`, LogPrefix.Gog)
      adopted.push(folder)
    }
  }
  if (adopted.length) {
    saveFolders([...folders, ...adopted])
    adopted.forEach((folder) => folderAvailability.set(folder, true))
  }
  return adopted
}

// Re-sending installed games makes the frontend re-check their availability,
// which flips them between "installed" and "not available"
function refreshGamesIn(folders: string[]) {
  const installed = libraryManagerMap.gog
    .getInstalledGames()
    .filter(({ install_path }) =>
      folders.some(
        (folder) =>
          install_path === folder ||
          install_path?.startsWith(folder.endsWith(sep) ? folder : folder + sep)
      )
    )
  for (const { appName } of installed) {
    if (!appName) continue
    const gameInfo = libraryManagerMap.gog.getGameInfo(appName)
    if (gameInfo) sendFrontendMessage('pushGameToLibrary', gameInfo)
  }
}

async function checkFolders() {
  const changed: string[] = []
  const cameOnline: string[] = []
  for (const folder of getFolders()) {
    const available = existsSync(folder)
    const previous = folderAvailability.get(folder)
    folderAvailability.set(folder, available)
    if (previous === undefined || previous === available) continue
    changed.push(folder)
    if (available) cameOnline.push(folder)
    logInfo(
      `Library folders: ${folder} is now ${available ? 'connected' : 'disconnected'}`,
      LogPrefix.Gog
    )
  }

  const mounts = await getMountRoots()
  const newMounts = mounts.filter((mount) => !knownMounts.has(mount))
  knownMounts = new Set(mounts)
  if (newMounts.length && isAutoImportEnabled()) {
    cameOnline.push(...(await adoptMarkedFolders(newMounts)))
  }

  if (changed.length) refreshGamesIn(changed)
  if (cameOnline.length) await scanAndImport(cameOnline)
}

let watcherStarted = false

export function startLibraryFolderWatcher() {
  if (watcherStarted) return
  watcherStarted = true

  enqueue(async () => {
    const mounts = await getMountRoots()
    knownMounts = new Set(mounts)
    if (isAutoImportEnabled()) await adoptMarkedFolders(mounts)

    const available = getFolders().filter((folder) => {
      const isAvailable = existsSync(folder)
      folderAvailability.set(folder, isAvailable)
      return isAvailable
    })
    await scanAndImport(available)
  })

  setInterval(() => enqueue(checkFolders), POLL_INTERVAL_MS)
}
