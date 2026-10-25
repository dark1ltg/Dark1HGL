import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const mockGetGameInfo = jest.fn()
const mockImportGame = jest.fn()

jest.mock('backend/storeManagers', () => ({
  libraryManagerMap: {
    gog: {
      getGameInfo: (appName: string) => mockGetGameInfo(appName),
      getGame: () => ({ importGame: mockImportGame })
    }
  }
}))
jest.mock('backend/config', () => ({
  GlobalConfig: { get: () => ({ getSettings: () => ({}) }) }
}))
jest.mock('backend/game_config', () => ({}))
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
  sendGameStatusUpdate: jest.fn(),
  writeConfig: jest.fn()
}))

import { scanForGogGames } from '../auto_import'

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
    mockGetGameInfo.mockImplementation((appName: string) => {
      if (appName === '3') return undefined
      return {
        title: `Library ${appName}`,
        is_installed: appName === '2'
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

  it('does not scan deeper than the depth limit', async () => {
    writeInfo(join(root, 'a', 'b', 'c', 'd', 'e', 'Deep'), '1', '1')
    expect(await scanForGogGames([root])).toHaveLength(0)
  })

  it('ignores folders that do not exist', async () => {
    expect(await scanForGogGames([join(root, 'missing')])).toEqual([])
  })
})
