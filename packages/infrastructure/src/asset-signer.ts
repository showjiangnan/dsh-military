import {
  createHash,
  generateKeyPairSync,
  randomUUID,
  sign as signBytes,
  verify as verifyBytes,
} from 'node:crypto'
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  MilitaryError,
  brand,
  type AssetSignatureReceipt,
  type MilitaryAssetSigner,
} from '@dsh-military/contracts'
import { cloneFrozen, sha256 } from '@dsh-military/core'

interface SigningKeyManifest {
  readonly schemaVersion: '1.0.0'
  readonly keyId: string
  readonly createdAt: string
}

/**
 * Durable local Ed25519 signer. The private key is a mode-0600 deployment
 * secret; external deployments can replace this service with a KMS/HSM signer
 * through MilitaryAssetSigner.
 */
export class LocalEd25519AssetSigner implements MilitaryAssetSigner {
  readonly #root: string
  #initialization: Promise<SigningKeyManifest> | null = null
  #writeTail: Promise<void> = Promise.resolve()

  constructor(root: string) {
    this.#root = root
  }

  async sign(payload: Uint8Array): Promise<AssetSignatureReceipt> {
    const active = await this.#active()
    const privateKey = await readFile(this.#privateKeyPath(active.keyId), 'utf8')
    return cloneFrozen({
      schemaVersion: '1.0.0',
      keyId: active.keyId,
      algorithm: 'Ed25519',
      payloadSha256: sha256(payload),
      signature: signBytes(null, payload, privateKey).toString('base64'),
      signedAt: brand<string, 'IsoDateTime'>(new Date().toISOString()),
    })
  }

  async verify(
    payload: Uint8Array,
    receipt: AssetSignatureReceipt,
  ): Promise<boolean> {
    if (
      receipt.algorithm !== 'Ed25519'
      || receipt.payloadSha256 !== sha256(payload)
    ) return false
    let publicKey: string
    try {
      publicKey = await this.publicKey(receipt.keyId)
    } catch {
      return false
    }
    return verifyBytes(
      null,
      payload,
      publicKey,
      Buffer.from(receipt.signature, 'base64'),
    )
  }

  async publicKey(keyId: string): Promise<string> {
    if (!/^local-ed25519-[a-f0-9]{24}$/u.test(keyId)) {
      throw new MilitaryError('INVALID_ARGUMENT', 'invalid signing key id')
    }
    try {
      return await readFile(this.#publicKeyPath(keyId), 'utf8')
    } catch (error) {
      throw new MilitaryError(
        'NOT_FOUND',
        `signing key ${keyId} is not available`,
        undefined,
        { cause: error },
      )
    }
  }

  /** Rotate future signatures while retaining old public keys for verification. */
  async rotate(): Promise<string> {
    return await this.#serialize(async () => {
      await this.#active()
      const created = await this.#create()
      await this.#atomicWrite(
        this.#activePath(),
        new TextEncoder().encode(JSON.stringify(created, null, 2)),
        0o600,
      )
      this.#initialization = Promise.resolve(created)
      return created.keyId
    })
  }

  async #active(): Promise<SigningKeyManifest> {
    if (this.#initialization !== null) return await this.#initialization
    this.#initialization = this.#loadOrCreate()
    try {
      return await this.#initialization
    } catch (error) {
      this.#initialization = null
      throw error
    }
  }

  async #loadOrCreate(): Promise<SigningKeyManifest> {
    try {
      const value = JSON.parse(
        await readFile(this.#activePath(), 'utf8'),
      ) as SigningKeyManifest
      if (
        value.schemaVersion !== '1.0.0'
        || !/^local-ed25519-[a-f0-9]{24}$/u.test(value.keyId)
      ) throw new Error('invalid signing key manifest')
      return value
    } catch (error) {
      if (error instanceof SyntaxError
        || (error instanceof Error
          && error.message === 'invalid signing key manifest')) {
        throw new MilitaryError(
          'PERSISTENCE_FAILED',
          'local signing key manifest is invalid',
          undefined,
          { cause: error },
        )
      }
      if (!isMissingFile(error)) {
        throw new MilitaryError(
          'PERSISTENCE_FAILED',
          'local signing key manifest cannot be read',
          undefined,
          { cause: error },
        )
      }
      const created = await this.#create()
      await this.#atomicWrite(
        this.#activePath(),
        new TextEncoder().encode(JSON.stringify(created, null, 2)),
        0o600,
      )
      return created
    }
  }

  async #create(): Promise<SigningKeyManifest> {
    const keys = generateKeyPairSync('ed25519')
    const publicKey = keys.publicKey.export({
      type: 'spki',
      format: 'pem',
    }).toString()
    const privateKey = keys.privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }).toString()
    const keyId = `local-ed25519-${createHash('sha256')
      .update(publicKey)
      .digest('hex')
      .slice(0, 24)}`
    await this.#atomicWrite(
      this.#privateKeyPath(keyId),
      new TextEncoder().encode(privateKey),
      0o600,
    )
    await this.#atomicWrite(
      this.#publicKeyPath(keyId),
      new TextEncoder().encode(publicKey),
      0o644,
    )
    return {
      schemaVersion: '1.0.0',
      keyId,
      createdAt: new Date().toISOString(),
    }
  }

  async #atomicWrite(
    path: string,
    bytes: Uint8Array,
    mode: number,
  ): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`
    try {
      await writeFile(temporary, bytes, { mode })
      await rename(temporary, path)
    } finally {
      await unlink(temporary).catch(error => {
        if (!isMissingFile(error)) throw error
      })
    }
  }

  async #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#writeTail
    let release!: () => void
    this.#writeTail = new Promise<void>(resolve => { release = resolve })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  #activePath(): string {
    return join(this.#root, 'active.json')
  }

  #privateKeyPath(keyId: string): string {
    return join(this.#root, `${keyId}.private.pem`)
  }

  #publicKeyPath(keyId: string): string {
    return join(this.#root, `${keyId}.public.pem`)
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT'
}
