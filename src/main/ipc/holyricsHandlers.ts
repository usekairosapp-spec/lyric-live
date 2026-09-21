import { ipcMain } from 'electron'
import { IPC } from '@shared/types/ipc'
import type { HolyricsSettings } from '@shared/types/holyrics'
import { readHolyricsSettings, saveHolyricsSettings } from '../persistence/holyricsSettings'
import { importHolyricsSongs, listHolyricsSongs, testHolyricsConnection } from '../persistence/holyricsImport'

export function registerHolyricsHandlers(): void {
  ipcMain.handle(IPC.holyricsGetSettings, () => readHolyricsSettings())
  ipcMain.handle(IPC.holyricsSaveSettings, (_event, settings: HolyricsSettings) => saveHolyricsSettings(settings))
  ipcMain.handle(IPC.holyricsTestConnection, (_event, settings: HolyricsSettings) => testHolyricsConnection(settings))
  ipcMain.handle(IPC.holyricsListSongs, (_event, settings: HolyricsSettings) => listHolyricsSongs(settings))
  ipcMain.handle(IPC.holyricsImportSongs, (_event, settings: HolyricsSettings, ids: string[]) =>
    importHolyricsSongs(settings, ids)
  )
}
