import { libraryManagerMap } from 'backend/storeManagers'
import { TypeCheckedStoreBackend } from './../electron_store'
import { logError, logInfo, LogPrefix, logWarning } from 'backend/logger'
import { getFileSize, removeFolder, sendGameStatusUpdate } from '../utils'
import { DMQueueElement, DMStatus, DownloadManagerState } from 'common/types'
import { installQueueElement, updateQueueElement } from './utils'
import { sendFrontendMessage } from '../ipc'
import { callAbortController } from 'backend/utils/aborthandler/aborthandler'
import { notify } from '../dialog/dialog'
import i18next from 'i18next'
import {
  checkForRedistUpdates,
  createRedistDMQueueElement
} from 'backend/storeManagers/gog/redist'
import { existsSync } from 'fs'
import { join } from 'path'
import { gogRedistPath } from 'backend/storeManagers/gog/constants'
import { onConnectivityChange } from 'backend/online_monitor'

const downloadManager = new TypeCheckedStoreBackend('downloadManager', {
  cwd: 'store',
  name: 'download-manager'
})

/*
#### Private ####
*/

let queueState: DownloadManagerState = 'idle'
let currentElement: DMQueueElement | null = null
let autoPaused = false
let drainingQueue = false
// Dependencies captured when a game update stops a running redistributable
// sync. The aborted item is removed from the queue, then queued again behind
// the game so the download the user asked for can start.
let redistInterruptedForGame: string[] | null = null

onConnectivityChange((status) => {
  if (status === 'offline' && isRunning()) {
    logInfo('System offline, auto-pausing downloads', LogPrefix.DownloadManager)
    pauseCurrentDownload()
    autoPaused = true
  } else if (status === 'online' && autoPaused) {
    logInfo('System online, auto-resuming downloads', LogPrefix.DownloadManager)
    autoPaused = false
    void resumeCurrentDownload()
  }
})

function getFirstQueueElement() {
  const elements = downloadManager.get('queue', [])
  return elements.at(0) ?? null
}

function isPaused(): boolean {
  return queueState === 'paused'
}

function isRunning(): boolean {
  return queueState === 'running'
}

function isGameUpdate(element: DMQueueElement): boolean {
  return element.type === 'update' && element.params.appName !== 'gog-redist'
}

// The download list only runs queue[0]. A game update has to be ahead of the
// Galaxy redistributable sync or it stays under Queued until that sync ends.
function moveAheadOfRedist(
  elements: DMQueueElement[],
  element: DMQueueElement
) {
  const gameIndex = elements.findIndex(
    (queued) =>
      queued.params.appName === element.params.appName &&
      queued.params.runner === element.params.runner
  )
  const redistIndex = elements.findIndex(
    (queued) => queued.params.appName === 'gog-redist'
  )
  if (gameIndex === -1 || redistIndex === -1 || gameIndex <= redistIndex) {
    return
  }
  const [game] = elements.splice(gameIndex, 1)
  elements.splice(redistIndex, 0, game)
}

function sameQueueItem(a: DMQueueElement, b: DMQueueElement) {
  return (
    a.params.appName === b.params.appName && a.params.runner === b.params.runner
  )
}

// `get('queue', [])` hands back a new array when the queue is not stored yet.
// Holding that array across an await and then saving it replaces whatever
// download started in the meantime, so the list can show only redistributables
// while the game is the download actually reporting progress.
function saveQueue(elements: DMQueueElement[]) {
  if (currentElement && queueState === 'running') {
    const runningIndex = elements.findIndex((queued) =>
      sameQueueItem(queued, currentElement!)
    )
    const gameIsAhead =
      currentElement.params.appName === 'gog-redist' &&
      elements.some(
        (queued, index) =>
          isGameUpdate(queued) && (runningIndex === -1 || index < runningIndex)
      )
    if (!gameIsAhead) {
      if (runningIndex > 0) {
        const [running] = elements.splice(runningIndex, 1)
        elements.unshift(running)
      } else if (runningIndex === -1) {
        elements.unshift(currentElement)
      }
    }
  }

  downloadManager.set('queue', elements)
  sendFrontendMessage('changedDMQueueInformation', elements, queueState)
}

function queueGogRedist(
  elements: DMQueueElement[],
  element: DMQueueElement,
  dependencies: string[]
) {
  if (isGameUpdate(element)) {
    const queuedRedist = elements.find(
      (queued) => queued.params.appName === 'gog-redist'
    )
    if (queuedRedist) {
      queuedRedist.params.dependencies = [
        ...new Set([
          ...(queuedRedist.params.dependencies ?? []),
          ...dependencies
        ])
      ]
      return
    }
  }

  const redistElement = createRedistDMQueueElement()
  redistElement.params.dependencies = dependencies
  elements.push(redistElement)
}

function addToFinished(element: DMQueueElement, status: DMStatus) {
  const elements = downloadManager.get('finished', [])

  const elementIndex = elements.findIndex(
    (el) => el.params.appName === element.params.appName
  )

  if (elementIndex >= 0) {
    elements[elementIndex] = { ...element, status: status ?? 'abort' }
  } else {
    elements.push({ ...element, status })
  }

  downloadManager.set('finished', elements)
  logInfo(
    [element.params.appName, 'added to download manager finished.'],
    LogPrefix.DownloadManager
  )
}

/*
#### Public ####
*/

function startQueue() {
  if (queueState === 'paused' || drainingQueue) {
    return
  }
  drainingQueue = true
  void initQueue().finally(() => {
    drainingQueue = false
    if (queueState !== 'paused' && getFirstQueueElement()) {
      startQueue()
    }
  })
}

async function initQueue() {
  let element = getFirstQueueElement()

  while (element) {
    const queuedElements = downloadManager.get('queue', [])
    element.startTime = Date.now()
    const index = queuedElements.findIndex((queued) =>
      sameQueueItem(queued, element!)
    )
    if (index > 0) {
      queuedElements.splice(index, 1)
      queuedElements.unshift(element)
    } else if (index === -1) {
      queuedElements.unshift(element)
    }
    queuedElements[0] = element

    currentElement = element
    queueState = 'running'
    saveQueue(queuedElements)

    const { status } =
      element.type === 'install'
        ? await installQueueElement(element.params)
        : await updateQueueElement(element.params)
    element.endTime = Date.now()

    processNotification(element, status)

    if (!isPaused()) {
      addToFinished(element, status)
      // Drop the finished item before saving the queue again, or it is put
      // back at the front because it is still the current download.
      currentElement = null
      removeFromQueue(element.params.appName)
      if (redistInterruptedForGame && element.params.appName === 'gog-redist') {
        const dependencies = redistInterruptedForGame
        redistInterruptedForGame = null
        const remaining = downloadManager.get('queue', [])
        if (
          !remaining.some((queued) => queued.params.appName === 'gog-redist')
        ) {
          const redistElement = createRedistDMQueueElement()
          redistElement.params.dependencies = dependencies
          remaining.push(redistElement)
          downloadManager.set('queue', remaining)
          sendFrontendMessage(
            'changedDMQueueInformation',
            remaining,
            queueState
          )
        }
      }
      element = getFirstQueueElement()
    } else {
      redistInterruptedForGame = null
      element = null
    }
  }

  if (queueState !== 'paused') {
    queueState = 'idle'
  }
}

async function addToQueue(element: DMQueueElement) {
  if (!element) {
    logError(
      'Can not add undefined element to queue!',
      LogPrefix.DownloadManager
    )
    return
  }

  let dependencies: string[] | undefined
  const gameInfo = libraryManagerMap[element.params.runner].getGameInfo(
    element.params.appName
  )
  if (!gameInfo?.isEAManaged && !gameInfo?.isUbisoftManaged) {
    try {
      const installInfo = await libraryManagerMap[
        element.params.runner
      ].getInstallInfo(
        element.params.appName,
        element.params.platformToInstall,
        {
          branch: element.params.branch,
          build: element.params.build
        }
      )

      element.params.size = installInfo?.manifest?.download_size
        ? getFileSize(installInfo.manifest.download_size)
        : '?? MB'

      if (
        element.params.runner === 'gog' &&
        element.params.platformToInstall?.toLowerCase() === 'windows' &&
        installInfo &&
        installInfo.manifest &&
        'dependencies' in installInfo.manifest
      ) {
        dependencies = installInfo.manifest.dependencies || []
      }
    } catch (error) {
      logError(
        ['Failed to read install info for', element.params.appName, error],
        LogPrefix.DownloadManager
      )
      element.params.size = element.params.size ?? '?? MB'
    }
  } else {
    element.params.size = '?? MB'
  }

  const elements = downloadManager.get('queue', [])
  const elementIndex = elements.findIndex((queued) =>
    sameQueueItem(queued, element)
  )

  const windowsGog =
    element.params.runner === 'gog' &&
    element.params.platformToInstall?.toLowerCase() === 'windows' &&
    element.params.appName !== 'gog-redist'
  // A listed dependency is not a reason to download Galaxy Common
  // Redistributables again. Queue that sync only when it has never been
  // stored. checkForRedistUpdates queues it later if the repository actually
  // changed.
  const redistMissing =
    windowsGog && !existsSync(join(gogRedistPath, '.gogdl-redist-manifest'))

  if (elementIndex >= 0) {
    elements[elementIndex] = element
  } else {
    if (redistMissing) {
      queueGogRedist(elements, element, dependencies ?? [])
    }
    elements.push(element)
  }

  if (isGameUpdate(element)) {
    moveAheadOfRedist(elements, element)
  }

  const alreadyRunning =
    isRunning() && !!currentElement && sameQueueItem(currentElement, element)

  saveQueue(elements)
  if (!alreadyRunning) {
    sendGameStatusUpdate({
      appName: element.params.appName,
      runner: element.params.runner,
      folder: element.params.path,
      status: 'queued'
    })
  }
  logInfo(
    [element.params.gameInfo.title, ' was added to the download queue.'],
    LogPrefix.DownloadManager
  )

  const interruptRedist =
    isGameUpdate(element) &&
    isRunning() &&
    currentElement?.params.appName === 'gog-redist'

  if (interruptRedist) {
    logInfo(
      [
        'Stopping GOG redistributables so',
        element.params.gameInfo.title,
        'can update'
      ],
      LogPrefix.DownloadManager
    )
    redistInterruptedForGame = currentElement?.params.dependencies ?? []
    callAbortController('gog-redist')
  } else {
    startQueue()
  }

  if (windowsGog) {
    void checkForRedistUpdates()
  }
}

function removeFromQueue(appName: string) {
  if (appName && downloadManager.has('queue')) {
    const elements = downloadManager.get('queue', [])
    const index = elements.findIndex(
      (queueElement) => queueElement?.params.appName === appName
    )
    if (index !== -1) {
      elements.splice(index, 1)
      downloadManager.delete('queue')
      downloadManager.set('queue', elements)
    }

    sendGameStatusUpdate({
      appName,
      status: 'done'
    })

    logInfo(
      [appName, 'removed from download manager.'],
      LogPrefix.DownloadManager
    )

    sendFrontendMessage('changedDMQueueInformation', elements, queueState)
  }
}

function getQueueInformation() {
  const elements = downloadManager.get('queue', [])
  const finished = downloadManager.get('finished', [])

  return { elements, finished, state: queueState }
}

function cancelCurrentDownload({ removeDownloaded = false }) {
  if (currentElement) {
    if (Array.isArray(currentElement.params.installDlcs)) {
      const dlcsToRemove = currentElement.params.installDlcs
      for (const dlc of dlcsToRemove) {
        removeFromQueue(dlc)
      }
    }
    if (isRunning()) {
      stopCurrentDownload()
    }
    removeFromQueue(currentElement.params.appName)

    if (removeDownloaded) {
      const { appName, runner } = currentElement.params
      const { folder_name } = libraryManagerMap[runner]
        .getGame(appName)
        .getGameInfo()
      if (folder_name) {
        removeFolder(currentElement.params.path, folder_name)
      }
    }
    currentElement = null
  }
}

function pauseCurrentDownload() {
  if (currentElement) {
    stopCurrentDownload()
  }
  queueState = 'paused'
  autoPaused = false
  sendFrontendMessage(
    'changedDMQueueInformation',
    downloadManager.get('queue', []),
    queueState
  )
}

function resumeCurrentDownload() {
  autoPaused = false
  queueState = 'idle'
  startQueue()
}

function stopCurrentDownload() {
  const { appName, runner } = currentElement!.params
  callAbortController(appName)
  libraryManagerMap[runner].getGame(appName).stop(false)
}

// notify the user based on the status of the element and the status of the queue
function processNotification(element: DMQueueElement, status: DMStatus) {
  const action = element.type === 'install' ? 'Installation' : 'Update'
  if (
    element.params.runner === 'gog' &&
    element.params.appName === 'gog-redist'
  ) {
    return
  }
  const { title } = libraryManagerMap[element.params.runner]
    .getGame(element.params.appName)
    .getGameInfo()

  if (status === 'abort') {
    if (isPaused()) {
      logWarning(
        [action, 'of', element.params.appName, 'paused!'],
        LogPrefix.DownloadManager
      )
      // i18next.t('notify.update.paused', 'Update Paused')
      // i18next.t('notify.install.paused', 'Installation Paused')
      notify({ title, body: i18next.t(`notify.${element.type}.paused`) })
    } else {
      logWarning(
        [action, 'of', element.params.appName, 'aborted!'],
        LogPrefix.DownloadManager
      )
      // i18next.t('notify.update.canceled', 'Update Canceled')
      // i18next.t('notify.install.canceled', 'Installation Canceled')
      notify({ title, body: i18next.t(`notify.${element.type}.canceled`) })
    }
  } else if (status === 'error') {
    logWarning(
      [action, 'of', element.params.appName, 'failed!'],
      LogPrefix.DownloadManager
    )
    // i18next.t('notify.update.failed', 'Update Failed')
    // i18next.t('notify.install.failed', 'Installation Failed')
    notify({ title, body: i18next.t(`notify.${element.type}.failed`) })
  } else if (status === 'done') {
    // i18next.t('notify.update.finished', 'Update Finished')
    // i18next.t('notify.install.finished', 'Installation Finished')
    notify({
      title,
      body: i18next.t(`notify.${element.type}.finished`)
    })

    logInfo(
      ['Finished', action, 'of', element.params.appName],
      LogPrefix.DownloadManager
    )
  }
}

export {
  initQueue,
  addToQueue,
  removeFromQueue,
  getQueueInformation,
  cancelCurrentDownload,
  pauseCurrentDownload,
  resumeCurrentDownload,
  isRunning
}
