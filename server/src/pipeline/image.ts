import path from 'node:path'
import { loadImage } from '@napi-rs/canvas'
import type { ParsedFile } from '@srdi/shared'

export interface ImageParseOptions {
  fileId: string
  filePath: string
  projectDir: string
}

export const parseImage = async (options: ImageParseOptions): Promise<ParsedFile> => {
  let width = 0
  let height = 0
  try {
    const image = await loadImage(options.filePath)
    width = image.width
    height = image.height
  } catch {
    width = 0
    height = 0
  }

  const relative = path
    .relative(options.projectDir, options.filePath)
    .split(path.sep)
    .join('/')

  return {
    pages: [
      {
        fileId: options.fileId,
        page: 1,
        route: 'vision',
        width,
        height,
        text: '',
        blocks: [],
        tables: [],
        printableChars: 0,
        hasGlyphs: false,
        garbledRatio: 0,
        image: relative
      }
    ],
    totalPages: 1,
    truncated: false,
    unreadable: []
  }
}
