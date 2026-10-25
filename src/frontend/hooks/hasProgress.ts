import { useEffect, useState } from 'react'
import { InstallProgress, Runner } from 'common/types'
import {
  LiveInstallProgress,
  useInstallProgress
} from 'frontend/state/InstallProgress'

const storage: Storage = window.localStorage

// gogdl only moves the percent when a whole file finishes writing. On an
// external drive that can take minutes, so the same percent is not "stuck"
// until this long with no new progress line at all.
const PROGRESS_STALL_MS = 20_000

type ShownProgress = InstallProgress & { receivedAt?: number }

export const hasProgress = (appName: string, runner: Runner) => {
  const [previousProgress] = useState<InstallProgress>(
    JSON.parse(
      storage.getItem(`${appName}_${runner}_progress`) || '{}'
    ) as InstallProgress
  )

  const [currentProgress, setProgress] = useState<ShownProgress>(
    previousProgress ?? {
      bytes: '0.00MB',
      eta: '00:00:00',
      percent: 0
    }
  )

  const installationProgress = useInstallProgress(
    (state) => state[`${appName}_${runner}`]
  )

  useEffect(() => {
    if (!installationProgress) return
    setProgress({
      ...installationProgress,
      percent: blendPercent(installationProgress, previousProgress)
    })
  }, [installationProgress, previousProgress])

  return [currentProgress, previousProgress] as const
}

function blendPercent(
  newProgress: LiveInstallProgress,
  previousProgress: InstallProgress
) {
  // current/100 * (100-heroic_stored) + heroic_stored
  if (newProgress.percent && previousProgress.percent) {
    const currentPercent = newProgress.percent
    const storedPercent = previousProgress.percent
    return Math.round(
      (currentPercent / 100) * (100 - storedPercent) + storedPercent
    )
  }
  return newProgress.percent
}

export function useProgressIsStale(progress: ShownProgress, active: boolean) {
  const [stale, setStale] = useState(false)

  useEffect(() => {
    if (!active || !progress.receivedAt) {
      setStale(false)
      return
    }

    const mark = () => {
      setStale(Date.now() - (progress.receivedAt ?? 0) >= PROGRESS_STALL_MS)
    }
    mark()
    const id = window.setInterval(mark, 5000)
    return () => window.clearInterval(id)
  }, [active, progress.receivedAt])

  return stale
}
