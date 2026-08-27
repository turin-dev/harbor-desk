import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export interface SecretStore {
  put(value: string): Promise<string>;
  get(reference: string): Promise<string | undefined>;
  delete(reference: string): Promise<void>;
}

interface EncryptedSecret {
  iv: string;
  tag: string;
  value: string;
}

export class MemoryEncryptedSecretStore implements SecretStore {
  private readonly secrets = new Map<string, EncryptedSecret>();
  private readonly key: Buffer;

  constructor(masterKey?: string) {
    this.key = masterKey
      ? createHash("sha256").update(masterKey).digest()
      : randomBytes(32);
  }

  public async put(value: string): Promise<string> {
    const reference = `secret_${randomBytes(18).toString("hex")}`;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    this.secrets.set(reference, {
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      value: encrypted.toString("base64url"),
    });
    return reference;
  }

  public async get(reference: string): Promise<string | undefined> {
    const stored = this.secrets.get(reference);
    if (!stored) return undefined;

    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(stored.iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(stored.tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(stored.value, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  public async delete(reference: string): Promise<void> {
    this.secrets.delete(reference);
  }
}
