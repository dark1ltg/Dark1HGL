import { randomUUID } from 'crypto'
import { existsSync } from 'graceful-fs'
import { readFile, readdir, rm, writeFile } from 'fs/promises'
import { userInfo } from 'os'
import { join, sep } from 'path'

import { libraryManagerMap } from 'backend/storeManagers'
import { GlobalConfig } from 'backend/config'
import { isMac, isWindows } from 'backend/constants/environment'
import { sendFrontendMessage } from 'backend/ipc'
import { logError, logInfo, LogPrefix } from 'backend/logger'
import {
  chooseAutoImports,
  importGogGames,
  scanForGogGames
} from './auto_import'
import type { GOGLibraryFolder } from 'common/types/gog'

// Like Steam's libraryfolder.vdf: lets Heroic recognise a library folder on
// a drive that comes back under a different letter or mount point
export const LIBRARY_MARKER_FILE = 'heroic-gog-library.json'
const MARKER_SEARCH_DEPTH = 2
const POLL_INTERVAL_MS = 10_000

interface StoredLibraryFolder {
  id: string
  path: string
}

const getSettings = () => GlobalConfig.get().getSettings()

function readFolders(): StoredLibraryFolder[] {
  return (getSettings().gogAutoImportFolders ?? []).map((folder) =>
    typeof folder === 'string' ? { id: '', path: folder } : folder
  )
}

const getFolderPaths = () => readFolders().map((folder) => folder.path)

const isAutoImportEnabled = () => !!getSettings().gogAutoImportEnabled

function saveFolders(folders: StoredLibraryFolder[]) {
  GlobalConfig.get().setSetting('gogAutoImportFolders', folders)
}

function ignoredIds() {
  return getSettings().gogAutoImportIgnoredIds ?? []
}

function ignoreId(id: string) {
  if (!id || ignoredIds().includes(id)) return
  GlobalConfig.get().setSetting('gogAutoImportIgnoredIds', [
    ...ignoredIds(),
    id
  ])
}

function ignoredPaths() {
  return getSettings().gogAutoImportIgnoredPaths ?? []
}

function ignorePath(path: string) {
  if (!path || ignoredPaths().includes(path)) return
  GlobalConfig.get().setSetting('gogAutoImportIgnoredPaths', [
    ...ignoredPaths(),
    path
  ])
}

async function readMarker(
  folder: string
): Promise<{ id?: string } | undefined> {
  try {
    const parsed = JSON.parse(
      await readFile(join(folder, LIBRARY_MARKER_FILE), 'utf-8')
    )
    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

function writeMarker(folder: string, id: string) {
  return writeFile(
    join(folder, LIBRARY_MARKER_FILE),
    JSON.stringify({
      id,
      createdBy: 'Heroic Games Launcher',
      store: 'gog'
    })
  )
}

function rebaseInstallPath(oldRoot: string, newRoot: string, target: string) {
  if (target === oldRoot) return newRoot
  const prefix = oldRoot.endsWith(sep) ? oldRoot : oldRoot + sep
  if (!target.startsWith(prefix)) return
  return join(newRoot, target.slice(prefix.length))
}

// A library folder came back under a new path. Move the games that were
// installed inside it, keeping everything else about them.
function retargetInstalledGames(oldRoot: string, newRoot: string) {
  for (const game of libraryManagerMap.gog.getInstalledGames()) {
    if (!game.appName || !game.install_path) continue
    const newPath = rebaseInstallPath(oldRoot, newRoot, game.install_path)
    if (newPath)
      libraryManagerMap.gog.relinkInstalledGame(game.appName, newPath)
  }
}

export function listLibraryFolders(): GOGLibraryFolder[] {
  return getFolderPaths().map((path) => ({ path, available: existsSync(path) }))
}

export async function addLibraryFolder(
  path: string
): Promise<GOGLibraryFolder[]> {
  const folders = readFolders()
  if (!folders.some((folder) => folder.path === path)) {
    const id = randomUUID()
    folders.push({ id, path })
    saveFolders(folders)
    try {
      await writeMarker(path, id)
    } catch (error) {
      // Read-only drives still work, they just won't be found after a remount
      logError(
        [`Library folders: could not write marker in ${path}`, error],
        LogPrefix.Gog
      )
    }
  }
  folderAvailability.set(path, existsSync(path))
  return listLibraryFolders()
}

export async function removeLibraryFolder(
  path: string
): Promise<GOGLibraryFolder[]> {
  const folders = readFolders()
  const folder = folders.find((entry) => entry.path === path)
  // Remember the removal even when the drive is unplugged and the marker
  // file cannot be deleted yet
  if (folder?.id) ignoreId(folder.id)
  else ignorePath(path)
  saveFolders(folders.filter((entry) => entry.path !== path))
  folderAvailability.delete(path)
  await rm(join(path, LIBRARY_MARKER_FILE), { force: true }).catch(() => {})
  return listLibraryFolders()
}

export async function syncMarkedFolder(
  folder: string
): Promise<'added' | 'ignored' | 'relocated' | 'known'> {
  const marker = await readMarker(folder)
  const id = marker?.id || ''
  if (
    (id && ignoredIds().includes(id)) ||
    (!id && ignoredPaths().includes(folder))
  ) {
    if (id) {
      await rm(join(folder, LIBRARY_MARKER_FILE), { force: true }).catch(
        () => {}
      )
    }
    return 'ignored'
  }

  const folders = readFolders()
  const byId = id ? folders.find((entry) => entry.id === id) : undefined
  if (byId) {
    if (byId.path === folder) return 'known'
    if (!existsSync(byId.path)) {
      const oldPath = byId.path
      saveFolders(
        folders.map((entry) =>
          entry.id === id ? { ...entry, path: folder } : entry
        )
      )
      folderAvailability.delete(oldPath)
      folderAvailability.set(folder, true)
      retargetInstalledGames(oldPath, folder)
      logInfo(`Library folders: ${oldPath} is back at ${folder}`, LogPrefix.Gog)
      return 'relocated'
    }
    return 'known'
  }

  if (folders.some((entry) => entry.path === folder)) return 'known'

  const newId = id || randomUUID()
  if (!id) {
    try {
      await writeMarker(folder, newId)
    } catch (error) {
      logError(
        [`Library folders: could not write marker in ${folder}`, error],
        LogPrefix.Gog
      )
    }
  }
  saveFolders([...folders, { id: newId, path: folder }])
  folderAvailability.set(folder, true)
  logInfo(`Library folders: found GOG library at ${folder}`, LogPrefix.Gog)
  return 'added'
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
  const toImport = chooseAutoImports(found)
  if (toImport.length) await importGogGames(toImport)
}

async function adoptMarkedFolders(mounts: string[]): Promise<string[]> {
  const adopted: string[] = []
  for (const mount of mounts) {
    for (const folder of await findMarkedFolders(mount)) {
      const result = await syncMarkedFolder(folder)
      if (result === 'added' || result === 'relocated') adopted.push(folder)
    }
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
  for (const folder of getFolderPaths()) {
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

    const available = getFolderPaths().filter((folder) => {
      const isAvailable = existsSync(folder)
      folderAvailability.set(folder, isAvailable)
      return isAvailable
    })
    await scanAndImport(available)
  })

  setInterval(() => enqueue(checkFolders), POLL_INTERVAL_MS)
}
