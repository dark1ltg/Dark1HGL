// Manage redist required by games and push them to download queue
// as Galaxy Common Redistributables

import path from 'path'
import { existsSync } from 'fs'
import { readdir, readFile, writeFile } from 'fs/promises'
import { assessRedistManifest, sameRedistIds } from './redist_decision'
import { logError, logInfo, LogPrefix } from 'backend/logger'
import {
  GOGRedistManifest,
  GOGv1Manifest,
  GOGv2Manifest
} from 'common/types/gog'
import { libraryManagerMap } from '..'
import { GlobalConfig } from 'backend/config'
import {
  addToQueue,
  getQueueInformation
} from 'backend/downloadmanager/downloadqueue'
import { DMQueueElement } from 'common/types'
import { GOGUser } from './user'
import { isOnline } from 'backend/online_monitor'
import { axiosClient } from 'backend/utils'
import { gogdlConfigPath, gogRedistPath } from './constants'
import { gamesConfigPath } from 'backend/constants/paths'
import LogWriter from '../../logger/log_writer'

let redistCheck: Promise<void> | undefined

export async function checkForRedistUpdates() {
  if (!GOGUser.isLoggedIn() || !isOnline()) {
    return
  }
  if (!redistCheck) {
    redistCheck = runRedistCheck().finally(() => {
      redistCheck = undefined
    })
  }
  return redistCheck
}

async function runRedistCheck() {
  const manifestPath = path.join(gogRedistPath, '.gogdl-redist-manifest')
  const requiredIds = await getRequiredRedistList()
  let manifest: GOGRedistManifest | undefined
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(await readFile(manifestPath, { encoding: 'utf8' }))
    } catch (e) {
      logError(['Failed to read gog redist manifest', e], {
        prefix: LogPrefix.Gog
      })
      return
    }
  }

  let remoteBuildId: string | undefined
  try {
    const response = await axiosClient.get(
      'https://content-system.gog.com/dependencies/repository?generation=2'
    )
    if (typeof response.data?.build_id === 'string') {
      remoteBuildId = response.data.build_id
    }
  } catch (e) {
    logError(['Failed to check GOG redistributable repository', e], {
      prefix: LogPrefix.Gog
    })
  }

  const decision = assessRedistManifest(manifest, requiredIds, remoteBuildId)
  if (!decision.update) {
    if (manifest && !sameRedistIds(manifest.HGLInstalled, decision.installed)) {
      await stampInstalledRedist(decision.installed)
    }
    logInfo('GOG redistributables are already installed', {
      prefix: LogPrefix.Gog
    })
    return
  }

  logInfo('Updating redist, reason - installed set or repository changed', {
    prefix: LogPrefix.Gog
  })
  await pushRedistUpdateToQueue()
}

async function stampInstalledRedist(ids: string[]) {
  const manifestPath = path.join(gogRedistPath, '.gogdl-redist-manifest')
  if (!existsSync(manifestPath)) {
    return
  }
  try {
    const manifest: GOGRedistManifest = JSON.parse(
      await readFile(manifestPath, { encoding: 'utf8' })
    )
    if (sameRedistIds(manifest.HGLInstalled, ids)) {
      return
    }
    manifest.HGLInstalled = ids
    await writeFile(manifestPath, JSON.stringify(manifest))
  } catch (e) {
    logError(['Failed to record installed GOG redistributables', e], {
      prefix: LogPrefix.Gog
    })
  }
}

async function pushRedistUpdateToQueue() {
  const currentQueue = getQueueInformation()

  const currentRedistElement = currentQueue.elements.find(
    (element) => element.params.appName === 'gog-redist'
  )

  if (currentRedistElement) {
    return
  }
  const newElement = createRedistDMQueueElement()

  await addToQueue(newElement)
}

export function createRedistDMQueueElement(): DMQueueElement {
  const gameInfo = libraryManagerMap['gog'].getGame('gog-redist').getGameInfo()
  const newElement: DMQueueElement = {
    params: {
      appName: 'gog-redist',
      runner: 'gog',
      path: gogRedistPath,
      platformToInstall: 'windows',
      gameInfo,
      size: '?? MB'
    },
    addToQueueTime: new Date().getTime(),
    startTime: 0,
    endTime: 0,
    type: 'update'
  }
  return newElement
}

export async function getRequiredRedistList(): Promise<string[]> {
  // Scan manifests in gogdl directory to obtain list of redist that will be
  // required
  const manifestsDir = path.join(gogdlConfigPath, 'manifests')
  if (!existsSync(manifestsDir)) {
    return ['ISI']
  }

  const manifests = await readdir(manifestsDir)
  const redist: string[] = ['ISI']
  // Iterate over files
  for (const manifest of manifests) {
    const manifestDataRaw = await readFile(path.join(manifestsDir, manifest), {
      encoding: 'utf8'
    })
    try {
      const manifestData: GOGv1Manifest | GOGv2Manifest =
        JSON.parse(manifestDataRaw)

      // Get list from manifest and merge with global redist variable
      if (manifestData.version === 1) {
        const dependencies = manifestData.product.depots.reduce((acc, next) => {
          if ('redist' in next) {
            acc.push(next.redist)
          }
          return acc
        }, [] as string[])
        for (const dependency of dependencies) {
          if (!redist.includes(dependency)) {
            redist.push(dependency)
          }
        }
      } else if (manifestData.version === 2) {
        for (const dependency of manifestData.dependencies || []) {
          if (!redist.includes(dependency)) {
            redist.push(dependency)
          }
        }
      }
    } catch (e) {
      logError(['REDIST:', 'Unable to parse manifest', manifest, String(e)], {
        prefix: LogPrefix.Gog
      })
      continue
    }
  }

  return redist
}

export async function updateRedist(redistToSync: string[]): Promise<{
  status: 'done' | 'error'
}> {
  const { maxWorkers } = GlobalConfig.get().getSettings()
  const workers = maxWorkers ? ['--max-workers', `${maxWorkers}`] : []
  const logPath = path.join(gamesConfigPath, 'gog-redist.log')

  const commandParts = [
    'redist',
    '--ids',
    redistToSync.join(','),
    '--path',
    gogRedistPath,
    ...workers
  ]

  logInfo('Updating GOG redistributables', {
    prefix: LogPrefix.Gog
  })

  const redistLogWriter = new LogWriter(logPath, false, false)
  const res = await libraryManagerMap['gog'].runRunnerCommand(commandParts, {
    abortId: 'gog-redist',
    logMessagePrefix: 'GOG REDIST:',
    logWriters: [redistLogWriter],
    onOutput: (output) =>
      libraryManagerMap['gog']
        .getGame('gog-redist')
        .onInstallOrUpdateOutput('updating', output)
  })

  if (res.abort) {
    return { status: 'done' }
  }

  if (res.error) {
    logError(['Failed to update redist', res.error], LogPrefix.Gog)
    return { status: 'error' }
  }

  const manifestPath = path.join(gogRedistPath, '.gogdl-redist-manifest')
  if (existsSync(manifestPath)) {
    try {
      const manifest: GOGRedistManifest = JSON.parse(
        await readFile(manifestPath, { encoding: 'utf8' })
      )
      const decision = assessRedistManifest(
        manifest,
        redistToSync,
        manifest.build_id
      )
      await stampInstalledRedist(decision.installed)
    } catch (e) {
      logError(['Failed to record installed GOG redistributables', e], {
        prefix: LogPrefix.Gog
      })
    }
  }

  return { status: 'done' }
}
