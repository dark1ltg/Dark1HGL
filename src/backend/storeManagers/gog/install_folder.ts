import { existsSync, readdirSync } from 'fs'
import { join } from 'path'

const INFO_FILE = /^goggame-\d+\.info$/

export function looksLikeGogInstall(dir: string, appName: string): boolean {
  if (!dir || !existsSync(dir)) return false
  if (existsSync(join(dir, `goggame-${appName}.info`))) return true
  if (existsSync(join(dir, 'game', `goggame-${appName}.info`))) return true
  if (existsSync(join(dir, 'gameinfo'))) return true
  try {
    return readdirSync(dir).some((name) => INFO_FILE.test(name))
  } catch {
    return false
  }
}

/**
 * gogdl downloads into `--path` / folder_name. If GOG metadata is missing
 * after a successful download, find the folder that actually has game files.
 */
export function resolveGogInstallFolder(
  basePath: string,
  folderName: string | undefined,
  appName: string
): string | undefined {
  const named = folderName ? join(basePath, folderName) : undefined
  if (named && existsSync(named)) return named
  if (looksLikeGogInstall(basePath, appName)) return basePath
  try {
    for (const name of readdirSync(basePath)) {
      const child = join(basePath, name)
      if (looksLikeGogInstall(child, appName)) return child
    }
  } catch {
    // basePath missing or unreadable
  }
  if (named && existsSync(named)) return named
  if (existsSync(basePath) && looksLikeGogInstall(basePath, appName)) {
    return basePath
  }
  return undefined
}
