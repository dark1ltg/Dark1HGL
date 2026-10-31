import { Runner, Status } from 'common/types'
import { TFunction } from 'i18next'

type StatusArgs = {
  status: Status
  t: TFunction<'gamepage', undefined>
  runner: Runner
  statusContext?: string
  percent?: number
  size?: string
  writingToDisk?: boolean
  writingDetail?: string
  readingSpeed?: number
}

export function getStatusLabel({
  status,
  statusContext,
  t,
  runner,
  size,
  percent,
  writingToDisk,
  writingDetail,
  readingSpeed
}: StatusArgs): string {
  const roundedPercent = Math.ceil(percent || 0)
  const writePercent = (percent ?? 0).toFixed(1)
  const statusMap: Partial<Record<Status, string>> = {
    notSupportedGame: t('gamepage:status.notSupportedGame', 'Not Supported'),
    notAvailable: t('gamepage:status.gameNotAvailable', 'Game not available'),
    playing: t('gamepage:status.playing', 'Playing'),
    queued: `${t('gamepage:status.queued', 'Queued')}`,
    uninstalling: t('gamepage:status.uninstalling', 'Uninstalling'),
    updating:
      writingDetail && readingSpeed
        ? t(
            'gamepage:status.updatingReading',
            'Updating Game {{percent}}% · {{detail}} · reading {{speed}} MB/s',
            {
              percent: writePercent,
              detail: writingDetail,
              speed: readingSpeed
            }
          )
        : writingDetail
          ? t(
              'gamepage:status.updatingDetail',
              'Updating Game {{percent}}% · {{detail}}',
              { percent: writePercent, detail: writingDetail }
            )
          : writingToDisk
            ? t(
                'gamepage:status.updatingWriting',
                'Updating Game {{percent}}% - writing to disk',
                { percent: roundedPercent }
              )
            : `${t('gamepage:status.updating')} ${roundedPercent}%`,
    installing:
      writingDetail && readingSpeed
        ? t(
            'gamepage:status.installingReading',
            'Downloading {{percent}}% · {{detail}} · reading {{speed}} MB/s',
            {
              percent: writePercent,
              detail: writingDetail,
              speed: readingSpeed
            }
          )
        : writingDetail
          ? t(
              'gamepage:status.installingDetail',
              'Downloading {{percent}}% · {{detail}}',
              { percent: writePercent, detail: writingDetail }
            )
          : writingToDisk
            ? t(
                'gamepage:status.installingWriting',
                'Downloading {{percent}}% - writing to disk',
                { percent: roundedPercent }
              )
            : `${t('gamepage:status.downloading', 'Downloading')} ${roundedPercent}%`,
    extracting: t('gamepage:status.extracting', 'Extracting'),
    'syncing-saves': t('gamepage:status.syncingSaves', 'Syncing Saves'),
    moving: t('gamepage:gamecard.moving', 'Moving'),
    repairing: t('gamepage:gamecard.repairing', 'Repairing'),
    installed: `${t('gamepage:status.installed')} ${
      runner === 'sideload' ? '' : size
    }`,
    notInstalled: t('gamepage:status.notinstalled'),
    launching: t('gamepage:status.launching', 'Launching'),
    winetricks: t('gamepage:status.winetricks', 'Applying Winetricks fixes'),
    redist: t(
      'gamepage:status.redist',
      'Installing Redistributables ({{redist}})',
      { redist: statusContext || '' }
    )
  }

  return statusMap[status] || t('gamepage:status.notinstalled')
}

const storage = window.localStorage
const nonAvailbleGames = storage.getItem('nonAvailableGames') || '[]'
const nonAvailbleGamesArray = JSON.parse(nonAvailbleGames)

export async function handleNonAvailableGames(appName: string, runner: Runner) {
  const gameAvailable = await window.api.isGameAvailable({
    appName,
    runner
  })

  if (!gameAvailable) {
    if (!nonAvailbleGamesArray.includes(appName)) {
      nonAvailbleGamesArray.push(appName)
      storage.setItem(
        'nonAvailableGames',
        JSON.stringify(nonAvailbleGamesArray)
      )
    }
  } else {
    if (nonAvailbleGamesArray.includes(appName)) {
      nonAvailbleGamesArray.splice(nonAvailbleGamesArray.indexOf(appName), 1)
      storage.setItem(
        'nonAvailableGames',
        JSON.stringify(nonAvailbleGamesArray)
      )
    }
  }
  return gameAvailable
}
