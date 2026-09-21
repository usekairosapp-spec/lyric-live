import { useEffect, useMemo, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import type { Playlist, Song, SongSummary, SlideFx, WordFontStyle } from '@shared/types/song'
import type { EffectId } from '@shared/types/project'
import { splitIntoBlocks } from '@shared/lib/songBlocks'
import { SongSearchOnlineModal } from './SongSearchOnlineModal'
import { HolyricsImportModal } from './HolyricsImportModal'
import { LiveToggleButton } from '../common/LiveToggleButton'
import { PhraseComposerModal } from '../preview/PhraseComposerModal'
import { LiveTextOverlay, PhraseStage, type ItemEdit } from '../preview/LiveTextOverlay'
import { EffectPicker } from '../preview/EffectPicker'
import { FontPicker } from '../common/FontPicker'
import { Icon } from '../common/Icon'
import type { LiveOverlayPayload } from '@shared/types/ipc'
import type { PhraseLayout } from '@shared/types/phrase'

type Mode = 'list' | 'create' | 'reading'

interface DraftSong {
  title: string
  artist: string
  author: string
  lyrics: string
}

const EMPTY_DRAFT: DraftSong = { title: '', artist: '', author: '', lyrics: '' }

const FX_MODE_KEY = 'lyriclive.fxMode'

function loadManualFx(): boolean {
  try {
    return localStorage.getItem(FX_MODE_KEY) !== 'auto'
  } catch {
    return true
  }
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = list.filter((_, idx) => idx !== from)
  next.splice(to, 0, list[from])
  return next
}

export function SongBrowserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [songs, setSongs] = useState<SongSummary[] | null>(null)
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<Mode>('list')
  const [draft, setDraft] = useState<DraftSong>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [onlineSearchOpen, setOnlineSearchOpen] = useState(false)
  const [holyricsImportOpen, setHolyricsImportOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  /** O clique numa palavra do slide destaca (brilho) ou seleciona pra trocar a fonte dela. */
  const [wordMode, setWordMode] = useState<'highlight' | 'font'>('highlight')
  const [fontWord, setFontWord] = useState<number | null>(null)
  /** Palavra selecionada no modo "Destacar" (pra dar um efeito só nela). */
  const [effectWord, setEffectWord] = useState<number | null>(null)
  /** O que está sendo mandado pro LIVE agora — alimenta a janela de prévia. */
  const [preview, setPreview] = useState<LiveOverlayPayload | null>(null)
  /** Manual: escolher efeito só monta a prévia; no telão vai o texto simples até eu disparar. */
  const [manualFx, setManualFx] = useState(loadManualFx)
  /** No modo manual: o telão está mostrando o slide com efeito (foi disparado)? */
  const [fxOnScreen, setFxOnScreen] = useState(false)
  /** Telão apagado (Esc): nada é reenviado até eu clicar num slide de novo. */
  const [liveBlank, setLiveBlank] = useState(true)
  /** Palavra da frase selecionada na prévia (alças de mover/redimensionar/girar). */
  const [phraseSel, setPhraseSel] = useState<number | null>(null)
  const songRef = useRef<Song | null>(null)
  const fontSaveRef = useRef<number | undefined>(undefined)
  /** Escolher um efeito de entrada vale só pra este slide ou pra todos de uma vez. */
  const [effectScope, setEffectScope] = useState<'one' | 'all'>('one')

  /** Playlist do culto: ordem das músicas e qual está tocando (salva em arquivo). */
  const [playlist, setPlaylist] = useState<Playlist>({ entries: [], currentUid: null })
  const [plDrag, setPlDrag] = useState<number | null>(null)
  const [plDropAt, setPlDropAt] = useState<number | null>(null)
  /** Música da biblioteca sendo arrastada pra playlist, e se o cursor está sobre a área da playlist. */
  const [libDrag, setLibDrag] = useState<string | null>(null)
  const [plOver, setPlOver] = useState(false)

  const [selectedSong, setSelectedSong] = useState<Song | null>(null)
  const [blockIndex, setBlockIndex] = useState(0)
  const loadingSongRef = useRef<string | null>(null)
  const overlayKeyRef = useRef(0)
  const blockRefs = useRef<(HTMLDivElement | null)[]>([])
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [editIsNew, setEditIsNew] = useState(false)
  /** Arrastar slide pra reordenar: quem está sendo arrastado e o vão (0..n) onde vai cair. */
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)

  const refreshSongs = (): void => {
    window.api?.song.list().then(setSongs)
  }

  const updatePlaylist = (next: Playlist): void => {
    setPlaylist(next)
    window.api?.playlist.save(next)
  }

  const addToPlaylist = (songId: string): void =>
    updatePlaylist({ ...playlist, entries: [...playlist.entries, { uid: nanoid(), songId }] })

  const addToPlaylistAt = (songId: string, at: number): void => {
    const entries = [...playlist.entries]
    entries.splice(Math.min(Math.max(0, at), entries.length), 0, { uid: nanoid(), songId })
    updatePlaylist({ ...playlist, entries })
  }

  /** Solta algo na playlist: música da biblioteca entra no vão; item da playlist muda de lugar. */
  const dropOnPlaylist = (at: number): void => {
    if (libDrag) addToPlaylistAt(libDrag, at)
    else if (plDrag !== null) moveEntry(plDrag, at > plDrag ? at - 1 : at)
    setLibDrag(null)
    setPlDrag(null)
    setPlDropAt(null)
    setPlOver(false)
  }

  const removeFromPlaylist = (uid: string): void =>
    updatePlaylist({
      entries: playlist.entries.filter((e) => e.uid !== uid),
      currentUid: playlist.currentUid === uid ? null : playlist.currentUid
    })

  const moveEntry = (from: number, to: number): void => {
    if (to < 0 || to >= playlist.entries.length || from === to) return
    updatePlaylist({ ...playlist, entries: moveItem(playlist.entries, from, to) })
  }

  const clearPlaylist = (): void => {
    if (playlist.entries.length === 0) return
    if (window.confirm('Limpar toda a playlist do culto?')) updatePlaylist({ entries: [], currentUid: null })
  }

  const songTitle = (songId: string): SongSummary | undefined => songs?.find((x) => x.id === songId)

  const currentIndex = playlist.entries.findIndex((e) => e.uid === playlist.currentUid)
  const nextEntry = playlist.entries[currentIndex + 1] ?? (currentIndex === -1 ? playlist.entries[0] : undefined)

  const playEntry = (uid: string): void => {
    const entry = playlist.entries.find((e) => e.uid === uid)
    if (!entry) return
    setPlaylist({ ...playlist, currentUid: uid })
    window.api?.playlist.save({ ...playlist, currentUid: uid })
    openReading(entry.songId)
  }

  useEffect(() => {
    if (!open) return
    refreshSongs()
    window.api?.playlist.get().then(setPlaylist)
  }, [open])

  useEffect(() => {
    if (!open) {
      setMode('list')
      setSelectedSong(null)
      setOnlineSearchOpen(false)
      setHolyricsImportOpen(false)
      window.api?.live.pushOverlay(null)
    }
  }, [open])

  const filteredSongs = useMemo(() => {
    if (!songs) return []
    const q = query.trim().toLowerCase()
    if (!q) return songs
    return songs.filter((s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q))
  }, [songs, query])

  const changeFxMode = (manual: boolean): void => {
    setManualFx(manual)
    try {
      localStorage.setItem(FX_MODE_KEY, manual ? 'manual' : 'auto')
    } catch {
      // sem armazenamento: vale só nesta sessão
    }
  }

  /** Slide + efeito/destaques dele, do jeito que iria pro telão. `replay` refaz a animação de entrada. */
  const buildPayload = (song: Song, index: number, replay: boolean): LiveOverlayPayload | null => {
    const text = song.blocks[index]
    if (text === undefined) return null
    const fx = song.blockFx?.[index]
    if (replay) overlayKeyRef.current = Date.now()
    return {
      text,
      reference: '',
      effect: fx?.effect ?? null,
      highlights: fx?.highlights ?? [],
      wordStyles: fx?.wordStyles,
      wordEffects: fx?.wordEffects,
      phrase: fx?.phrase ?? null,
      fontScale: song.fontScale,
      key: overlayKeyRef.current
    }
  }

  /** O slide sem nenhum efeito (é o que o telão mostra até eu disparar, no modo manual). */
  const plainOf = (payload: LiveOverlayPayload): LiveOverlayPayload => ({
    text: payload.text,
    reference: '',
    effect: null,
    highlights: [],
    phrase: null,
    fontScale: payload.fontScale,
    key: payload.key
  })

  /** Manda o slide pro LIVE. No modo manual, só o texto simples vai pro telão (o efeito completo
   * aparece na prévia) e o efeito entra quando `fire` for true, ou seja, quando eu disparar. */
  const pushBlock = (song: Song, index: number, replay = true, fire = false): void => {
    const payload = buildPayload(song, index, replay)
    if (!payload) return
    setPreview(payload)
    setLiveBlank(false)
    if (manualFx && !fire) {
      setFxOnScreen(false)
      window.api?.live.pushOverlay(plainOf(payload))
      return
    }
    setFxOnScreen(fire)
    window.api?.live.pushOverlay(payload)
  }

  /** Modo manual: mostra o efeito só na prévia, sem tocar no que está no telão. */
  const stageBlock = (song: Song, index: number, replay: boolean): void => {
    const payload = buildPayload(song, index, replay)
    if (payload) setPreview(payload)
  }

  /** Ajuste manual de uma palavra da frase direto na prévia: atualiza na hora (prévia e, se o
   * efeito já está no telão ou o modo é automático, o telão também) e grava ao soltar o mouse. */
  const editPhraseItem = (index: number, edit: ItemEdit & { text?: string }): void => {
    const song = songRef.current
    const fx = song?.blockFx?.[blockIndex]
    if (!song || !fx?.phrase) return
    const phrase = {
      ...fx.phrase,
      items: fx.phrase.items.map((it, k) => (k === index ? { ...it, ...edit } : it))
    }
    const blockFx = song.blocks.map((_, idx) => (idx === blockIndex ? { ...fx, phrase } : song.blockFx?.[idx] ?? null))
    const updated: Song = { ...song, blockFx }
    songRef.current = updated
    setSelectedSong(updated)
    const payload = buildPayload(updated, blockIndex, false)
    if (!payload) return
    setPreview(payload)
    if (!liveBlank && (!manualFx || fxOnScreen)) window.api?.live.pushOverlay(payload)
  }

  /** Aplica o estilo de frase em todos os slides: o atual fica como está, os outros são refeitos com o texto deles. */
  const applyPhraseToAll = async (build: (text: string) => PhraseLayout, current: PhraseLayout): Promise<void> => {
    if (!selectedSong) return
    const total = selectedSong.blocks.length
    if (total > 1 && !window.confirm(`Aplicar este estilo de frase em todos os ${total} slides? O estilo de frase dos outros slides será trocado.`))
      return
    const newFx = selectedSong.blocks.map((text, idx) => {
      const base: SlideFx = selectedSong.blockFx?.[idx] ?? { effect: null, highlights: [] }
      const layout = idx === blockIndex ? current : build(text.replace(/\s*\n\s*/g, ' ').trim())
      return layout.items.length > 0 ? { ...base, phrase: layout } : (selectedSong.blockFx?.[idx] ?? null)
    })
    const updated = await persistBlocks(selectedSong, selectedSong.blocks, newFx)
    if (manualFx) stageBlock(updated, blockIndex, true)
    else pushBlock(updated, blockIndex, true)
  }

  const savePhraseEdit = (): void => {
    if (songRef.current) window.api?.song.save(songRef.current)
  }

  const fireFx = (): void => {
    if (selectedSong) pushBlock(selectedSong, blockIndex, true, true)
  }

  const openReading = async (id: string): Promise<void> => {
    if (!window.api) return
    loadingSongRef.current = id
    const song = await window.api.song.read(id)
    if (loadingSongRef.current !== id) return
    // re-divide em blocos de 2 linhas (músicas salvas antes tinham blocos maiores)
    const newBlocks = splitIntoBlocks(song.blocks.join('\n\n'))
    const blockFx =
      song.blockFx && song.blockFx.length === newBlocks.length ? song.blockFx : newBlocks.map(() => null)
    const normalized: Song = { ...song, blocks: newBlocks, blockFx }
    setSelectedSong(normalized)
    setBlockIndex(0)
    setMode('reading')
    // o telão continua com o que já estava: o slide só vai pra lá quando eu clicar nele
    setFxOnScreen(false)
    stageBlock(normalized, 0, true)
  }

  /** Volta pra biblioteca sem mexer no telão (dá pra escolher a próxima música com a letra no ar). */
  const exitReading = (): void => {
    setPreview(null)
    setMode('list')
    setSelectedSong(null)
  }

  /** Esc: apaga o telão e continua aqui, pronto pra próxima música. */
  const blankLive = (): void => {
    setLiveBlank(true)
    setFxOnScreen(false)
    window.api?.live.pushOverlay(null)
  }

  const stepBlock = (direction: 1 | -1): void => {
    if (!selectedSong) return
    const next = blockIndex + direction
    if (next < 0 || next >= selectedSong.blocks.length) return
    setBlockIndex(next)
    pushBlock(selectedSong, next)
  }

  /** Grava a lista de blocos editada (texto, novo slide, exclusão) na música salva. */
  const persistBlocks = async (
    song: Song,
    newBlocks: string[],
    newFx: (SlideFx | null)[] = song.blockFx ?? newBlocks.map(() => null)
  ): Promise<Song> => {
    const updated: Song = { ...song, blocks: newBlocks, blockFx: newFx }
    setSelectedSong(updated)
    await window.api?.song.save(updated)
    return updated
  }

  const startEdit = (i: number, isNew = false): void => {
    if (!selectedSong) return
    setBlockIndex(i)
    setEditingIndex(i)
    setEditIsNew(isNew)
    setEditText(isNew ? '' : selectedSong.blocks[i])
  }

  const cancelEdit = (): void => {
    if (editingIndex === null || !selectedSong) return
    // slide novo cancelado sem texto: descarta (nada foi salvo ainda)
    if (editIsNew) {
      const remaining = selectedSong.blocks.filter((_, idx) => idx !== editingIndex)
      const remainingFx = (selectedSong.blockFx ?? []).filter((_, idx) => idx !== editingIndex)
      setSelectedSong({ ...selectedSong, blocks: remaining, blockFx: remainingFx })
      setBlockIndex(Math.max(0, Math.min(editingIndex - 1, remaining.length - 1)))
    }
    setEditingIndex(null)
    setEditIsNew(false)
  }

  const commitEdit = async (): Promise<void> => {
    if (editingIndex === null || !selectedSong) return
    const text = editText
      .split('\n')
      .map((l) => l.trim())
      .join('\n')
      .trim()
    const index = editingIndex
    setEditingIndex(null)
    setEditIsNew(false)
    if (!text) {
      if (editIsNew) cancelEditNew(index)
      else await deleteBlock(index)
      return
    }
    const newBlocks = selectedSong.blocks.map((b, idx) => (idx === index ? text : b))
    // palavras mudaram de lugar: mantém o efeito do slide, limpa os destaques
    const newFx = (selectedSong.blockFx ?? newBlocks.map(() => null)).map((fx, idx) =>
      idx === index && fx ? { ...fx, highlights: [], wordStyles: undefined, wordEffects: undefined, phrase: null } : fx
    )
    const updated = await persistBlocks(selectedSong, newBlocks, newFx)
    pushBlock(updated, index)
  }

  /** Salva o texto em edição e já abre um slide novo, vazio, logo depois dele. */
  const commitAndAddNext = async (): Promise<void> => {
    if (editingIndex === null || !selectedSong) return
    const text = editText
      .split('\n')
      .map((l) => l.trim())
      .join('\n')
      .trim()
    if (!text) return
    const index = editingIndex
    const newBlocks = selectedSong.blocks.map((b, idx) => (idx === index ? text : b))
    const fx = selectedSong.blockFx ?? newBlocks.map(() => null)
    const savedFx = fx.map((f, idx) => (idx === index && f ? { ...f, highlights: [], wordStyles: undefined, wordEffects: undefined, phrase: null } : f))
    const saved = await persistBlocks(selectedSong, newBlocks, savedFx)

    const at = index + 1
    setSelectedSong({
      ...saved,
      blocks: [...saved.blocks.slice(0, at), '', ...saved.blocks.slice(at)],
      blockFx: [...(saved.blockFx ?? []).slice(0, at), null, ...(saved.blockFx ?? []).slice(at)]
    })
    setBlockIndex(at)
    setEditingIndex(at)
    setEditIsNew(true)
    setEditText('')
  }

  const cancelEditNew = (index: number): void => {
    if (!selectedSong) return
    const remaining = selectedSong.blocks.filter((_, idx) => idx !== index)
    const remainingFx = (selectedSong.blockFx ?? []).filter((_, idx) => idx !== index)
    setSelectedSong({ ...selectedSong, blocks: remaining, blockFx: remainingFx })
    setBlockIndex(Math.max(0, Math.min(index - 1, remaining.length - 1)))
  }

  const deleteBlock = async (i: number): Promise<void> => {
    if (!selectedSong || selectedSong.blocks.length <= 1) return
    const newBlocks = selectedSong.blocks.filter((_, idx) => idx !== i)
    const newFx = (selectedSong.blockFx ?? []).filter((_, idx) => idx !== i)
    const nextIndex = Math.min(i, newBlocks.length - 1)
    const updated = await persistBlocks(selectedSong, newBlocks, newFx)
    setBlockIndex(nextIndex)
    pushBlock(updated, nextIndex)
  }

  const addBlock = (): void => {
    if (!selectedSong) return
    const at = blockIndex + 1
    const newBlocks = [...selectedSong.blocks.slice(0, at), '', ...selectedSong.blocks.slice(at)]
    const fx = selectedSong.blockFx ?? selectedSong.blocks.map(() => null)
    const newFx = [...fx.slice(0, at), null, ...fx.slice(at)]
    setSelectedSong({ ...selectedSong, blocks: newBlocks, blockFx: newFx })
    startEdit(at, true)
  }

  /** Move o slide `from` pro vão `gap` (0..n = posição ANTES desse índice na lista original),
   * levando junto o efeito dele. O slide que está no LIVE continua o mesmo — só muda de
   * posição —, então nada é reenviado pro projetor. */
  const moveBlock = async (from: number, gap: number): Promise<void> => {
    if (!selectedSong) return
    const to = gap > from ? gap - 1 : gap
    if (to === from) return
    const fx = selectedSong.blocks.map((_, idx) => selectedSong.blockFx?.[idx] ?? null)
    let nextSelected = blockIndex
    if (blockIndex === from) nextSelected = to
    else if (from < blockIndex && to >= blockIndex) nextSelected = blockIndex - 1
    else if (from > blockIndex && to <= blockIndex) nextSelected = blockIndex + 1
    setBlockIndex(nextSelected)
    await persistBlocks(selectedSong, moveItem(selectedSong.blocks, from, to), moveItem(fx, from, to))
  }

  const endDrag = (): void => {
    setDragIndex(null)
    setDropAt(null)
  }

  /** Atualiza efeito/destaques do slide atual, salva na música e manda pro LIVE. */
  const updateSlideFx = async (patch: Partial<SlideFx>, replay: boolean): Promise<void> => {
    if (!selectedSong) return
    const fxList = selectedSong.blockFx ?? selectedSong.blocks.map(() => null)
    const current: SlideFx = fxList[blockIndex] ?? { effect: null, highlights: [] }
    const next: SlideFx = { ...current, ...patch }
    const hasWordStyles =
      Object.keys(next.wordStyles ?? {}).length > 0 || Object.keys(next.wordEffects ?? {}).length > 0
    const cleaned = next.effect === null && next.highlights.length === 0 && !next.phrase && !hasWordStyles ? null : next
    const newFx = fxList.map((fx, idx) => (idx === blockIndex ? cleaned : fx))
    const updated = await persistBlocks(selectedSong, selectedSong.blocks, newFx)
    if (manualFx) stageBlock(updated, blockIndex, replay)
    else pushBlock(updated, blockIndex, replay)
  }

  /** Tamanho da letra da música toda (50–200%): atualiza prévia e telão na hora e grava. */
  const setFontScale = (pct: number): void => {
    const song = songRef.current
    if (!song) return
    const value = Math.min(200, Math.max(50, Math.round(pct)))
    const updated: Song = { ...song, fontScale: value === 100 ? undefined : value / 100 }
    songRef.current = updated
    setSelectedSong(updated)
    const payload = buildPayload(updated, blockIndex, false)
    if (payload) {
      setPreview(payload)
      if (!liveBlank) window.api?.live.pushOverlay(manualFx && !fxOnScreen ? plainOf(payload) : payload)
    }
    window.clearTimeout(fontSaveRef.current)
    fontSaveRef.current = window.setTimeout(() => {
      const latest = songRef.current ?? updated
      window.api?.song.save(latest)
    }, 400)
  }

  /** Define o efeito de entrada de todos os slides da música (não mexe nos destaques/fontes deles).
   * Sem `effect`, copia o do slide atual e pergunta antes de trocar os que já têm outro. */
  const applyEffectToAll = async (chosen?: SlideFx['effect']): Promise<void> => {
    if (!selectedSong) return
    const explicit = chosen !== undefined
    const effect = explicit ? chosen : (selectedSong.blockFx?.[blockIndex]?.effect ?? null)
    const fxList = selectedSong.blocks.map((_, idx) => selectedSong.blockFx?.[idx] ?? null)
    const others = fxList.filter((fx, idx) => idx !== blockIndex && (fx?.effect ?? null) !== effect)
    if (!explicit && others.length > 0) {
      const what = effect ? 'este efeito' : 'sem efeito'
      if (!window.confirm(`Aplicar ${what} em todos os ${fxList.length} slides? Os efeitos de entrada dos outros slides serão trocados.`))
        return
    }
    const newFx = fxList.map((fx) => {
      const next: SlideFx = { ...(fx ?? { effect: null, highlights: [] }), effect }
      const hasWordStyles =
        Object.keys(next.wordStyles ?? {}).length > 0 || Object.keys(next.wordEffects ?? {}).length > 0
      return next.effect === null && next.highlights.length === 0 && !next.phrase && !hasWordStyles ? null : next
    })
    const updated = await persistBlocks(selectedSong, selectedSong.blocks, newFx)
    // escolhendo o efeito direto (modo "todos"), o slide atual já toca pra eu ver
    if (explicit) {
      if (manualFx) stageBlock(updated, blockIndex, true)
      else pushBlock(updated, blockIndex, true)
    }
  }

  const setWordStyle = (wordIdx: number, patch: Partial<WordFontStyle> | null): void => {
    const current = selectedSong?.blockFx?.[blockIndex]?.wordStyles ?? {}
    const next = { ...current }
    if (patch === null) delete next[wordIdx]
    else {
      const merged = { ...next[wordIdx], ...patch }
      // sem nenhum ajuste sobrando, tira a palavra da lista
      if (Object.values(merged).every((v) => v === undefined)) delete next[wordIdx]
      else next[wordIdx] = merged
    }
    updateSlideFx({ wordStyles: next }, false)
  }

  const setWordEffect = (wordIdx: number, effect: EffectId | null): void => {
    const next = { ...(selectedSong?.blockFx?.[blockIndex]?.wordEffects ?? {}) }
    if (effect === null) delete next[wordIdx]
    else next[wordIdx] = effect
    // replay: pra ver o efeito da palavra tocando
    updateSlideFx({ wordEffects: next }, true)
  }

  /** Tira o brilho e o efeito de uma palavra de uma vez (des-seleciona). */
  const clearWord = (wordIdx: number): void => {
    const fx = selectedSong?.blockFx?.[blockIndex]
    const hadEffect = Boolean(fx?.wordEffects?.[wordIdx])
    const effects = { ...(fx?.wordEffects ?? {}) }
    delete effects[wordIdx]
    updateSlideFx(
      { highlights: (fx?.highlights ?? []).filter((w) => w !== wordIdx), wordEffects: effects },
      hadEffect
    )
    setEffectWord(null)
  }

  const toggleHighlight = (wordIdx: number): void => {
    const current = selectedSong?.blockFx?.[blockIndex]?.highlights ?? []
    const next = current.includes(wordIdx) ? current.filter((w) => w !== wordIdx) : [...current, wordIdx].sort((a, b) => a - b)
    updateSlideFx({ highlights: next }, false)
  }

  const handleDelete = async (id: string, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    if (!window.api) return
    await window.api.song.delete(id)
    updatePlaylist({
      entries: playlist.entries.filter((en) => en.songId !== id),
      currentUid: playlist.entries.find((en) => en.uid === playlist.currentUid)?.songId === id ? null : playlist.currentUid
    })
    refreshSongs()
  }

  const handleSaveDraft = async (): Promise<void> => {
    if (!window.api || !draft.title.trim() || !draft.lyrics.trim()) return
    setSaving(true)
    try {
      const song: Song = {
        id: nanoid(),
        title: draft.title.trim(),
        artist: draft.artist.trim() || 'Desconhecido',
        author: draft.author.trim() || undefined,
        blocks: splitIntoBlocks(draft.lyrics),
        createdAt: Date.now()
      }
      await window.api.song.save(song)
      setDraft(EMPTY_DRAFT)
      setMode('list')
      refreshSongs()
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (mode === 'reading') blockRefs.current[blockIndex]?.scrollIntoView({ block: 'nearest' })
  }, [mode, blockIndex])

  useEffect(() => {
    setPhraseSel(null)
  }, [blockIndex])

  useEffect(() => {
    if (!open) return

    const onKeyDown = (e: KeyboardEvent): void => {
      if (editingIndex !== null) {
        if (e.key === 'Escape') {
          e.preventDefault()
          if (editIsNew && !editText.trim()) cancelEdit()
          else setEditingIndex(null)
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          if (e.shiftKey) commitAndAddNext()
          else commitEdit()
        }
        return
      }

      if (mode === 'reading' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault()
        stepBlock(e.key === 'ArrowRight' ? 1 : -1)
        return
      }

      const tag = (e.target as HTMLElement | null)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      if (mode === 'reading' && manualFx && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        fireFx()
        return
      }

      if (mode === 'reading' && e.key === 'Enter') {
        e.preventDefault()
        startEdit(blockIndex)
        return
      }

      if (composerOpen) return

      if (e.key === 'Escape') {
        e.preventDefault()
        if (onlineSearchOpen) setOnlineSearchOpen(false)
        else if (holyricsImportOpen) setHolyricsImportOpen(false)
        else if (mode === 'reading') blankLive()
        else if (mode === 'create') setMode('list')
        else onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, onlineSearchOpen, holyricsImportOpen, blockIndex, selectedSong, onClose, editingIndex, editText, editIsNew, composerOpen, manualFx])

  songRef.current = selectedSong

  if (!open) return null

  const blocks = selectedSong?.blocks ?? []
  const slideWords = (blocks[blockIndex] ?? '').split(/\s+/).filter(Boolean)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="relative flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-surface-800 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
            <Icon name="music" size={16} className="text-neutral-400" />
            <span>
              {mode === 'create' ? 'Nova música' : mode === 'reading' ? selectedSong?.title : 'Músicas'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <LiveToggleButton />
            <button onClick={onClose} className="icon-btn h-8 w-8 text-lg" title="Fechar">
              ×
            </button>
          </div>
        </div>

        {mode === 'list' && (
          <div className="flex flex-1 overflow-hidden">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-2 border-b border-surface-800 px-4 py-3">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Pesquisar na sua biblioteca..."
                  className="field-input flex-1"
                />
                <button
                  onClick={() => setOnlineSearchOpen(true)}
                  className="rounded-md border border-surface-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-surface-800"
                >
                  Pesquisar na internet
                </button>
                <button
                  onClick={() => setHolyricsImportOpen(true)}
                  className="rounded-md border border-surface-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-surface-800"
                >
                  Importar do Holyrics
                </button>
                <button
                  onClick={() => {
                    setDraft(EMPTY_DRAFT)
                    setNotice(null)
                    setMode('create')
                  }}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
                >
                  + Nova música
                </button>
              </div>

              <div className="flex-1 overflow-y-scroll p-2">
                {!songs ? (
                  <div className="flex h-full items-center justify-center text-sm text-neutral-600">
                    {window.api ? 'Carregando…' : 'API do Electron indisponível neste ambiente.'}
                  </div>
                ) : filteredSongs.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-neutral-600">
                    Nenhuma música salva ainda.
                  </div>
                ) : (
                  filteredSongs.map((s) => (
                    <div
                      key={s.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'copyMove'
                        e.dataTransfer.setData('text/plain', s.id)
                        setLibDrag(s.id)
                      }}
                      onDragEnd={() => {
                        setLibDrag(null)
                        setPlDropAt(null)
                        setPlOver(false)
                      }}
                      title="Arraste para a playlist do culto"
                      className={`group flex w-full cursor-grab items-center gap-1 rounded-md pr-2 hover:bg-surface-800 ${
                        libDrag === s.id ? 'opacity-50' : ''
                      }`}
                    >
                      <button onClick={() => openReading(s.id)} className="min-w-0 flex-1 px-3 py-2.5 text-left">
                        <div className="truncate text-sm text-neutral-100">{s.title}</div>
                        <div className="truncate text-xs text-neutral-500">{s.artist}</div>
                      </button>
                      <button
                        onClick={() => addToPlaylist(s.id)}
                        title="Adicionar à playlist do culto"
                        className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-surface-700 px-2 text-xs text-neutral-300 hover:border-accent hover:text-neutral-100"
                      >
                        <Icon name="plus" size={12} />
                        Culto
                      </button>
                      <button
                        onClick={(e) => handleDelete(s.id, e)}
                        title="Excluir da biblioteca"
                        className="icon-btn h-7 w-7 shrink-0 opacity-50 hover:!opacity-100"
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <aside
              onDragOver={(e) => {
                if (libDrag === null && plDrag === null) return
                e.preventDefault()
                setPlOver(true)
                // fora de qualquer item: cai no fim da lista
                if (!(e.target as HTMLElement).closest('[data-pl-row]')) setPlDropAt(playlist.entries.length)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setPlOver(false)
                  setPlDropAt(null)
                }
              }}
              onDrop={(e) => {
                e.preventDefault()
                dropOnPlaylist(plDropAt ?? playlist.entries.length)
              }}
              className={`flex w-[340px] shrink-0 flex-col border-l bg-surface-950/40 transition-colors ${
                plOver && libDrag ? 'border-accent bg-accent/10' : 'border-surface-800'
              }`}
            >
              <div className="flex items-center justify-between border-b border-surface-800 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
                  <Icon name="list" size={15} className="text-neutral-400" />
                  Culto
                  <span className="text-xs font-normal text-neutral-500">
                    {playlist.entries.length} {playlist.entries.length === 1 ? 'música' : 'músicas'}
                  </span>
                </div>
                <button
                  onClick={clearPlaylist}
                  disabled={playlist.entries.length === 0}
                  className="rounded-md px-2 py-1 text-[11px] text-neutral-500 hover:bg-surface-800 hover:text-neutral-200 disabled:opacity-40"
                >
                  Limpar
                </button>
              </div>

              {playlist.entries.length > 0 && (
                <div className="border-b border-surface-800 px-4 py-2.5 text-xs">
                  <div className="text-neutral-500">
                    Tocando:{' '}
                    <span className="text-neutral-200">
                      {currentIndex >= 0 ? (songTitle(playlist.entries[currentIndex].songId)?.title ?? 'Música removida') : '—'}
                    </span>
                  </div>
                  <div className="mt-0.5 text-neutral-500">
                    Próxima:{' '}
                    <span className="text-accent">
                      {nextEntry ? (songTitle(nextEntry.songId)?.title ?? 'Música removida') : 'fim da playlist'}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-2">
                {playlist.entries.length === 0 ? (
                  <div className="px-3 py-8 text-center text-sm leading-relaxed text-neutral-600">
                    Monte a ordem do culto: arraste uma música da biblioteca até aqui, ou clique em “+ Culto”. A playlist
                    fica salva mesmo fechando o programa.
                  </div>
                ) : (
                  playlist.entries.map((entry, i) => {
                    const song = songTitle(entry.songId)
                    const isCurrent = entry.uid === playlist.currentUid
                    const isNext = nextEntry?.uid === entry.uid
                    return (
                      <div
                        key={entry.uid}
                        data-pl-row
                        draggable
                        onDragStart={() => setPlDrag(i)}
                        onDragOver={(e) => {
                          e.preventDefault()
                          const r = e.currentTarget.getBoundingClientRect()
                          setPlDropAt(e.clientY < r.top + r.height / 2 ? i : i + 1)
                        }}
                        onDragEnd={() => {
                          setPlDrag(null)
                          setPlDropAt(null)
                          setPlOver(false)
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          dropOnPlaylist(plDropAt ?? i)
                        }}
                        className={`group mb-1 flex items-center gap-1 rounded-md border px-1.5 py-1.5 transition-colors ${
                          isCurrent ? 'border-accent bg-accent/15' : 'border-transparent hover:bg-surface-800'
                        } ${plDrag === i ? 'opacity-40' : ''} ${
                          plDropAt === i && (plDrag !== null || libDrag) ? 'border-t-accent' : ''
                        }`}
                      >
                        <span className="cursor-grab text-neutral-600 group-hover:text-neutral-400" title="Arraste para reordenar">
                          <Icon name="grip" size={14} />
                        </span>
                        <span className="w-5 shrink-0 text-center text-xs text-neutral-500">{i + 1}</span>
                        <button onClick={() => playEntry(entry.uid)} className="min-w-0 flex-1 text-left">
                          <div className="truncate text-sm text-neutral-100">{song?.title ?? 'Música removida'}</div>
                          <div className="flex items-center gap-1.5 truncate text-[11px] text-neutral-500">
                            {isCurrent && <span className="font-medium text-accent">tocando</span>}
                            {isNext && !isCurrent && <span className="font-medium text-amber-300">próxima</span>}
                            <span className="truncate">{song?.artist}</span>
                          </div>
                        </button>
                        <div className="flex shrink-0 items-center">
                          <button
                            onClick={() => moveEntry(i, i - 1)}
                            disabled={i === 0}
                            title="Subir"
                            className="icon-btn h-6 w-6 disabled:opacity-30"
                          >
                            <Icon name="chevron-up" size={13} />
                          </button>
                          <button
                            onClick={() => moveEntry(i, i + 1)}
                            disabled={i === playlist.entries.length - 1}
                            title="Descer"
                            className="icon-btn h-6 w-6 disabled:opacity-30"
                          >
                            <Icon name="chevron" size={13} />
                          </button>
                          <button
                            onClick={() => removeFromPlaylist(entry.uid)}
                            title="Tirar da playlist"
                            className="icon-btn h-6 w-6"
                          >
                            <Icon name="x" size={13} />
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
                {plDropAt === playlist.entries.length && libDrag && playlist.entries.length > 0 && (
                  <div className="mx-1 h-0.5 rounded bg-accent" />
                )}
              </div>
            </aside>
          </div>
        )}

        {mode === 'create' && (
          <div className="flex flex-1 flex-col gap-3 overflow-y-scroll p-5">
            {notice && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                {notice}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="field-label mb-1">Título</div>
                <input
                  value={draft.title}
                  onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                  className="field-input w-full"
                  autoFocus
                />
              </div>
              <div>
                <div className="field-label mb-1">Artista</div>
                <input
                  value={draft.artist}
                  onChange={(e) => setDraft((d) => ({ ...d, artist: e.target.value }))}
                  className="field-input w-full"
                />
              </div>
            </div>
            <div>
              <div className="field-label mb-1">Autor (opcional)</div>
              <input
                value={draft.author}
                onChange={(e) => setDraft((d) => ({ ...d, author: e.target.value }))}
                className="field-input w-full"
              />
            </div>
            <div className="flex flex-1 flex-col">
              <div className="field-label mb-1">
                Letra — separe as estrofes com uma linha em branco (cada slide mostra 2 linhas por vez)
              </div>
              <textarea
                value={draft.lyrics}
                onChange={(e) => setDraft((d) => ({ ...d, lyrics: e.target.value }))}
                className="field-input min-h-[220px] flex-1 resize-none font-mono text-sm leading-relaxed"
                placeholder={'Primeira estrofe...\n\nSegunda estrofe...'}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setMode('list')}
                className="rounded-md px-3 py-1.5 text-sm text-neutral-400 hover:bg-surface-800"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveDraft}
                disabled={saving || !draft.title.trim() || !draft.lyrics.trim()}
                className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40"
              >
                {saving ? 'Salvando…' : 'Criar música'}
              </button>
            </div>
          </div>
        )}

        {mode === 'reading' && selectedSong && (
          <>
            <div className="flex items-center justify-between border-b border-surface-800 px-4 py-2 text-xs text-neutral-500">
              <span className="flex items-center gap-2">
                <button
                  onClick={exitReading}
                  title="Voltar pra biblioteca (não mexe no telão)"
                  className="rounded-md border border-surface-700 px-2 py-1 text-neutral-300 hover:bg-surface-800"
                >
                  ← Músicas
                </button>
                <span>
                  <span className="font-medium text-accent">{selectedSong.title}</span> — {selectedSong.artist}
                </span>
              </span>
              <div className="flex items-center gap-3">
                {nextEntry && (
                  <button
                    onClick={() => playEntry(nextEntry.uid)}
                    title="Ir para a próxima música da playlist"
                    className="flex items-center gap-1.5 rounded-md border border-surface-700 px-2 py-1 text-neutral-300 hover:border-accent hover:text-neutral-100"
                  >
                    Próxima: {songTitle(nextEntry.songId)?.title ?? 'música removida'}
                    <Icon name="arrow-right" size={12} />
                  </button>
                )}
                <button
                  onClick={() => setComposerOpen(true)}
                  title="Estilizar este slide ao vivo: fonte por palavra, cascata, tira. Não vai pra timeline."
                  className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-hover"
                >
                  + Frase
                </button>
                <button
                  onClick={addBlock}
                  className="rounded-md border border-surface-700 px-2 py-1 text-neutral-300 hover:bg-surface-800"
                >
                  + Novo slide
                </button>
                <span>
                  Slide {blockIndex + 1}/{blocks.length}
                </span>
              </div>
            </div>
            <div className="flex flex-1 overflow-hidden">
            <div className="grid flex-1 grid-cols-2 content-start gap-3 overflow-y-scroll p-4 2xl:grid-cols-3">
              {blocks.map((text, i) => (
                <div
                  key={i}
                  ref={(el) => {
                    blockRefs.current[i] = el
                  }}
                  onClick={() => {
                    if (editingIndex !== null) return
                    setBlockIndex(i)
                    pushBlock(selectedSong, i)
                  }}
                  onDoubleClick={() => editingIndex === null && startEdit(i)}
                  draggable={editingIndex === null}
                  onDragStart={(e) => {
                    setDragIndex(i)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', String(i))
                  }}
                  onDragOver={(e) => {
                    if (dragIndex === null) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    const rect = e.currentTarget.getBoundingClientRect()
                    const gap = e.clientX > rect.left + rect.width / 2 ? i + 1 : i
                    if (gap !== dropAt) setDropAt(gap)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (dragIndex !== null && dropAt !== null) moveBlock(dragIndex, dropAt)
                    endDrag()
                  }}
                  onDragEnd={endDrag}
                  className={`group relative flex aspect-video items-center justify-center whitespace-pre-line rounded-lg border-2 p-3 text-center text-sm font-semibold leading-snug text-white transition-colors ${
                    editingIndex === null ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                  } ${dragIndex === i ? 'opacity-40' : ''} ${
                    i === blockIndex 
                      ? 'border-2 border-accent bg-accent/15 ring-2 ring-accent/50 shadow-lg shadow-accent/20'
                      : 'bg-black border-surface-700 hover:border-surface-600 hover:bg-surface-900'
                  }`}
                >
                  {dragIndex !== null && dropAt !== null && dropAt !== dragIndex && dropAt !== dragIndex + 1 && (
                    <>
                      {dropAt === i && (
                        <span className="pointer-events-none absolute -left-[9px] bottom-0 top-0 z-20 w-1 rounded bg-accent" />
                      )}
                      {dropAt === i + 1 && (
                        <span className="pointer-events-none absolute -right-[9px] bottom-0 top-0 z-20 w-1 rounded bg-accent" />
                      )}
                    </>
                  )}
                  {editingIndex === i ? (
                    <div className="flex h-full w-full flex-col gap-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={commitAndAddNext}
                        disabled={!editText.trim()}
                        title="Salvar e criar um novo slide ao lado (Shift+⌘/Ctrl+Enter)"
                        className="absolute -right-4 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-lg font-bold leading-none text-white shadow-lg ring-2 ring-surface-900 hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        +
                      </button>
                      <textarea
                        autoFocus
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="field-input min-h-0 flex-1 resize-none text-center text-sm font-semibold"
                        placeholder="Texto do slide..."
                      />
                      <div className="flex justify-end gap-2 text-xs font-normal">
                        <button
                          onClick={() => (editIsNew && !editText.trim() ? cancelEdit() : setEditingIndex(null))}
                          className="rounded px-2 py-1 text-neutral-400 hover:bg-surface-800"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={commitEdit}
                          className="rounded bg-accent px-2 py-1 text-white hover:bg-accent-hover"
                        >
                          Salvar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {text}
                      {Boolean(
                        selectedSong.blockFx?.[i]?.effect ||
                          selectedSong.blockFx?.[i]?.phrase ||
                          selectedSong.blockFx?.[i]?.highlights.length
                      ) && (
                        <span className="absolute bottom-1.5 left-2 text-xs" title="Slide com efeito">
                          <Icon name="sparkles" size={13} className="text-accent" />
                        </span>
                      )}
                      <div className="absolute right-1.5 top-1.5 hidden gap-1 group-hover:flex">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            startEdit(i)
                          }}
                          title="Editar texto"
                          className="icon-btn h-6 w-6 bg-surface-800 text-xs"
                        >
                          <Icon name="pencil" size={12} />
                        </button>
                        {blocks.length > 1 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteBlock(i)
                            }}
                            title="Excluir slide"
                            className="icon-btn h-6 w-6 bg-surface-800 text-xs"
                          >
                            <Icon name="trash" size={12} />
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
              <button
                onClick={addBlock}
                onDragOver={(e) => {
                  if (dragIndex === null) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (dropAt !== blocks.length) setDropAt(blocks.length)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragIndex !== null) moveBlock(dragIndex, blocks.length)
                  endDrag()
                }}
                className={`flex aspect-video items-center justify-center rounded-lg border-2 border-dashed text-sm hover:border-surface-600 hover:text-neutral-300 ${
                  dragIndex !== null && dropAt === blocks.length
                    ? 'border-accent text-neutral-200'
                    : 'border-surface-700 text-neutral-500'
                }`}
              >
                + Novo slide
              </button>
            </div>
            {playlist.entries.length > 0 && (
              <aside className="flex w-[190px] shrink-0 flex-col border-l border-surface-800">
                <div className="border-b border-surface-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  Culto
                </div>
                <div className="flex-1 space-y-1 overflow-y-auto p-2">
                  {playlist.entries.map((entry, i) => {
                    const info = songTitle(entry.songId)
                    const playing = entry.uid === playlist.currentUid || info?.id === selectedSong.id
                    return (
                      <button
                        key={entry.uid}
                        onClick={() => playEntry(entry.uid)}
                        title={info ? `${info.title} — ${info.artist}` : 'música removida'}
                        className={`flex w-full items-start gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                          playing
                            ? 'bg-accent/20 text-neutral-100 ring-1 ring-accent/60'
                            : 'text-neutral-400 hover:bg-surface-800 hover:text-neutral-200'
                        }`}
                      >
                        <span className={playing ? 'text-accent' : 'text-neutral-600'}>{i + 1}</span>
                        <span className="min-w-0 flex-1 leading-snug">
                          {info?.title ?? 'música removida'}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <div className="border-t border-surface-800 px-3 py-2 text-[10px] leading-snug text-neutral-600">
                  Trocar de música não mexe no telão: ele só muda quando você clicar num slide.
                </div>
              </aside>
            )}
            <aside className="flex w-[380px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-surface-800 p-4">
              <div>
                <div className="field-label mb-1 flex items-center justify-between">
                  <span>Tamanho da letra (música toda)</span>
                  <span className="text-neutral-400">{Math.round((selectedSong.fontScale ?? 1) * 100)}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setFontScale((selectedSong.fontScale ?? 1) * 100 - 5)}
                    title="Diminuir a letra"
                    className="rounded-md border border-surface-700 px-2.5 py-1 text-sm text-neutral-200 hover:bg-surface-800"
                  >
                    A−
                  </button>
                  <input
                    type="range"
                    min={50}
                    max={200}
                    step={5}
                    value={Math.round((selectedSong.fontScale ?? 1) * 100)}
                    onChange={(e) => setFontScale(Number(e.target.value))}
                    className="min-w-0 flex-1"
                  />
                  <button
                    onClick={() => setFontScale((selectedSong.fontScale ?? 1) * 100 + 5)}
                    title="Aumentar a letra"
                    className="rounded-md border border-surface-700 px-2.5 py-1 text-sm text-neutral-200 hover:bg-surface-800"
                  >
                    A+
                  </button>
                  <button
                    onClick={() => setFontScale(100)}
                    title="Voltar ao tamanho padrão"
                    className="rounded-md border border-surface-700 px-2 py-1 text-xs text-neutral-300 hover:bg-surface-800"
                  >
                    100%
                  </button>
                </div>
              </div>
              <div>
                <div className="field-label mb-1">Como os efeitos vão pro telão</div>
                <div className="flex overflow-hidden rounded-md border border-surface-700 text-xs">
                  {(
                    [
                      [true, 'Eu disparo'],
                      [false, 'Automático']
                    ] as const
                  ).map(([manual, label]) => (
                    <button
                      key={label}
                      onClick={() => changeFxMode(manual)}
                      className={`flex-1 px-2 py-1.5 transition-colors ${
                        manualFx === manual ? 'bg-accent/25 text-neutral-100' : 'text-neutral-400 hover:bg-surface-800'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="mt-1 text-[11px] leading-snug text-neutral-600">
                  {manualFx
                    ? 'Escolher efeito só mostra na prévia. O telão fica com o texto simples até você clicar em “Disparar”.'
                    : 'O efeito escolhido já vai direto pro telão.'}
                </div>
              </div>
              <div>
                <div className="field-label mb-1 flex items-center justify-between">
                  <span>{manualFx ? 'Prévia (ainda não está no telão)' : 'Prévia do que está no LIVE'}</span>
                  <span className="text-neutral-600">slide {blockIndex + 1}</span>
                </div>
                <div
                  className="relative w-full overflow-hidden rounded-md border border-surface-700 bg-black"
                  style={{ aspectRatio: '16 / 9', containerType: 'inline-size' }}
                >
                  {preview?.phrase ? (
                    <div className="absolute inset-0">
                      <PhraseStage
                        phrase={preview.phrase}
                        replayKey={preview.key}
                        highlights={preview.highlights}
                        zoom={preview.fontScale}
                        selectedIndex={phraseSel}
                        onSelectItem={setPhraseSel}
                        onEditItem={editPhraseItem}
                        onEndEdit={savePhraseEdit}
                        onEditText={(i, text) => {
                          if (text.trim()) {
                            editPhraseItem(i, { text })
                            savePhraseEdit()
                          }
                        }}
                      />
                    </div>
                  ) : preview ? (
                    <LiveTextOverlay embedded overlay={preview} />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-neutral-600">
                      Nada em exibição
                    </div>
                  )}
                </div>
                {preview?.phrase && (
                  <div className="mt-1 text-[11px] leading-snug text-neutral-500">
                    Ajuste direto aqui: arraste a palavra para mover, os cantos para o tamanho, a bolinha de cima para girar
                    (Shift = de 15 em 15°) e dê duplo clique para editar o texto.
                    {(manualFx && !fxOnScreen) ? ' O telão só muda quando você disparar.' : ' O telão acompanha ao vivo.'}
                  </div>
                )}
                {manualFx && (
                  <>
                    <button
                      onClick={fireFx}
                      title="Atalho: D"
                      className="mt-2 w-full rounded-md bg-accent px-2 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
                    >
                      <Icon name="replay" size={13} className="mr-1.5 inline" />
                      {fxOnScreen ? 'Disparar de novo no telão' : 'Disparar efeito no telão'}
                      <span className="ml-2 rounded bg-black/25 px-1.5 py-0.5 text-[10px] font-normal">D</span>
                    </button>
                    <div className="mt-1 text-[11px] text-neutral-500">
                      No telão agora: {liveBlank ? 'apagado (Esc)' : fxOnScreen ? 'slide com efeito' : 'texto simples'}
                    </div>
                  </>
                )}
              </div>
              {editingIndex === null && blocks[blockIndex] !== undefined && (
                <>
                <div>
                  <div className="field-label mb-1">
                    Efeito de entrada {effectScope === 'all' ? 'de todos os slides' : `do slide ${blockIndex + 1}`}
                  </div>
                  <div className="mb-2 flex overflow-hidden rounded-md border border-surface-700 text-xs">
                    {(
                      [
                        ['one', 'Só este slide'],
                        ['all', 'Todos os slides']
                      ] as const
                    ).map(([scope, label]) => (
                      <button
                        key={scope}
                        onClick={() => setEffectScope(scope)}
                        className={`flex-1 px-2 py-1.5 transition-colors ${
                          effectScope === scope ? 'bg-accent/25 text-neutral-100' : 'text-neutral-400 hover:bg-surface-800'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <EffectPicker
                    value={selectedSong.blockFx?.[blockIndex]?.effect ?? 'none'}
                    onChange={(v) => {
                      const effect = v === 'none' ? null : (v as SlideFx['effect'])
                      if (effectScope === 'all') applyEffectToAll(effect)
                      else updateSlideFx({ effect }, true)
                    }}
                    leading={[{ value: 'none', label: 'Sem efeito' }]}
                  />
                  {!manualFx && (
                    <button
                      onClick={() => pushBlock(selectedSong, blockIndex, true)}
                      className="mt-2 w-full rounded-md border border-surface-700 px-2 py-1 text-xs text-neutral-300 hover:bg-surface-800"
                    >
                      <Icon name="replay" size={12} className="mr-1.5 inline" />Repetir no LIVE
                    </button>
                  )}
                  {effectScope === 'one' && (
                  <button
                    onClick={() => applyEffectToAll()}
                    title="Copia o efeito de entrada deste slide para todos os slides da música"
                    className="mt-2 w-full rounded-md border border-surface-700 px-2 py-1 text-xs text-neutral-300 hover:bg-surface-800"
                  >
                    <Icon name="sparkles" size={12} className="mr-1.5 inline" />
                    {selectedSong.blockFx?.[blockIndex]?.effect ? 'Aplicar este efeito em todos os slides' : 'Tirar o efeito de todos os slides'}
                  </button>
                  )}
                  {selectedSong.blockFx?.[blockIndex]?.phrase && (
                    <button
                      onClick={() => updateSlideFx({ phrase: null }, true)}
                      className="mt-2 w-full rounded-md border border-amber-400/50 px-2 py-1 text-xs text-amber-200 hover:bg-surface-800"
                    >
                      Remover estilo de frase (volta ao texto simples)
                    </button>
                  )}
                </div>
                <div>
                  {selectedSong.blockFx?.[blockIndex]?.phrase ? (
                    <div className="mb-1 text-[11px] leading-snug text-neutral-500">
                      Este slide usa estilo de frase: as fontes de cada palavra se ajustam em “+ Frase”.
                    </div>
                  ) : (
                    <div className="mb-2 flex overflow-hidden rounded-md border border-surface-700 text-xs">
                      {(
                        [
                          ['highlight', 'Destacar palavra'],
                          ['font', 'Trocar fonte']
                        ] as const
                      ).map(([mode, label]) => (
                        <button
                          key={mode}
                          onClick={() => {
                            setWordMode(mode)
                            setFontWord(null)
                          }}
                          className={`flex-1 px-2 py-1.5 transition-colors ${
                            wordMode === mode ? 'bg-accent/25 text-neutral-100' : 'text-neutral-400 hover:bg-surface-800'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="field-label mb-1">
                    {wordMode === 'font' && !selectedSong.blockFx?.[blockIndex]?.phrase
                      ? 'Clique numa palavra para escolher a fonte dela.'
                      : 'Clique na palavra para marcar (brilho + efeito) e clique de novo para tirar. Some sozinho ao passar pro próximo slide.'}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {slideWords.map((word, wi) => {
                      const fx = selectedSong.blockFx?.[blockIndex]
                      const on = fx?.highlights.includes(wi)
                      const styled = Boolean(fx?.wordStyles?.[wi])
                      const fontMode = wordMode === 'font' && !fx?.phrase
                      return (
                        <button
                          key={`${wi}-${word}`}
                          onClick={() => {
                            if (fontMode) {
                              setFontWord(wi === fontWord ? null : wi)
                            } else if (effectWord === wi || (!on && !fx?.wordEffects?.[wi])) {
                              // palavra já selecionada: clicar de novo tira a seleção e o que foi aplicado nela;
                              // palavra sem nada: seleciona e já liga o brilho
                              if (on || fx?.wordEffects?.[wi]) clearWord(wi)
                              else {
                                toggleHighlight(wi)
                                setEffectWord(wi)
                              }
                            } else {
                              // palavra que já tem efeito/brilho mas não está selecionada: seleciona pra editar
                              setEffectWord(wi)
                            }
                          }}
                          style={styled ? { fontFamily: fx?.wordStyles?.[wi]?.fontFamily } : undefined}
                          className={`rounded-md border px-2 py-1 text-sm transition-colors ${
                            (fontMode && fontWord === wi) || (!fontMode && effectWord === wi)
                              ? 'border-accent bg-accent/20 text-neutral-100 ring-1 ring-accent'
                              : on
                                ? 'border-amber-400 bg-amber-400/20 font-semibold text-amber-200'
                                : styled
                                  ? 'border-sky-400/60 text-sky-200 hover:bg-surface-800'
                                  : 'border-surface-700 text-neutral-300 hover:bg-surface-800'
                          }`}
                        >
                          {word}
                          {fx?.wordEffects?.[wi] && <Icon name="sparkles" size={11} className="ml-1 inline" />}
                        </button>
                      )
                    })}
                  </div>
                  {wordMode === 'highlight' && !selectedSong.blockFx?.[blockIndex]?.phrase && effectWord !== null && slideWords[effectWord] && (
                    <div className="mt-2 space-y-2 rounded-md border border-surface-800 bg-surface-950/60 p-2.5">
                      <div className="flex items-center justify-between">
                        <div className="field-label">Efeito só de “{slideWords[effectWord]}”</div>
                        <button
                          onClick={() => clearWord(effectWord)}
                          title="Tirar o brilho e o efeito desta palavra"
                          className="rounded-md border border-red-400/50 px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-400/10"
                        >
                          <Icon name="x" size={11} className="mr-1 inline" />Tirar efeito
                        </button>
                        <label className="flex items-center gap-1.5 text-[11px] text-neutral-400">
                          <input
                            type="checkbox"
                            checked={selectedSong.blockFx?.[blockIndex]?.highlights.includes(effectWord) ?? false}
                            onChange={() => toggleHighlight(effectWord)}
                          />
                          Brilho pulsante
                        </label>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="field-label">Tamanho</div>
                        <button
                          onClick={() => setWordStyle(effectWord, { scale: Math.max(0.5, (selectedSong.blockFx?.[blockIndex]?.wordStyles?.[effectWord]?.scale ?? 1) - 0.1) })}
                          title="Diminuir"
                          className="rounded-md border border-surface-700 px-2 py-0.5 text-sm text-neutral-300 hover:bg-surface-800"
                        >
                          A−
                        </button>
                        <input
                          type="range"
                          min={50}
                          max={300}
                          step={10}
                          value={Math.round((selectedSong.blockFx?.[blockIndex]?.wordStyles?.[effectWord]?.scale ?? 1) * 100)}
                          onChange={(e) => setWordStyle(effectWord, { scale: Number(e.target.value) / 100 })}
                          className="min-w-0 flex-1"
                        />
                        <button
                          onClick={() => setWordStyle(effectWord, { scale: Math.min(3, (selectedSong.blockFx?.[blockIndex]?.wordStyles?.[effectWord]?.scale ?? 1) + 0.1) })}
                          title="Aumentar"
                          className="rounded-md border border-surface-700 px-2 py-0.5 text-sm text-neutral-300 hover:bg-surface-800"
                        >
                          A+
                        </button>
                        <span className="w-8 text-right text-[11px] text-neutral-400">
                          {Math.round((selectedSong.blockFx?.[blockIndex]?.wordStyles?.[effectWord]?.scale ?? 1) * 100)}%
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="field-label">Cor da palavra</div>
                        <input
                          type="color"
                          value={
                            selectedSong.blockFx?.[blockIndex]?.wordStyles?.[effectWord]?.color ??
                            (selectedSong.blockFx?.[blockIndex]?.highlights.includes(effectWord) ? '#ffd54a' : '#ffffff')
                          }
                          onChange={(e) => setWordStyle(effectWord, { color: e.target.value })}
                          className="h-7 w-14 cursor-pointer rounded-md border border-surface-600 bg-surface-800"
                        />
                        {selectedSong.blockFx?.[blockIndex]?.wordStyles?.[effectWord]?.color && (
                          <button
                            onClick={() => setWordStyle(effectWord, { color: undefined })}
                            className="rounded-md border border-surface-700 px-2 py-0.5 text-[11px] text-neutral-300 hover:bg-surface-800"
                          >
                            Cor padrão
                          </button>
                        )}
                      </div>
                      <EffectPicker
                        value={selectedSong.blockFx?.[blockIndex]?.wordEffects?.[effectWord] ?? 'none'}
                        onChange={(v) => setWordEffect(effectWord, v === 'none' ? null : (v as EffectId))}
                        onToggleOff={() => clearWord(effectWord)}
                        leading={[{ value: 'none', label: 'Sem efeito' }]}
                      />
                      <div className="text-[11px] leading-snug text-neutral-600">
                        O efeito toca só nessa palavra, logo depois do slide entrar.
                      </div>
                    </div>
                  )}
                  {wordMode === 'font' && !selectedSong.blockFx?.[blockIndex]?.phrase && fontWord !== null && slideWords[fontWord] && (
                    <div className="mt-2 space-y-2 rounded-md border border-surface-800 bg-surface-950/60 p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="field-label">Fonte de “{slideWords[fontWord]}”</div>
                        <button
                          onClick={() => {
                            setWordStyle(fontWord, null)
                            setFontWord(null)
                          }}
                          disabled={!selectedSong.blockFx?.[blockIndex]?.wordStyles?.[fontWord]}
                          title="Tirar a fonte/cor/tamanho desta palavra"
                          className="rounded-md border border-red-400/50 px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Icon name="x" size={11} className="mr-1 inline" />Tirar efeito
                        </button>
                      </div>
                      <FontPicker
                        value={selectedSong.blockFx?.[blockIndex]?.wordStyles?.[fontWord]?.fontFamily ?? ''}
                        onChange={(f) => setWordStyle(fontWord, { fontFamily: f || undefined })}
                        emptyLabel="Igual ao resto do slide"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="field-label mb-1">Tamanho (%)</div>
                          <input
                            type="number"
                            min={40}
                            max={400}
                            step={10}
                            value={Math.round((selectedSong.blockFx?.[blockIndex]?.wordStyles?.[fontWord]?.scale ?? 1) * 100)}
                            onChange={(e) =>
                              setWordStyle(fontWord, { scale: Math.min(4, Math.max(0.4, Number(e.target.value) / 100)) })
                            }
                            className="field-input"
                          />
                        </div>
                        <div>
                          <div className="field-label mb-1">Cor</div>
                          <input
                            type="color"
                            value={selectedSong.blockFx?.[blockIndex]?.wordStyles?.[fontWord]?.color ?? '#ffffff'}
                            onChange={(e) => setWordStyle(fontWord, { color: e.target.value })}
                            className="h-8 w-full cursor-pointer rounded-md border border-surface-600 bg-surface-800"
                          />
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-neutral-400">
                        <input
                          type="checkbox"
                          checked={selectedSong.blockFx?.[blockIndex]?.wordStyles?.[fontWord]?.italic ?? false}
                          onChange={(e) => setWordStyle(fontWord, { italic: e.target.checked })}
                        />
                        Itálico
                      </label>
                      <button
                        onClick={() => setWordStyle(fontWord, null)}
                        className="w-full rounded-md border border-surface-700 px-2 py-1 text-xs text-neutral-300 hover:bg-surface-800"
                      >
                        Restaurar palavra
                      </button>
                    </div>
                  )}
                </div>
                </>
              )}
            </aside>
            </div>
            <div className="flex items-center justify-center gap-8 border-t border-surface-800 px-3 py-1.5 text-[11px] text-neutral-600">
              <span>← → trocam de slide{manualFx ? ' · D dispara o efeito' : ''}</span>
              <span>Enter ou duplo clique edita · ⌘/Ctrl+Enter salva · +Shift salva e cria outro slide</span>
              <span>Esc apaga o telão</span>
            </div>
          </>
        )}

        {composerOpen && selectedSong && (
          <PhraseComposerModal
            initialPhrase={selectedSong.blocks[blockIndex]}
            onClose={() => setComposerOpen(false)}
            onApply={(layout: PhraseLayout) => updateSlideFx({ phrase: layout }, true)}
            onApplyAll={applyPhraseToAll}
          />
        )}

        {onlineSearchOpen && (
          <SongSearchOnlineModal
            onCancel={() => setOnlineSearchOpen(false)}
            onUseResult={({ title, artist, lyrics }) => {
              setDraft({ title, artist, author: '', lyrics })
              setNotice(
                lyrics
                  ? null
                  : 'Não achei a letra automaticamente pra essa música — cole a letra abaixo (separe as estrofes com uma linha em branco).'
              )
              setOnlineSearchOpen(false)
              setMode('create')
            }}
          />
        )}

        {holyricsImportOpen && (
          <HolyricsImportModal
            onCancel={() => setHolyricsImportOpen(false)}
            onImported={refreshSongs}
          />
        )}
      </div>
    </div>
  )
}
