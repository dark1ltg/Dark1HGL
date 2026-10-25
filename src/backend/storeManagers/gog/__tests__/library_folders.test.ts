import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const mockSettings: Record<string, unknown> = {}

jest.mock('backend/storeManagers', () => ({
  libraryManagerMap: { gog: {} }
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
  importGogGames: jest.fn(),
  isActionable: jest.fn(),
  scanForGogGames: jest.fn()
}))

import {
  addLibraryFolder,
  findMarkedFolders,
  LIBRARY_MARKER_FILE,
  listLibraryFolders,
  removeLibraryFolder
} from '../library_folders'

describe('GOG library folders', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'heroic-gog-folders-'))
    delete mockSettings.gogAutoImportFolders
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
