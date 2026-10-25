import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const mockGetGameInfo = jest.fn()
const mockRecordScannedGame = jest.fn()
const mockRelink = jest.fn()
const mockBackfill = jest.fn()
const mockSettings: Record<string, unknown> = {}

jest.mock('backend/storeManagers', () => ({
  libraryManagerMap: {
    gog: {
      getGameInfo: (appName: string) => mockGetGameInfo(appName),
      recordScannedGame: (...args: unknown[]) => mockRecordScannedGame(...args),
      relinkInstalledGame: (...args: unknown[]) => mockRelink(...args),
      backfillImportedGames: (...args: unknown[]) => mockBackfill(...args)
    }
  }
}))
jest.mock('backend/ipc', () => ({ sendFrontendMessage: jest.fn() }))
jest.mock('backend/config', () => ({
  GlobalConfig: { get: () => ({ getSettings: () => mockSettings }) }
}))
jest.mock('backend/game_config', () => ({
  GameConfig: {
    get: () => ({
      getSettings: jest.fn().mockResolvedValue({}),
      setSetting: jest.fn()
    })
  }
}))
jest.mock('backend/constants/environment', () => ({
  isLinux: true,
  isMac: false,
  isWindows: false
}))
jest.mock('backend/constants/paths', () => ({
  gamesConfigPath: '/nonexistent'
}))
jest.mock('backend/dialog/dialog', () => ({ notify: jest.fn() }))
jest.mock('backend/logger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
  LogPrefix: { Gog: 'GOG' }
}))
jest.mock('backend/utils', () => ({
  removeSpecialcharacters: (s: string) => s,
  writeConfig: jest.fn()
}))

import {
  chooseAutoImports,
  importGogGames,
  scanForGogGames
} from '../auto_import'

function writeInfo(dir: string, gameId: string, rootGameId: string) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `goggame-${gameId}.info`),
    JSON.stringify({ gameId, rootGameId, name: `Game ${gameId}` })
  )
}

describe('scanForGogGames', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'heroic-gog-scan-'))
    delete mockSettings.gogAutoImportFolders
    mockRecordScannedGame.mockReset()
    mockRecordScannedGame.mockResolvedValue(true)
    mockBackfill.mockReset()
    mockBackfill.mockResolvedValue(undefined)
    mockRelink.mockReset()
    mockRelink.mockReturnValue(true)
    mockGetGameInfo.mockImplementation((appName: string) => {
      if (appName === '3') return undefined
      return {
        title: `Library ${appName}`,
        is_installed: appName === '2',
        install: { install_path: join(root, 'Two') }
      }
    })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('finds Windows and Linux installs and reports their status', async () => {
    // Windows game with a DLC info file next to it
    writeInfo(join(root, 'Drive', 'GOG Games', 'One'), '1', '1')
    writeInfo(join(root, 'Drive', 'GOG Games', 'One'), '100', '1')
    // Already imported
    writeInfo(join(root, 'Two'), '2', '2')
    // Not in the account
    writeInfo(join(root, 'Three'), '3', '3')
    // Linux native install
    const linuxDir = join(root, 'Linux Game')
    writeInfo(join(linuxDir, 'game'), '4', '4')
    writeFileSync(join(linuxDir, 'gameinfo'), 'Game 4\n1.0\n\nen-US\n4\n')

    const results = await scanForGogGames([root])
    const byId = Object.fromEntries(results.map((r) => [r.appName, r]))

    expect(results).toHaveLength(4)
    expect(byId['1']).toMatchObject({
      platform: 'windows',
      status: 'importable',
      title: 'Library 1',
      path: join(root, 'Drive', 'GOG Games', 'One')
    })
    expect(byId['2'].status).toBe('installed')
    expect(byId['3'].status).toBe('notOwned')
    expect(byId['4']).toMatchObject({ platform: 'linux', path: linuxDir })
  })

  it('flags installed games whose old location is gone as moved', async () => {
    writeInfo(join(root, 'NewDrive', 'Five'), '5', '5')
    writeInfo(join(root, 'Six'), '6', '6')
    mockGetGameInfo.mockImplementation((appName: string) => ({
      title: `Library ${appName}`,
      is_installed: true,
      install: {
        install_path:
          appName === '5' ? join(root, 'OldDrive', 'Five') : join(root, 'Six')
      }
    }))

    const results = await scanForGogGames([root])
    const byId = Object.fromEntries(results.map((r) => [r.appName, r]))

    expect(byId['5'].status).toBe('moved')
    expect(byId['6'].status).toBe('installed')
  })

  it('does not treat another copy as a move while the real drive is offline', async () => {
    const oldDrive = join(root, 'OldDrive')
    mockSettings.gogAutoImportFolders = [oldDrive]
    writeInfo(join(root, 'OtherDrive', 'Five'), '5', '5')
    mockGetGameInfo.mockImplementation(() => ({
      title: 'Library 5',
      is_installed: true,
      install: { install_path: join(oldDrive, 'Five') }
    }))

    const [found] = await scanForGogGames([root])
    expect(found.status).toBe('installed')
  })

  it('keeps every copy when a game is in more than one folder', async () => {
    writeInfo(join(root, 'A', 'Five'), '5', '5')
    writeInfo(join(root, 'B', 'Five'), '5', '5')
    mockGetGameInfo.mockImplementation(() => ({
      title: 'Library 5',
      is_installed: true,
      install: {
        install_path: join(root, 'Missing', 'Five'),
        pinnedVersion: true
      }
    }))

    const copies = (await scanForGogGames([root])).filter(
      (game) => game.appName === '5'
    )
    expect(copies).toHaveLength(2)
    expect(copies.every((game) => game.status === 'moved')).toBe(true)
    expect(chooseAutoImports(copies)).toEqual([])
  })

  it('relinks a moved game without importing it again', async () => {
    const newPath = join(root, 'NewDrive', 'Five')
    mockGetGameInfo.mockImplementation(() => ({
      title: 'Library 5',
      is_installed: true,
      install: {
        install_path: join(root, 'Missing', 'Five'),
        pinnedVersion: true
      }
    }))

    const result = await importGogGames([{ appName: '5', path: newPath }])
    expect(result.imported).toEqual([newPath])
    expect(mockRelink).toHaveBeenCalledWith('5', newPath)
    expect(mockRecordScannedGame).not.toHaveBeenCalled()
    expect(mockBackfill).not.toHaveBeenCalled()
  })

  it('records a scanned game without reading the install folder again', async () => {
    mockGetGameInfo.mockImplementation(() => ({
      title: 'Library 1',
      is_installed: false,
      install: {}
    }))

    const gamePath = join(root, 'One')
    const result = await importGogGames([
      { appName: '1', path: gamePath, platform: 'linux' }
    ])
    expect(result.imported).toEqual([gamePath])
    expect(mockRecordScannedGame).toHaveBeenCalledWith('1', gamePath, 'linux')
    expect(mockBackfill).toHaveBeenCalledWith(['1'])
  })

  it('treats a folder with no platform hint as a Windows install', async () => {
    mockGetGameInfo.mockImplementation(() => ({
      title: 'Library 1',
      is_installed: false,
      install: {}
    }))

    mockSettings.defaultWinePrefixDir = join(root, 'prefixes')
    const gamePath = join(root, 'One')
    const result = await importGogGames([{ appName: '1', path: gamePath }])
    expect(result.imported).toEqual([gamePath])
    expect(mockRecordScannedGame).toHaveBeenCalledWith('1', gamePath, 'windows')
  })

  it('finds a game nested many folders down', async () => {
    writeInfo(join(root, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'Deep'), '1', '1')
    const [found] = await scanForGogGames([root])
    expect(found?.appName).toBe('1')
    expect(found?.status).toBe('importable')
  })

  it('does not retarget a game whose drive is unplugged', async () => {
    writeInfo(join(root, 'OtherCopy'), '7', '7')
    mockGetGameInfo.mockImplementation(() => ({
      title: 'Library 7',
      is_installed: true,
      install: { install_path: '/no-such-heroic-drive/Games/Seven' }
    }))

    const [found] = await scanForGogGames([root])
    expect(found.status).toBe('installed')
  })

  it('does not scan a pathologically deep tree', async () => {
    const parts = Array.from({ length: 40 }, (_, index) => `d${index}`)
    writeInfo(join(root, ...parts), '1', '1')
    expect(await scanForGogGames([root])).toHaveLength(0)
  })

  it('ignores folders that do not exist', async () => {
    expect(await scanForGogGames([join(root, 'missing')])).toEqual([])
  })
})
