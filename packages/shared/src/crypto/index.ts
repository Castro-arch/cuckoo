// Server-only entry point (`@cuckoo/shared/crypto`): uses node:crypto, never import from apps/web.
export {
  createKeyring,
  decrypt,
  DecryptionError,
  encrypt,
  parseEncryptionKey,
  type Encrypted,
  type EncryptionKey,
  type Keyring,
} from './aes-gcm.js';
export { decryptEmailJob, encryptEmailMessage } from './email-job.js';
