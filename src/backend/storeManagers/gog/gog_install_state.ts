import { existsSync, rmSync, writeFileSync } from 'graceful-fs'
import { join } from 'path'

import { logInfo, logWarning, LogPrefix } from 'backend/logger'

export const GOGDL_RESUME_FILE = '.gogdl-resume'
export const GOG_INCOMPLETE_FILE = '.heroic-gog-incomplete'

function gogdlResumePath(installPath: string) {
  return join(installPath, GOGDL_RESUME_FILE)
}

function gogIncompletePath(installPath: string) {
  return join(installPath, GOG_INCOMPLETE_FILE)
}

function removeFile(path: string, label: string) {
  if (!existsSync(path)) return false
  try {
    rmSync(path)
    logInfo(['Removed', label, path], LogPrefix.Gog)
    return true
  } catch (error) {
    logWarning(['Could not remove', label, path, error], LogPrefix.Gog)
    return false
  }
}

/** Drop gogdl's resume marker so a retry is not stuck on the hung patch. */
export function clearGogdlResume(installPath?: string) {
  if (!installPath) return false
  return removeFile(gogdlResumePath(installPath), 'GOG resume file')
}

/** Mark a folder whose last GOG write was aborted mid-update. */
export function markGogInstallIncomplete(installPath?: string) {
  if (!installPath || !existsSync(installPath)) return false
  try {
    writeFileSync(gogIncompletePath(installPath), 'stalled\n')
    return true
  } catch (error) {
    logWarning(
      ['Could not write GOG incomplete marker', installPath, error],
      LogPrefix.Gog
    )
    return false
  }
}

export function clearGogInstallIncomplete(installPath?: string) {
  if (!installPath) return false
  return removeFile(gogIncompletePath(installPath), 'GOG incomplete marker')
}

export function gogInstallLooksIncomplete(installPath?: string) {
  if (!installPath) return false
  return (
    existsSync(gogdlResumePath(installPath)) ||
    existsSync(gogIncompletePath(installPath))
  )
}

/** After a stall abort: do not resume the hung write, and do not offer Play. */
export function recordGogWriteStall(installPath?: string) {
  clearGogdlResume(installPath)
  markGogInstallIncomplete(installPath)
}
