/** True = treat as up to date (do not badge an update). */
export function linuxInstallerIsCurrent(
  installers: Array<{ os?: string; version?: string }> | undefined,
  installedVersion: string
): boolean {
  const linux = installers?.find((installer) => installer.os === 'linux')
  if (!linux?.version) return true
  return linux.version === installedVersion
}
