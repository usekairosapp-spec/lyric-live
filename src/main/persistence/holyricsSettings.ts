import { promises as fs } from 'node:fs'
import { app } from 'electron'
import { join } from 'node:path'
import type { HolyricsSettings } from '@shared/types/holyrics'

function settingsPath(): string {
  return join(app.getPath('userData'), 'holyrics.json')
}

export async function readHolyricsSettings(): Promise<HolyricsSettings | null> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf-8')
    return JSON.parse(raw) as HolyricsSettings
  } catch {
    return null
  }
}

export async function saveHolyricsSettings(settings: HolyricsSettings): Promise<void> {
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}
