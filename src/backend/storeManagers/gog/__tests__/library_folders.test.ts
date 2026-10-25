import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

const mockSettings: Record<string, unknown> = {}

jest.mock('backend/storeManagers', () => ({
  libraryManagerMap: {
    gog: {
      getInstalledGames: () => [],
      relinkInstalledGame: jest.fn()
    }
  }
}))
jest.mock('backend/config', () => ({
  GlobalConfig: {
    get: () => ({
      getSettings: () => mockSettings,
      setSetting: (key: string, value: unknown) => {
        mockSettings[key] = value
      }
    })
  }
}))
jest.mock('backend/constants/environment', () => ({
  isMac: false,
  isWindows: false
}))
jest.mock('backend/ipc', () => ({ sendFrontendMessage: jest.fn() }))
jest.mock('backend/logger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
  LogPrefix: { Gog: 'GOG' }
}))
jest.mock('../auto_import', () => ({
  chooseAutoImports: jest.fn(),
  importGogGames: jest.fn(),
  scanForGogGames: jest.fn()
}))

import {
  addLibraryFolder,
  findMarkedFolders,
  LIBRARY_MARKER_FILE,
  listLibraryFolders,
  removeLibraryFolder,
  syncMarkedFolder
} from '../library_folders'

describe('GOG library folders', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'heroic-gog-folders-'))
    delete mockSettings.gogAutoImportFolders
    delete mockSettings.gogAutoImportIgnoredIds
    delete mockSettings.gogAutoImportIgnoredPaths
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('marks added folders and unmarks removed ones', async () => {
    const folder = join(root, 'GOG Games')
    mkdirSync(folder)

    expect(await addLibraryFolder(folder)).toEqual([
      { path: folder, available: true }
    ])
    expect(existsSync(join(folder, LIBRARY_MARKER_FILE))).toBe(true)

    expect(await removeLibraryFolder(folder)).toEqual([])
    expect(existsSync(join(folder, LIBRARY_MARKER_FILE))).toBe(false)
  })

  it('does not bring back a folder removed while its drive was unplugged', async () => {
    const folder = join(root, 'GOG Games')
    mkdirSync(folder)
    await addLibraryFolder(folder)
    const { id } = JSON.parse(
      readFileSync(join(folder, LIBRARY_MARKER_FILE), 'utf-8')
    )
    rmSync(folder, { recursive: true, force: true })

    expect(await removeLibraryFolder(folder)).toEqual([])

    mkdirSync(folder)
    writeFileSync(join(folder, LIBRARY_MARKER_FILE), JSON.stringify({ id }))
    expect(await syncMarkedFolder(folder)).toBe('ignored')
    expect(listLibraryFolders()).toEqual([])
  })

  it('follows a library folder that comes back at a new path', async () => {
    const folder = join(root, 'DriveE', 'GOG Games')
    const moved = join(root, 'DriveF', 'GOG Games')
    mkdirSync(folder, { recursive: true })
    await addLibraryFolder(folder)
    const { id } = JSON.parse(
      readFileSync(join(folder, LIBRARY_MARKER_FILE), 'utf-8')
    )
    rmSync(dirname(folder), { recursive: true, force: true })

    mkdirSync(moved, { recursive: true })
    writeFileSync(join(moved, LIBRARY_MARKER_FILE), JSON.stringify({ id }))
    expect(await syncMarkedFolder(moved)).toBe('relocated')
    expect(listLibraryFolders()).toEqual([{ path: moved, available: true }])
  })

  it('reports folders on disconnected drives as unavailable', () => {
    mockSettings.gogAutoImportFolders = [join(root, 'unplugged')]
    expect(listLibraryFolders()).toEqual([
      { path: join(root, 'unplugged'), available: false }
    ])
  })

  it('finds marked library folders near the root of a drive', async () => {
    const drive = join(root, 'drive')
    const shallow = join(drive, 'Games')
    const tooDeep = join(drive, 'a', 'b', 'c')
    mkdirSync(shallow, { recursive: true })
    mkdirSync(tooDeep, { recursive: true })
    writeFileSync(join(shallow, LIBRARY_MARKER_FILE), '{}')
    writeFileSync(join(tooDeep, LIBRARY_MARKER_FILE), '{}')

    expect(await findMarkedFolders(drive)).toEqual([shallow])
  })
})
