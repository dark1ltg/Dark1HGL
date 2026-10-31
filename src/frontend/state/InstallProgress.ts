import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'

import type { InstallProgress, Runner } from 'common/types'

export type LiveInstallProgress = InstallProgress & { receivedAt: number }

type StoreType = Record<`${string}_${Runner}`, LiveInstallProgress>

const useInstallProgressRaw = create<StoreType>()(() => ({}))

window.api.onProgressUpdate((_e, { appName, progress, runner }) => {
  if (!progress || !runner) return
  const key = `${appName}_${runner}`
  useInstallProgressRaw.setState({
    [key]: { ...progress, receivedAt: Date.now() }
  })
})

export const useInstallProgress = <T>(
  selector: Parameters<typeof useShallow<StoreType, T>>[0]
) => useInstallProgressRaw(useShallow(selector))
