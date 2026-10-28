declare module 'mammoth' {
  export interface MammothMessage {
    type: string
    message: string
  }

  export interface MammothResult {
    value: string
    messages: MammothMessage[]
  }

  export interface MammothInput {
    buffer?: Buffer
    path?: string
  }

  export interface MammothOptions {
    styleMap?: string[]
    includeDefaultStyleMap?: boolean
  }

  export function convertToHtml(
    input: MammothInput,
    options?: MammothOptions
  ): Promise<MammothResult>

  export function extractRawText(input: MammothInput): Promise<MammothResult>

  const mammoth: {
    convertToHtml: typeof convertToHtml
    extractRawText: typeof extractRawText
  }

  export default mammoth
}
