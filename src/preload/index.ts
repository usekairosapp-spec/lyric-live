import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type AppCommand,
  type DisplayInfo,
  type ImportedAudioFile,
  type LiveOverlayPayload,
  type LiveStatePayload,
  type ProjectFileResult,
  type UpdateCheckResult,
  type UpdateInfo,
  type UpdateProgress
} from '@shared/types/ipc'
import type { Project } from '@shared/types/project'
import type { BibleBook, BibleVersionMeta } from '@shared/types/bible'
import type { Playlist, Song, SongSearchResult, SongSummary } from '@shared/types/song'
import type { TranscribedSegment, TranscribeProgress } from '@shared/types/transcribe'
import type { HolyricsImportSongsResult, HolyricsSettings, HolyricsSongSummary } from '@shared/types/holyrics'

const api = {
  project: {
    save: (project: Project, filePath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.projectSave, project, filePath),
    saveAs: (project: Project): Promise<string | null> =>
      ipcRenderer.invoke(IPC.projectSaveAs, project),
    open: (): Promise<ProjectFileResult | null> => ipcRenderer.invoke(IPC.projectOpen)
  },
  media: {
    importAudio: (): Promise<ImportedAudioFile | null> => ipcRenderer.invoke(IPC.mediaImportAudio),
    importVisual: (): Promise<ImportedAudioFile | null> => ipcRenderer.invoke(IPC.mediaImportVisual),
    readFile: (filePath: string): Promise<ArrayBuffer> => ipcRenderer.invoke(IPC.mediaReadFile, filePath)
  },
  live: {
    open: (): Promise<void> => ipcRenderer.invoke(IPC.liveOpen),
    close: (): Promise<void> => ipcRenderer.invoke(IPC.liveClose),
    isOpen: (): Promise<boolean> => ipcRenderer.invoke(IPC.liveIsOpen),
    listDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke(IPC.liveListDisplays),
    moveToDisplay: (displayId: number): Promise<void> =>
      ipcRenderer.invoke(IPC.liveMoveToDisplay, displayId),
    exitFullscreen: (): Promise<void> => ipcRenderer.invoke(IPC.liveExitFullscreen),
    pushState: (payload: LiveStatePayload): void => {
      ipcRenderer.send(IPC.livePushState, payload)
    },
    onState: (callback: (payload: LiveStatePayload) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: LiveStatePayload): void =>
        callback(payload)
      ipcRenderer.on(IPC.liveState, listener)
      return () => ipcRenderer.removeListener(IPC.liveState, listener)
    },
    pushOverlay: (payload: LiveOverlayPayload | null): void => {
      ipcRenderer.send(IPC.livePushOverlay, payload)
    },
    onOverlay: (callback: (payload: LiveOverlayPayload | null) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: LiveOverlayPayload | null): void =>
        callback(payload)
      ipcRenderer.on(IPC.liveOverlay, listener)
      return () => ipcRenderer.removeListener(IPC.liveOverlay, listener)
    }
  },
  bible: {
    listVersions: (): Promise<BibleVersionMeta[]> => ipcRenderer.invoke(IPC.bibleListVersions),
    downloadVersion: (versionId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.bibleDownloadVersion, versionId),
    readVersion: (versionId: string): Promise<BibleBook[]> =>
      ipcRenderer.invoke(IPC.bibleReadVersion, versionId),
    importVersion: (versionId: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.bibleImportVersion, versionId),
    deleteVersion: (versionId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.bibleDeleteVersion, versionId)
  },
  holyrics: {
    getSettings: (): Promise<HolyricsSettings | null> => ipcRenderer.invoke(IPC.holyricsGetSettings),
    saveSettings: (settings: HolyricsSettings): Promise<void> =>
      ipcRenderer.invoke(IPC.holyricsSaveSettings, settings),
    testConnection: (settings: HolyricsSettings): Promise<void> =>
      ipcRenderer.invoke(IPC.holyricsTestConnection, settings),
    listSongs: (settings: HolyricsSettings): Promise<HolyricsSongSummary[]> =>
      ipcRenderer.invoke(IPC.holyricsListSongs, settings),
    importSongs: (settings: HolyricsSettings, ids: string[]): Promise<HolyricsImportSongsResult> =>
      ipcRenderer.invoke(IPC.holyricsImportSongs, settings, ids)
  },
  fonts: {
    list: (): Promise<string[]> => ipcRenderer.invoke(IPC.fontsList)
  },
  app: {
    onCommand: (callback: (command: AppCommand) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, command: AppCommand): void => callback(command)
      ipcRenderer.on(IPC.appCommand, listener)
      return () => ipcRenderer.removeListener(IPC.appCommand, listener)
    }
  },
  update: {
    check: (): Promise<UpdateCheckResult> => ipcRenderer.invoke(IPC.updateCheck),
    download: (): Promise<void> => ipcRenderer.invoke(IPC.updateDownload),
    install: (): Promise<void> => ipcRenderer.invoke(IPC.updateInstall),
    openPage: (): Promise<void> => ipcRenderer.invoke(IPC.updateOpenPage),
    onAvailable: (callback: (info: UpdateInfo) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, info: UpdateInfo): void => callback(info)
      ipcRenderer.on(IPC.updateAvailable, listener)
      return () => ipcRenderer.removeListener(IPC.updateAvailable, listener)
    },
    onProgress: (callback: (p: UpdateProgress) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, p: UpdateProgress): void => callback(p)
      ipcRenderer.on(IPC.updateProgress, listener)
      return () => ipcRenderer.removeListener(IPC.updateProgress, listener)
    }
  },
  transcribe: {
    run: (audio: Float32Array): Promise<TranscribedSegment[]> => ipcRenderer.invoke(IPC.transcribeRun, audio),
    onProgress: (callback: (p: TranscribeProgress) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, p: TranscribeProgress): void => callback(p)
      ipcRenderer.on(IPC.transcribeProgress, listener)
      return () => ipcRenderer.removeListener(IPC.transcribeProgress, listener)
    }
  },
  playlist: {
    get: (): Promise<Playlist> => ipcRenderer.invoke(IPC.playlistGet),
    save: (playlist: Playlist): Promise<void> => ipcRenderer.invoke(IPC.playlistSave, playlist)
  },
  song: {
    list: (): Promise<SongSummary[]> => ipcRenderer.invoke(IPC.songList),
    save: (song: Song): Promise<void> => ipcRenderer.invoke(IPC.songSave, song),
    read: (id: string): Promise<Song> => ipcRenderer.invoke(IPC.songRead, id),
    delete: (id: string): Promise<void> => ipcRenderer.invoke(IPC.songDelete, id),
    searchOnline: (query: string): Promise<SongSearchResult[]> =>
      ipcRenderer.invoke(IPC.songSearchOnline, query),
    fetchLyrics: (artist: string, title: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.songFetchLyrics, artist, title)
  }
}

export type PresenterApi = typeof api

contextBridge.exposeInMainWorld('api', api)
