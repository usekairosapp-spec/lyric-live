import { nanoid } from 'nanoid'
import type { HolyricsSettings, HolyricsSongSummary, HolyricsImportSongsResult } from '@shared/types/holyrics'
import type { Song } from '@shared/types/song'
import { callHolyrics } from './holyricsClient'
import { saveSong } from './songLibrary'

export async function testHolyricsConnection(settings: HolyricsSettings): Promise<void> {
  await callHolyrics(settings, 'GetCommunicationPanelInfo')
}

interface HolyricsSongRaw {
  id: string | number
  title?: string
  artist?: string
  author?: string
  /** Cada slide já é um bloco pronto (mesmas quebras de linha internas usadas no Holyrics). */
  slides?: Array<{ text?: string }>
}

export async function listHolyricsSongs(settings: HolyricsSettings): Promise<HolyricsSongSummary[]> {
  const data = await callHolyrics<HolyricsSongRaw[]>(settings, 'GetSongs', { fields: 'id,title,artist' })
  return (data ?? [])
    .filter((s) => s.title)
    .map((s) => ({ id: String(s.id), title: s.title ?? '', artist: s.artist ?? '' }))
}

export async function importHolyricsSongs(
  settings: HolyricsSettings,
  ids: string[]
): Promise<HolyricsImportSongsResult> {
  let imported = 0
  const failed: string[] = []
  for (const id of ids) {
    try {
      const raw = await callHolyrics<HolyricsSongRaw>(settings, 'GetLyrics', {
        id,
        fields: 'id,title,artist,author,slides'
      })
      const blocks = (raw.slides ?? []).map((s) => (s.text ?? '').trim()).filter(Boolean)
      if (!raw.title || blocks.length === 0) throw new Error('música sem letra')
      const song: Song = {
        id: nanoid(),
        title: raw.title,
        artist: raw.artist || 'Desconhecido',
        author: raw.author || undefined,
        blocks,
        createdAt: Date.now()
      }
      await saveSong(song)
      imported++
    } catch {
      failed.push(id)
    }
  }
  return { imported, failed }
}
