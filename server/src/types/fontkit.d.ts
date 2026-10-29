declare module 'fontkit' {
  interface FontFace {
    postscriptName: string
    familyName: string
    subfamilyName: string
    hasGlyphForCodePoint(codePoint: number): boolean
  }

  interface FontCollection {
    fonts: FontFace[]
  }

  type Font = FontFace

  function openSync(filename: string, postscriptName?: string): Font | FontCollection | null
  function open(filename: string, postscriptName?: string): Promise<Font | FontCollection>

  export { openSync, open }
  export type { Font, FontCollection, FontFace }
}
