import { createHash } from 'node:crypto'
import {
  brand,
  type ArtifactId,
  type MilitaryArtifacts,
  type Sha256,
} from '@dsh-military/contracts'
import type { ContextMaterializer } from '@dsh-military/core'

/** Resolves artifact-addressed and inline control references for the Context Compiler. */
export class MilitaryContextMaterializer implements ContextMaterializer {
  readonly #artifacts: MilitaryArtifacts
  constructor(artifacts: MilitaryArtifacts) { this.#artifacts = artifacts }

  async materialize(ref: string): Promise<{ readonly contentRef: string; readonly sha256: Sha256; readonly tokenEstimate: number; readonly sourceEventIds?: readonly string[] }> {
    let bytes: Uint8Array
    if (ref.startsWith('artifact-') && /^[a-f0-9]{64}$/u.test(ref.slice('artifact-'.length))) {
      bytes = await this.#artifacts.get(brand<string, 'ArtifactId'>(ref) as ArtifactId)
    } else {
      bytes = new TextEncoder().encode(ref)
    }
    return {
      contentRef: ref,
      sha256: brand<string, 'Sha256'>(createHash('sha256').update(bytes).digest('hex')),
      tokenEstimate: Math.max(1, Math.ceil(bytes.byteLength / 3.5)),
    }
  }
}
