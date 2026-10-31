import './index.css'
import { hasProgress, useProgressIsStale } from 'frontend/hooks/hasProgress'
import { useEffect, useState } from 'react'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import { Box, LinearProgress, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { DownloadManagerState, Runner } from 'common/types'

interface Point {
  download: number
  disk: number
}

const roundToNearestHundredth = function (val: number | undefined) {
  if (!val) return 0
  return Math.round(val * 100) / 100
}

export default function ProgressHeader(props: {
  appName: string
  state: DownloadManagerState
  runner: Runner
}) {
  const sampleSize = 100
  const { t } = useTranslation()
  const [progress] = hasProgress(props.appName, props.runner)
  const writingToDisk = useProgressIsStale(progress, props.state === 'running')
  const writing = (progress.totalBytes ?? 0) > 0
  const reading =
    (progress.readSpeed ?? 0) >= 1 && (progress.diskSpeed ?? 0) < 1
  const [avgSpeed, setAvgDownloadSpeed] = useState<Point[]>(
    Array<Point>(sampleSize).fill({ download: 0, disk: 0 })
  )

  useEffect(() => {
    if (props.state === 'idle') {
      setAvgDownloadSpeed(
        Array<Point>(sampleSize).fill({ download: 0, disk: 0 })
      )
      return
    }

    if (avgSpeed.length > sampleSize - 1) {
      avgSpeed.shift()
    }

    const readRate = progress.readSpeed ?? 0
    const writeRate = progress.diskSpeed ?? 0
    avgSpeed.push({
      download:
        progress.downSpeed && progress.downSpeed > 0
          ? progress.downSpeed
          : (avgSpeed.at(-1)?.download ?? 0),
      disk: readRate >= 1 && writeRate < 1 ? readRate : writeRate
    })

    setAvgDownloadSpeed([...avgSpeed])
  }, [progress, props.state])

  return (
    <>
      <div className="progressHeader">
        <div className="downloadRateStats">
          <div className="downloadRateChart">
            <div
              style={{
                width: '100%',
                height: '100px',
                position: 'absolute',
                top: 0,
                left: 0
              }}
            >
              <ResponsiveContainer height={80}>
                <AreaChart data={avgSpeed} margin={{ top: 0, right: 0 }}>
                  <Area
                    isAnimationActive={false}
                    type="monotone"
                    dataKey="download"
                    strokeWidth="0px"
                    fill="var(--accent)"
                    fillOpacity={0.5}
                  />
                  <Area
                    isAnimationActive={false}
                    type="monotone"
                    dataKey="disk"
                    stroke="var(--primary)"
                    strokeWidth="2px"
                    fillOpacity={0}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="realtimeDownloadStatContainer">
            <h5 className="realtimeDownloadStat">
              {roundToNearestHundredth(avgSpeed.at(-1)?.download)} MB/s
            </h5>
            <div className="realtimeDownloadStatLabel downLabel">
              {t('download-manager.label.speed', 'Download')}{' '}
            </div>
          </div>
          <div className="realtimeDownloadStatContainer">
            <h5 className="realtimeDownloadStat">
              {roundToNearestHundredth(avgSpeed.at(-1)?.disk)} MB/s
            </h5>
            <div className="realtimeDownloadStatLabel diskLabel">
              {reading
                ? t('download-manager.label.read', 'Read')
                : t('download-manager.label.disk', 'Disk')}{' '}
            </div>
          </div>
        </div>
      </div>
      {props.state !== 'idle' && props.appName && (progress.eta || writing) && (
        <div className="downloadBar">
          <div className="downloadProgressStats">
            <p className="downloadStat" color="var(--text-default)">
              {writing
                ? `${(progress.percent ?? 0).toFixed(2)}% ${t(
                    'download-manager.written',
                    'written'
                  )} [${progress.bytes}]`
                : `${progress.percent ?? 0}% [${progress.bytes ?? ''}] `}
            </p>
          </div>
          <Box sx={{ display: 'flex', alignItems: 'baseline' }}>
            <Box sx={{ width: '100%', mr: 1 }}>
              <LinearProgress
                style={{ height: 10 }}
                variant="determinate"
                className="linearProgress"
                value={progress.percent || 0}
              />
            </Box>
            <Box sx={{ minWidth: reading || writingToDisk ? 168 : 35 }}>
              <Typography
                variant="subtitle1"
                sx={{ whiteSpace: 'nowrap' }}
                title={
                  reading
                    ? t(
                        'download-manager.readingHint',
                        'Reading the installed game from disk. The percent moves when that file is written.'
                      )
                    : writingToDisk
                      ? t(
                          'download-manager.writingHint',
                          'Still writing files to disk. That time was only an estimate for the download.'
                        )
                      : t('download-manager.ETA', 'Estimated Time')
                }
              >
                {props.state === 'running'
                  ? reading
                    ? t(
                        'download-manager.readingSpeed',
                        'Reading {{speed}} MB/s',
                        { speed: Math.round(progress.readSpeed ?? 0) }
                      )
                    : writingToDisk
                      ? t('download-manager.writing', 'Writing to disk')
                      : (progress.eta ?? '00:00:00')
                  : 'Paused'}
              </Typography>
            </Box>
          </Box>
        </div>
      )}
    </>
  )
}
