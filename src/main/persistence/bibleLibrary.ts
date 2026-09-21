import { promises as fs } from 'node:fs'
import { app, dialog, BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { BibleBook, BibleVersionMeta } from '@shared/types/bible'

/**
 * Fontes: thiagobodruk/biblia (github.com/thiagobodruk/biblia, CC BY-NC) pra
 * ACF/AA/NVI, e damarals/biblias (github.com/damarals/biblias, MIT) pra
 * ARC/NAA — mesmo formato de JSON nos dois. Os textos em si pertencem às
 * respectivas sociedades bíblicas — ACF e AA são de uso livre corrente para
 * fins ministeriais; ARC, NAA e NVI têm direitos reservados às suas editoras,
 * então ficam disponíveis mas com aviso explícito antes de baixar.
 */
const CATALOG: Omit<BibleVersionMeta, 'downloaded'>[] = [
  {
    id: 'acf',
    label: 'Almeida Corrigida Fiel (ACF)',
    license: 'Uso ministerial livre — Sociedade Bíblica Trinitariana do Brasil.',
    source: 'https://raw.githubusercontent.com/thiagobodruk/biblia/master/json/acf.json'
  },
  {
    id: 'aa',
    label: 'Almeida Revisada Imprensa Bíblica (AA)',
    license: 'Uso ministerial livre — Imprensa Bíblica Brasileira.',
    source: 'https://raw.githubusercontent.com/thiagobodruk/biblia/master/json/aa.json'
  },
  {
    id: 'arc',
    label: 'Almeida Revista e Corrigida (ARC)',
    license: 'Direitos reservados à Sociedade Bíblica do Brasil — confirme a licença antes de usar comercialmente.',
    source: 'https://github.com/damarals/biblias/releases/latest/download/ARC.json'
  },
  {
    id: 'naa',
    label: 'Nova Almeida Atualizada (NAA)',
    license: 'Direitos reservados à Sociedade Bíblica do Brasil — confirme a licença antes de usar comercialmente.',
    source: 'https://github.com/damarals/biblias/releases/latest/download/NAA.json'
  },
  {
    id: 'nvi',
    label: 'Nova Versão Internacional (NVI)',
    license: 'Direitos reservados à Sociedade Bíblica Internacional — confirme a licença antes de usar comercialmente.',
    source: 'https://raw.githubusercontent.com/thiagobodruk/biblia/master/json/nvi.json'
  }
]

function sourceUrl(versionId: string): string {
  const entry = CATALOG.find((v) => v.id === versionId)
  if (!entry?.source) throw new Error('Versão desconhecida ou sem fonte de download.')
  return entry.source
}

function bibleDir(): string {
  return join(app.getPath('userData'), 'bible')
}

function filePathFor(versionId: string): string {
  return join(bibleDir(), `${versionId}.json`)
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

export async function listBibleVersions(): Promise<BibleVersionMeta[]> {
  const results: BibleVersionMeta[] = []
  for (const v of CATALOG) {
    results.push({ ...v, downloaded: await fileExists(filePathFor(v.id)) })
  }
  return results
}

export async function downloadBibleVersion(versionId: string): Promise<void> {
  const entry = CATALOG.find((v) => v.id === versionId)
  if (!entry) throw new Error('Versão desconhecida')
  if (entry.importOnly) throw new Error('Essa versão não tem download automático. Use "Importar arquivo".')
  const res = await fetch(sourceUrl(versionId))
  if (!res.ok) throw new Error(`Falha ao baixar (HTTP ${res.status})`)
  const text = await res.text()
  await fs.mkdir(bibleDir(), { recursive: true })
  await fs.writeFile(filePathFor(versionId), text, 'utf-8')
}

export async function readBibleVersion(versionId: string): Promise<BibleBook[]> {
  const raw = await fs.readFile(filePathFor(versionId), 'utf-8')
  return JSON.parse(raw.replace(/^﻿/, ''))
}

export async function deleteBibleVersion(versionId: string): Promise<void> {
  await fs.rm(filePathFor(versionId), { force: true })
}

/** Confere se o JSON tem o formato esperado: lista de livros { name, chapters: string[][] }. */
function isValidBible(data: unknown): data is BibleBook[] {
  if (!Array.isArray(data) || data.length < 60) return false
  return data.every(
    (book) =>
      book &&
      typeof book.name === 'string' &&
      Array.isArray(book.chapters) &&
      book.chapters.every((ch: unknown) => Array.isArray(ch) && ch.every((v) => typeof v === 'string'))
  )
}

/** Abre a escolha de arquivo e guarda a Bíblia importada como a versão `versionId`. */
export async function importBibleVersion(versionId: string): Promise<boolean> {
  const entry = CATALOG.find((v) => v.id === versionId)
  if (!entry) throw new Error('Versão desconhecida')

  const win = BrowserWindow.getFocusedWindow()
  const options = {
    title: `Importar ${entry.label}`,
    properties: ['openFile' as const],
    filters: [{ name: 'Bíblia (JSON)', extensions: ['json'] }]
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return false

  const raw = await fs.readFile(result.filePaths[0], 'utf-8')
  let data: unknown
  try {
    data = JSON.parse(raw.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('O arquivo não é um JSON válido.')
  }
  if (!isValidBible(data)) {
    throw new Error(
      'Formato não reconhecido. Esperado: lista de livros, cada um com "name" e "chapters" (capítulos com os versículos em texto).'
    )
  }
  await fs.mkdir(bibleDir(), { recursive: true })
  await fs.writeFile(filePathFor(versionId), JSON.stringify(data), 'utf-8')
  return true
}
