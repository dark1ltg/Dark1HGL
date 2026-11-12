import { InstallProgress, Runner } from 'common/types'

const storage: Storage = window.localStorage

export function progressStorageKey(appName: string, runner: Runner) {
  return `${appName}_${runner}_progress`
}

export function readStoredProgress(
  appName: string,
  runner?: Runner
): InstallProgress {
  const suffixed = runner
    ? storage.getItem(progressStorageKey(appName, runner))
    : null
  return JSON.parse(suffixed || storage.getItem(appName) || '{}')
}

export function writeStoredProgress(
  appName: string,
  runner: Runner,
  progress: InstallProgress
) {
  const payload = JSON.stringify(progress)
  storage.setItem(progressStorageKey(appName, runner), payload)
  storage.setItem(appName, payload)
}

export function clearStoredProgress(appName: string, runner?: Runner) {
  storage.removeItem(appName)
  if (runner) storage.removeItem(progressStorageKey(appName, runner))
}
