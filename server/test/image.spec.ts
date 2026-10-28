import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseImage } from '../src/pipeline/image'
import { makePng } from './helpers'

let dir = ''

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'srdi-image-'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('图片解析', () => {
  it('单图作为一页直传视觉', async () => {
    const filesDir = path.join(dir, 'files')
    await mkdir(filesDir, { recursive: true })
    const filePath = path.join(filesDir, 'f_img.png')
    await writeFile(filePath, makePng())

    const result = await parseImage({ fileId: 'f_img', filePath, projectDir: dir })
    const page = result.pages[0]

    expect(result.totalPages).toBe(1)
    expect(page.route).toBe('vision')
    expect(page.image).toBe('files/f_img.png')
    expect(page.text).toBe('')
    expect(page.width).toBe(1)
    expect(page.height).toBe(1)
  })
})
