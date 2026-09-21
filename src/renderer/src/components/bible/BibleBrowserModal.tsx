import { useEffect, useRef, useState } from 'react'
import type { BibleBook, BibleVersionMeta } from '@shared/types/bible'
import { parseQuickLocate } from '../../lib/bibleSearch'
import { splitVerseIntoSlides } from '@shared/lib/verseSlides'
import { categoryColorForIndex } from './bookCategories'
import { QuickLocatePopup } from './QuickLocatePopup'
import { LiveToggleButton } from '../common/LiveToggleButton'
import { Icon } from '../common/Icon'

export function BibleBrowserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [versions, setVersions] = useState<BibleVersionMeta[] | null>(null)
  const [versionId, setVersionId] = useState('acf')
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [books, setBooks] = useState<BibleBook[] | null>(null)
  const [bookIndex, setBookIndex] = useState(0)
  const [chapter, setChapter] = useState(1)
  const [locatedVerse, setLocatedVerse] = useState<number | null>(null)
  const [quickBuffer, setQuickBuffer] = useState<string | null>(null)
  const verseRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Modo leitura ao vivo: entra ao escolher um versículo, e as setas ←/→
  // avançam/voltam versículo, atualizando o overlay que a janela LIVE mostra.
  // Isso é totalmente à parte da cena/timeline do projeto — a Bíblia nunca
  // cria camada nem mexe no que você está montando no editor.
  const [reading, setReading] = useState(false)
  const [readingVerseIndex, setReadingVerseIndex] = useState(0)
  /** Versículos longos viram vários slides (2 linhas cada); este é o slide atual dentro do versículo. */
  const [slideIndex, setSlideIndex] = useState(0)

  useEffect(() => {
    if (!open || !window.api) return
    window.api.bible.listVersions().then(setVersions)
  }, [open])

  const selectedVersion = versions?.find((v) => v.id === versionId)

  useEffect(() => {
    setBooks(null)
    if (!open || !window.api || !selectedVersion?.downloaded) return
    let cancelled = false
    window.api.bible.readVersion(versionId).then((data) => {
      if (!cancelled) setBooks(data)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, versionId, selectedVersion?.downloaded])

  useEffect(() => {
    if (!open) {
      setReading(false)
      window.api?.live.pushOverlay(null)
    }
  }, [open])

  /** Manda um trecho (slide) do versículo pro overlay da janela LIVE — não mexe na cena/timeline
   * do projeto. Versículos longos viram vários slides de até 2 linhas; a referência exibida ao
   * vivo é sempre só "Livro Cap:Vers", sem contador (isso fica só na tela do editor). */
  const showVerseOnScreen = (book: BibleBook, ch: number, verseIndex: number, slideIdx: number): void => {
    const text = book.chapters[ch - 1]?.[verseIndex]
    if (text === undefined) return
    const slides = splitVerseIntoSlides(text)
    const slide = slides[Math.min(slideIdx, slides.length - 1)] ?? text
    window.api?.live.pushOverlay({ text: slide, reference: `${book.name} ${ch}:${verseIndex + 1}` })
  }

  const exitReadingMode = (): void => {
    setReading(false)
    window.api?.live.pushOverlay(null)
  }

  const enterReadingMode = (bIdx: number, ch: number, verseIndex: number): void => {
    if (!books) return
    setBookIndex(bIdx)
    setChapter(ch)
    setReadingVerseIndex(verseIndex)
    setSlideIndex(0)
    setReading(true)
    showVerseOnScreen(books[bIdx], ch, verseIndex, 0)
  }

  const stepVerse = (direction: 1 | -1): void => {
    if (!books) return
    const book = books[bookIndex]
    const currentSlideCount = splitVerseIntoSlides(book.chapters[chapter - 1][readingVerseIndex]).length

    // ainda tem mais slide dentro do mesmo versículo: só anda de slide, sem trocar de versículo
    if (direction === 1 && slideIndex < currentSlideCount - 1) {
      setSlideIndex(slideIndex + 1)
      showVerseOnScreen(book, chapter, readingVerseIndex, slideIndex + 1)
      return
    }
    if (direction === -1 && slideIndex > 0) {
      setSlideIndex(slideIndex - 1)
      showVerseOnScreen(book, chapter, readingVerseIndex, slideIndex - 1)
      return
    }

    const atVeryStart = bookIndex === 0 && chapter === 1 && readingVerseIndex === 0 && slideIndex === 0
    const atVeryEnd =
      bookIndex === books.length - 1 &&
      chapter === book.chapters.length &&
      readingVerseIndex === book.chapters[chapter - 1].length - 1 &&
      slideIndex === currentSlideCount - 1
    if ((direction === -1 && atVeryStart) || (direction === 1 && atVeryEnd)) return

    let bIdx = bookIndex
    let ch = chapter
    let vIdx = readingVerseIndex + direction

    if (vIdx < 0) {
      ch -= 1
      if (ch < 1) {
        bIdx -= 1
        ch = books[bIdx].chapters.length
      }
      vIdx = books[bIdx].chapters[ch - 1].length - 1
    } else if (vIdx >= books[bIdx].chapters[ch - 1].length) {
      ch += 1
      if (ch > books[bIdx].chapters.length) {
        bIdx += 1
        ch = 1
      }
      vIdx = 0
    }

    // voltando pra um versículo anterior, entra pelo último slide dele (não pelo primeiro)
    const sIdx = direction === -1 ? splitVerseIntoSlides(books[bIdx].chapters[ch - 1][vIdx]).length - 1 : 0

    setBookIndex(bIdx)
    setChapter(ch)
    setReadingVerseIndex(vIdx)
    setSlideIndex(sIdx)
    showVerseOnScreen(books[bIdx], ch, vIdx, sIdx)
  }

  // Aperta qualquer tecla com o modal aberto -> abre o popup de localização
  // rápida (Livro/Capítulo/Versículo), igual o Holyrics. Enter confirma, Esc cancela.
  // Em modo leitura, ←/→ andam pelos versículos e atualizam o que está na tela.
  useEffect(() => {
    if (!open) return

    const commit = (): void => {
      if (books && quickBuffer !== null) {
        const parsed = parseQuickLocate(books, quickBuffer)
        if (parsed.book) {
          const idx = books.findIndex((b) => b.abbrev === parsed.book!.abbrev)
          const targetChapter =
            parsed.chapter && parsed.book.chapters[parsed.chapter - 1] ? parsed.chapter : 1
          if (parsed.verseRaw) {
            const vIdx = Number(parsed.verseRaw) - 1
            if (parsed.book.chapters[targetChapter - 1]?.[vIdx] !== undefined) {
              enterReadingMode(idx, targetChapter, vIdx)
            } else {
              setBookIndex(idx)
              setChapter(targetChapter)
            }
          } else {
            setBookIndex(idx)
            setChapter(targetChapter)
            setLocatedVerse(1)
          }
        }
      }
      setQuickBuffer(null)
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return

      if (quickBuffer !== null) {
        if (e.key === 'Escape') {
          e.preventDefault()
          setQuickBuffer(null)
          return
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
          return
        }
        if (e.key === 'Backspace') {
          e.preventDefault()
          setQuickBuffer((b) => (b ?? '').slice(0, -1))
          return
        }
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault()
          setQuickBuffer((b) => (b ?? '') + e.key)
        }
        return
      }

      if (reading && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault()
        stepVerse(e.key === 'ArrowRight' ? 1 : -1)
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        if (reading) exitReadingMode()
        else onClose()
        return
      }
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        setQuickBuffer(e.key)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, quickBuffer, books, onClose, reading, bookIndex, chapter, readingVerseIndex, slideIndex])

  useEffect(() => {
    if (locatedVerse === null) return
    verseRefs.current[locatedVerse - 1]?.scrollIntoView({ block: 'center' })
    const timeout = setTimeout(() => setLocatedVerse(null), 1600)
    return () => clearTimeout(timeout)
  }, [locatedVerse, bookIndex, chapter])

  if (!open) return null

  const handleImport = async (): Promise<void> => {
    if (!window.api) return
    setDownloading(true)
    setDownloadError(null)
    try {
      const imported = await window.api.bible.importVersion(versionId)
      if (imported) setVersions(await window.api.bible.listVersions())
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : String(err))
    } finally {
      setDownloading(false)
    }
  }

  const handleDownload = async (): Promise<void> => {
    if (!window.api) return
    setDownloading(true)
    setDownloadError(null)
    try {
      await window.api.bible.downloadVersion(versionId)
      setVersions(await window.api.bible.listVersions())
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err))
    } finally {
      setDownloading(false)
    }
  }

  const currentBook = books?.[bookIndex] ?? null
  const chapterCount = currentBook?.chapters.length ?? 0
  const verses = currentBook?.chapters[chapter - 1] ?? []
  const readingSlides = reading && verses[readingVerseIndex] !== undefined ? splitVerseIntoSlides(verses[readingVerseIndex]) : ['']
  const quickState = books && quickBuffer !== null ? parseQuickLocate(books, quickBuffer) : null

  const handleSelectBook = (index: number): void => {
    setBookIndex(index)
    setChapter(1)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="relative flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-surface-800 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
            <Icon name="book" size={16} className="text-neutral-400" />
            <span>{currentBook ? `${currentBook.name} ${chapter}` : 'Bíblia'}</span>
            {reading && <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] text-accent">AO VIVO</span>}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={versionId}
              onChange={(e) => setVersionId(e.target.value)}
              className="field-input w-56"
            >
              {(versions ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                  {v.downloaded ? '' : ' — não baixada'}
                </option>
              ))}
            </select>
            <LiveToggleButton />
            <button onClick={onClose} className="icon-btn h-8 w-8 text-lg" title="Fechar">
              ×
            </button>
          </div>
        </div>

        {!versions ? (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-600">
            {window.api ? 'Carregando…' : 'API do Electron indisponível neste ambiente.'}
          </div>
        ) : !selectedVersion?.downloaded ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="max-w-sm text-sm text-neutral-400">{selectedVersion?.license}</p>
            {selectedVersion?.importOnly ? (
              <button
                onClick={handleImport}
                disabled={downloading}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {downloading ? 'Importando…' : `Importar arquivo da ${selectedVersion.label.match(/\(([^)]+)\)/)?.[1] ?? 'versão'}…`}
              </button>
            ) : (
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {downloading ? 'Baixando…' : 'Baixar esta versão'}
              </button>
            )}
            {downloadError && <p className="text-xs text-red-400">{downloadError}</p>}
          </div>
        ) : !books ? (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-600">
            Carregando textos…
          </div>
        ) : reading ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-8 p-12 text-center">
            <div className="text-2xl font-semibold text-accent">
              {currentBook?.name} {chapter}:{readingVerseIndex + 1}
              {readingSlides.length > 1 && (
                <span className="ml-2 text-sm font-normal text-neutral-500">
                  trecho {slideIndex + 1}/{readingSlides.length}
                </span>
              )}
            </div>
            <div className="max-w-5xl whitespace-pre-line text-5xl font-semibold leading-tight text-white">
              {readingSlides[slideIndex]}
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-1 overflow-hidden">
              <div className="flex w-[42%] flex-col overflow-hidden border-r border-surface-800">
                <div className="flex-1 space-y-2 overflow-y-scroll p-4">
                  {verses.map((text, i) => (
                    <button
                      key={i}
                      ref={(el) => {
                        verseRefs.current[i] = el
                      }}
                      onClick={() => enterReadingMode(bookIndex, chapter, i)}
                      title="Clique para exibir ao vivo e continuar lendo com as setas"
                      className={`block w-full rounded-md p-1.5 text-left text-sm leading-relaxed transition-colors ${
                        locatedVerse === i + 1
                          ? 'bg-accent/15 text-neutral-100 ring-1 ring-accent'
                          : 'text-neutral-300 hover:bg-surface-800'
                      }`}
                    >
                      <span className="mr-1.5 font-semibold text-accent">{i + 1}</span>
                      {text}
                    </button>
                  ))}
                </div>
                <div className="border-t border-surface-800 p-2 text-[10px] leading-snug text-neutral-600">
                  {selectedVersion.license}
                </div>
              </div>

              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="grid grid-cols-8 gap-1 overflow-y-scroll p-3" style={{ maxHeight: '58%' }}>
                  {books.map((b, i) => (
                    <button
                      key={b.abbrev}
                      onClick={() => handleSelectBook(i)}
                      title={b.name}
                      className={`flex flex-col items-center justify-center gap-0.5 rounded-md px-1 py-2 text-white transition-transform hover:scale-[1.04] ${categoryColorForIndex(
                        i
                      )} ${i === bookIndex ? 'ring-2 ring-white' : ''}`}
                    >
                      <span className="text-[11px] font-bold uppercase">{b.abbrev}</span>
                      <span className="w-full truncate text-center text-[9px] opacity-90">{b.name}</span>
                    </button>
                  ))}
                </div>
                <div className="flex-1 overflow-y-scroll border-t border-surface-800 p-3">
                  <div className="grid grid-cols-8 gap-1">
                    {Array.from({ length: chapterCount }, (_, i) => i + 1).map((c) => (
                      <button
                        key={c}
                        onClick={() => setChapter(c)}
                        className={`rounded-md py-2 text-sm transition-colors ${
                          c === chapter
                            ? 'bg-accent text-white'
                            : 'bg-surface-800 text-neutral-300 hover:bg-surface-700'
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-surface-800 px-3 py-1.5 text-center text-[11px] text-neutral-600">
              Digite uma tecla para localizar rapidamente o versículo
            </div>
          </>
        )}

        {quickState && <QuickLocatePopup state={quickState} onCancel={() => setQuickBuffer(null)} />}
      </div>
    </div>
  )
}
