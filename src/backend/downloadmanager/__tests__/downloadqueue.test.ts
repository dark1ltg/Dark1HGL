import { DMQueueElement } from 'common/types'

const mockStoreData: {
  queue?: DMQueueElement[]
  finished?: DMQueueElement[]
} = {}

const mockGetGameInfo = jest.fn()
const mockGetInstallInfo = jest.fn()
const mockUpdateQueueElement = jest.fn()
const mockInstallQueueElement = jest.fn()
const mockAbort = jest.fn()
const mockCreateRedist = jest.fn()
const mockExistsSync = jest.fn(() => true)

jest.mock('backend/electron_store', () => ({
  TypeCheckedStoreBackend: class {
    get(key: 'queue' | 'finished', fallback: DMQueueElement[]) {
      return mockStoreData[key] ?? fallback
    }

    set(key: 'queue' | 'finished', value: DMQueueElement[]) {
      mockStoreData[key] = value
    }

    has(key: 'queue' | 'finished') {
      return mockStoreData[key] !== undefined
    }

    delete(key: 'queue' | 'finished') {
      delete mockStoreData[key]
    }
  }
}))

jest.mock('backend/storeManagers', () => ({
  libraryManagerMap: {
    gog: {
      getGameInfo: (...args: unknown[]) => mockGetGameInfo(...args),
      getInstallInfo: (...args: unknown[]) => mockGetInstallInfo(...args),
      getGame: () => ({
        stop: jest.fn(),
        getGameInfo: () => ({ title: 'Test Game', folder_name: 'Test' })
      })
    }
  }
}))

jest.mock('backend/logger', () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarning: jest.fn(),
  LogPrefix: { DownloadManager: 'DownloadManager' }
}))

jest.mock('backend/utils', () => ({
  getFileSize: () => '1 MB',
  removeFolder: jest.fn(),
  sendGameStatusUpdate: jest.fn()
}))

jest.mock('../utils', () => ({
  installQueueElement: (...args: unknown[]) => mockInstallQueueElement(...args),
  updateQueueElement: (...args: unknown[]) => mockUpdateQueueElement(...args)
}))

jest.mock('backend/ipc', () => ({ sendFrontendMessage: jest.fn() }))
jest.mock('backend/utils/aborthandler/aborthandler', () => ({
  callAbortController: (...args: unknown[]) => mockAbort(...args)
}))
jest.mock('backend/dialog/dialog', () => ({ notify: jest.fn() }))
jest.mock('i18next', () => ({
  __esModule: true,
  default: { t: (key: string) => key }
}))
jest.mock('backend/storeManagers/gog/redist', () => ({
  createRedistDMQueueElement: () => mockCreateRedist()
}))
jest.mock('backend/storeManagers/gog/constants', () => ({
  gogRedistPath: '/tmp/gog-redist'
}))
jest.mock('backend/online_monitor', () => ({
  onConnectivityChange: jest.fn()
}))
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: mockExistsSync as typeof actual.existsSync
  }
})

function redistElement(): DMQueueElement {
  return {
    type: 'update',
    addToQueueTime: 1,
    startTime: 0,
    endTime: 0,
    params: {
      appName: 'gog-redist',
      runner: 'gog',
      path: '/tmp/gog-redist',
      platformToInstall: 'windows',
      gameInfo: { title: 'Galaxy Common Redistributables' } as never,
      size: '?? MB'
    }
  }
}

function gameElement(type: 'install' | 'update'): DMQueueElement {
  return {
    type,
    addToQueueTime: 2,
    startTime: 0,
    endTime: 0,
    params: {
      appName: '1207658642',
      runner: 'gog',
      path: '/games/test',
      platformToInstall: 'windows',
      gameInfo: { title: 'Test Game' } as never
    }
  }
}

async function loadQueue() {
  let queue: typeof import('../downloadqueue') | undefined
  await jest.isolateModulesAsync(async () => {
    queue = await import('../downloadqueue')
  })
  return queue!
}

async function drain() {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

describe('GOG download queue', () => {
  beforeEach(() => {
    mockStoreData.queue = []
    mockStoreData.finished = []
    mockExistsSync.mockReturnValue(true)
    mockGetGameInfo.mockReturnValue({ title: 'Test Game' })
    mockGetInstallInfo.mockImplementation((appName: string) => {
      if (appName === 'gog-redist') {
        return Promise.resolve({ manifest: { download_size: 10 } })
      }
      return Promise.resolve({
        manifest: { download_size: 100, dependencies: ['ISI'] }
      })
    })
    mockCreateRedist.mockImplementation(redistElement)
    mockUpdateQueueElement.mockResolvedValue({ status: 'done' })
    mockInstallQueueElement.mockResolvedValue({ status: 'done' })
  })

  test('starts a Windows GOG update before redistributables', async () => {
    const { addToQueue, getQueueInformation } = await loadQueue()

    await addToQueue(gameElement('update'))
    await drain()

    expect(
      mockUpdateQueueElement.mock.calls.map((call) => call[0].appName)
    ).toEqual(['1207658642', 'gog-redist'])
    expect(mockInstallQueueElement).not.toHaveBeenCalled()
    expect(getQueueInformation().state).toBe('idle')
  })

  test('still downloads redistributables before a Windows GOG install', async () => {
    const { addToQueue } = await loadQueue()

    await addToQueue(gameElement('install'))
    await drain()

    expect(
      mockUpdateQueueElement.mock.calls.map((call) => call[0].appName)
    ).toEqual(['gog-redist'])
    expect(
      mockInstallQueueElement.mock.calls.map((call) => call[0].appName)
    ).toEqual(['1207658642'])
  })

  test('stops a running redistributable sync so the game update can start', async () => {
    const pending: Record<string, (value: { status: 'done' }) => void> = {}
    let redistRuns = 0
    mockUpdateQueueElement.mockImplementation((params: { appName: string }) => {
      const key =
        params.appName === 'gog-redist'
          ? `gog-redist-${++redistRuns}`
          : params.appName
      return new Promise((resolve) => {
        pending[key] = resolve
      })
    })

    const { addToQueue, getQueueInformation } = await loadQueue()
    await addToQueue(redistElement())
    expect(getQueueInformation().state).toBe('running')
    expect(getQueueInformation().elements[0].params.appName).toBe('gog-redist')

    await addToQueue(gameElement('update'))

    expect(
      getQueueInformation().elements.map((element) => element.params.appName)
    ).toEqual(['1207658642', 'gog-redist'])
    expect(mockAbort).toHaveBeenCalledWith('gog-redist')
    expect(mockUpdateQueueElement).toHaveBeenCalledTimes(1)

    pending['gog-redist-1']({ status: 'done' })
    await drain()

    expect(
      mockUpdateQueueElement.mock.calls.map((call) => call[0].appName)
    ).toEqual(['gog-redist', '1207658642'])
    expect(
      getQueueInformation().elements.map((element) => element.params.appName)
    ).toEqual(['1207658642', 'gog-redist'])
    expect(getQueueInformation().state).toBe('running')

    pending['1207658642']({ status: 'done' })
    await drain()
    pending['gog-redist-2']({ status: 'done' })
    await drain()

    expect(getQueueInformation().state).toBe('idle')
    expect(getQueueInformation().elements).toEqual([])
  })
})
