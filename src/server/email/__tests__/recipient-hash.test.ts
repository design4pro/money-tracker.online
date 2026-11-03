/**
 * Recipient hashing: the only form of an address the delivery store may keep.
 *
 * The vector is independent of this module — `openssl dgst -sha256 -hmac` over the folded
 * address — so a wrong algorithm, a missing fold, or hex vs base64 cannot pass by construction.
 */

import { describe, expect, it } from 'vitest'

import { hashRecipient } from '../recipient-hash'

const SALT = 'test-salt-never-rotate'

/** `printf '%s' 'anna@example.com' | openssl dgst -sha256 -hmac 'test-salt-never-rotate' -hex` */
const ANNA = '5c61ac76183065bb12f30b4de274deaea784de00f1bec3bd8f4530b1d2ce7a47'

describe('hashRecipient', () => {
  it('matches a known HMAC-SHA-256 hex vector', async () => {
    await expect(hashRecipient('anna@example.com', SALT)).resolves.toBe(ANNA)
  })

  it('folds case and surrounding whitespace before hashing', async () => {
    await expect(hashRecipient('  Anna@Example.COM  ', SALT)).resolves.toBe(
      ANNA,
    )
  })

  it('does not equal the un-folded HMAC of the raw input', async () => {
    // Same openssl invocation over the untrimmed mixed-case string: a missing fold would
    // produce this, and must not be what we store.
    await expect(hashRecipient('  Anna@Example.COM  ', SALT)).resolves.not.toBe(
      'c5f127a65675c4dbcc73ad226ae263f7b85504aa09e60cf603dc29969da8d29f',
    )
  })
})
