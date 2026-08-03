/**
 * `file-type` ships ESM-only with an `exports` map TypeScript's classic "Node" module
 * resolution (used by the rest of this CommonJS-compiled project) can't follow. This ambient
 * declaration covers the one function actually used (via dynamic `import()` at the call site —
 * see `media-validation.ts`) without changing project-wide module resolution.
 */
declare module 'file-type' {
  export interface FileTypeResult {
    ext: string;
    mime: string;
  }
  export function fileTypeFromBuffer(
    input: Uint8Array | ArrayBuffer,
  ): Promise<FileTypeResult | undefined>;
}
