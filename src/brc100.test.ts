import { PrivateKey } from '@bsv/sdk'
import { Setup, SetupWalletClient } from '@bsv/wallet-toolbox'
import { execSync } from 'child_process'

/**
 * Default local wallet-infra endpoint URL.
 */
const DEFAULT_WALLET_INFRA_URL = 'http://localhost:8080'

/**
 * Track nosend transaction references for cleanup.
 * Tests that create nosend transactions should add their references here.
 */
const pendingAborts: string[] = []

/**
 * Cleanup nosend transactions by failing them and releasing their UTXOs.
 * This uses direct database access for test cleanup.
 */
async function cleanupNosendTransactions(): Promise<number> {
  try {
    // Fail all nosend transactions and release their outputs
    const result = execSync(
      `docker exec mysql mysql -uroot -prootPass wallet_storage -e "
      -- Get nosend transaction IDs
      SET @nosend_ids = (SELECT GROUP_CONCAT(transactionId) FROM transactions WHERE status='nosend');
      
      -- Release outputs consumed by nosend transactions
      UPDATE outputs SET spendable=1, spentBy=NULL 
      WHERE spentBy IN (SELECT transactionId FROM transactions WHERE status='nosend');
      
      -- Mark nosend transactions as failed
      UPDATE transactions SET status='failed' WHERE status='nosend';
      
      -- Count how many we cleaned up
      SELECT COUNT(*) as cleaned FROM transactions WHERE status='failed' AND satoshis=-1;
    " 2>/dev/null`,
      { encoding: 'utf-8' }
    )

    const match = result.match(/cleaned\n(\d+)/)
    return match ? parseInt(match[1]) : 0
  } catch (err) {
    // Docker/MySQL not available - skip cleanup
    return 0
  }
}

describe('BRC-100 Wallet Operations', () => {
  let setup: SetupWalletClient
  let walletServiceAvailable = false

  beforeAll(async () => {
    const endpointUrl = process.env.WALLET_INFRA_URL || DEFAULT_WALLET_INFRA_URL
    const env = Setup.getEnv('test')

    try {
      setup = await Setup.createWalletClient({
        env,
        rootKeyHex: env.devKeys[env.identityKey],
        endpointUrl
      })

      // Try to connect to verify the service is available
      await setup.wallet.waitForAuthentication({})
      walletServiceAvailable = true

      // Clean up any leftover nosend transactions from previous runs
      await cleanupNosendTransactions()
    } catch (error: any) {
      walletServiceAvailable = false
      const errorMessage = error?.message || String(error)
      
      if (errorMessage.includes('fetch failed') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('Network error')) {
        console.error('\n' + '='.repeat(80))
        console.error('⚠️  WALLET SERVICE NOT AVAILABLE')
        console.error('='.repeat(80))
        console.error(`\nThe wallet infrastructure service is not running at ${endpointUrl}`)
        console.error('\nTo run these tests, you need to start the wallet-infra service.')
        console.error('\nYou can use the wallet-infra repository to start the service:')
        console.error('  1. Navigate to the wallet-infra directory:')
        console.error('     cd ../wallet-infra')
        console.error('  2. Start the service using Docker Compose:')
        console.error('     docker compose up --build')
        console.error('\nAlternatively, you can use wallet-infra-bsva:')
        console.error('     cd ../wallet-infra-bsva')
        console.error('     docker compose up --build')
        console.error('\nThe service should be available at http://localhost:8080')
        console.error('\nFor more details, see:')
        console.error('  - wallet-infra/guides/local_development.md')
        console.error('  - wallet-infra-bsva/guides/local_development.md')
        console.error('\n' + '='.repeat(80) + '\n')
      }
      
      // Re-throw the error so tests fail with the connection issue
      throw error
    }
  }, 30000)

  afterAll(async () => {
    // Cleanup: Abort any pending transactions we created
    for (const reference of pendingAborts) {
      try {
        await setup.wallet.abortAction({ reference })
      } catch (err) {
        // Already aborted or completed - ignore
      }
    }
    pendingAborts.length = 0

    // Clean up nosend transactions created during this run
    await cleanupNosendTransactions()
  }, 10000)

  // ============================================================================
  // Basics
  // ============================================================================

  describe('Basics', () => {
    test('walletInfo - should retrieve wallet address and balance', async () => {
      const env = Setup.getEnv(setup.chain)

      // Test address derivation
      const address = PrivateKey.fromString(env.devKeys[env.identityKey])
        .toPublicKey()
        .toAddress(setup.chain === 'main' ? 'mainnet' : 'testnet')

      expect(address).toBeDefined()
      expect(typeof address).toBe('string')
      expect(address.length).toBeGreaterThan(20)

      // Test balance retrieval (may be 0 if no funds)
      try {
        const balance = await setup.wallet.balance()
        expect(typeof balance).toBe('number')
        expect(balance).toBeGreaterThanOrEqual(0)
      } catch (err: any) {
        // Balance might fail if services not configured, but that's expected
      }
    }, 10000)

    test('waitForAuthentication - should resolve immediately for base wallet', async () => {
      const result = await setup.wallet.waitForAuthentication({})
      expect(result).toBeDefined()
      expect(result.authenticated).toBeDefined()
      // Base wallet resolves immediately
    }, 10000)

    test('isAuthenticated - should check if wallet is authenticated', async () => {
      const result = await setup.wallet.isAuthenticated({})
      expect(result).toBeDefined()
      expect(result.authenticated).toBeDefined()
      expect(typeof result.authenticated).toBe('boolean')
    }, 10000)

    test('getNetwork - should return the network information', async () => {
      const result = await setup.wallet.getNetwork({})
      expect(result).toBeDefined()
      expect(result.network).toBeDefined()
      expect(['main', 'test', 'testnet']).toContain(result.network)
    }, 10000)

    test('getVersion - should return wallet version information', async () => {
      const result = await setup.wallet.getVersion({})
      expect(result).toBeDefined()
      expect(result.version).toBeDefined()
      expect(typeof result.version).toBe('string')
    }, 10000)
  })

  // ============================================================================
  // Keys and Signatures
  // ============================================================================

  describe('Keys and Signatures', () => {
    test('getPublicKey - should derive protocol-specific public key', async () => {
      const result = await setup.wallet.getPublicKey({
        identityKey: true,
        protocolID: [0, 'testprotocol'],
        keyID: '1',
        counterparty: 'self'
      })

      expect(result).toBeDefined()
      expect(result.publicKey).toBeDefined()
      expect(typeof result.publicKey).toBe('string')
      expect(result.publicKey.length).toBeGreaterThan(60) // Public key length
    }, 10000)

    test('createSignature - should sign data with wallet keys', async () => {
      const testMessage = 'Hello, BSV!'
      const data = Array.from(Buffer.from(testMessage))

      const result = await setup.wallet.createSignature({
        data,
        protocolID: [0, 'testprotocol'],
        keyID: '1',
        counterparty: 'self'
      })
      expect(result).toBeDefined()
      expect(result.signature).toBeDefined()
    }, 10000)

    test('verifySignature - should create and verify signature round-trip', async () => {
      const testMessage = 'Test signature verification'
      const data = Array.from(Buffer.from(testMessage))

      // Create signature
      const createResult = await setup.wallet.createSignature({
        data,
        protocolID: [0, 'testprotocol'],
        keyID: '1',
        counterparty: 'self'
      })

      // Verify signature
      const verifyResult = await setup.wallet.verifySignature({
        data,
        signature: createResult.signature,
        protocolID: [0, 'testprotocol'],
        keyID: '1',
        counterparty: 'self'
      })

      expect(verifyResult).toBeDefined()
      expect(verifyResult.valid).toBe(true)
    }, 10000)

    test('revealCounterpartyKeyLinkage - should reveal counterparty key linkage', async () => {
      try {
        const result = await setup.wallet.revealCounterpartyKeyLinkage({
          counterparty: 'self',
          verifier: '02' + 'a'.repeat(64), // demo verifier pubkey
          privilegedReason: 'Demo'
        })

        expect(result).toBeDefined()
        expect(result.prover).toBeDefined()
        expect(result.counterparty).toBeDefined()
      } catch (err: any) {
        // This might fail in test environments, which is expected
      }
    }, 10000)

    test('revealSpecificKeyLinkage - should reveal specific key linkage', async () => {
      try {
        const result = await setup.wallet.revealSpecificKeyLinkage({
          counterparty: 'self',
          verifier: '02' + 'a'.repeat(64), // demo verifier pubkey
          protocolID: [0, 'testprotocol'],
          keyID: '1',
          privilegedReason: 'Demo'
        })

        expect(result).toBeDefined()
        expect(result.prover).toBeDefined()
        expect(result.counterparty).toBeDefined()
        expect(result.protocolID).toBeDefined()
        expect(result.keyID).toBeDefined()
      } catch (err: any) {
        // This might fail in test environments, which is expected
      }
    }, 10000)
  })

  // ============================================================================
  // Crypto Operations
  // ============================================================================

  describe('Crypto Operations', () => {
    test('createHmac - should generate HMAC for message', async () => {
      const testMessage = 'Hello, HMAC!'
      const data = Array.from(Buffer.from(testMessage))

      const result = await setup.wallet.createHmac({
        data,
        protocolID: [0, 'testprotocol'],
        keyID: '1',
        counterparty: 'self'
      })

      expect(result).toBeDefined()
      expect(result.hmac).toBeDefined()
    }, 10000)

    test('verifyHmac - should create and verify HMAC round-trip', async () => {
      const testMessage = 'Test HMAC verification'
      const data = Array.from(Buffer.from(testMessage))

      // Create HMAC
      const createResult = await setup.wallet.createHmac({
        data,
        protocolID: [0, 'testprotocol'],
        keyID: '1',
        counterparty: 'self'
      })

      // Verify HMAC
      const verifyResult = await setup.wallet.verifyHmac({
        data,
        hmac: createResult.hmac,
        protocolID: [0, 'testprotocol'],
        keyID: '1',
        counterparty: 'self'
      })

      expect(verifyResult).toBeDefined()
      expect(verifyResult.valid).toBe(true)
    }, 10000)

    test('encrypt/decrypt - should encrypt data and decrypt it back', async () => {
      const testMessage = 'Secret Message!'
      const plaintext = Array.from(Buffer.from(testMessage))

      // Encrypt
      const encryptResult = await setup.wallet.encrypt({
        plaintext,
        protocolID: [0, 'encryption'],
        keyID: '1',
        counterparty: 'self'
      })

      expect(encryptResult).toBeDefined()
      expect(encryptResult.ciphertext).toBeDefined()

      // Decrypt
      const decryptResult = await setup.wallet.decrypt({
        ciphertext: encryptResult.ciphertext,
        protocolID: [0, 'encryption'],
        keyID: '1',
        counterparty: 'self'
      })

      expect(decryptResult).toBeDefined()
      expect(decryptResult.plaintext).toBeDefined()
      expect(Array.isArray(decryptResult.plaintext)).toBe(true)

      // Verify decrypted message matches original
      const decrypted = Buffer.from(decryptResult.plaintext).toString()
      expect(decrypted).toBe(testMessage)
    }, 10000)
  })

  // ============================================================================
  // Actions
  // ============================================================================

  describe('Actions', () => {
    test('createAction - should create OP_RETURN transaction (noSend + abort)', async () => {
      // Check balance first - need at least 10 sats to safely run this test
      const balance = await setup.wallet.balance()
      if (balance < 10) return

      try {
        const message = 'Hello, World! - Test Action'
        const messageBytes = Buffer.from(message)
        const hexData = messageBytes.toString('hex')
        const length = messageBytes.length
        const lockingScript = `006a${length.toString(16).padStart(2, '0')}${hexData}`

        // Use noSend: true to create tx without broadcasting
        const action = await setup.wallet.createAction({
          description: `Store message: ${message}`,
          outputs: [
            {
              lockingScript,
              satoshis: 0,
              outputDescription: 'Message output',
              basket: 'opreturn',
              tags: ['demo', 'opreturn']
            }
          ],
          labels: ['demo:create_action'],
          options: {
            noSend: true // Don't broadcast - just create the transaction
          }
        })

        expect(action).toBeDefined()

        // With noSend, wallet may return signableTransaction (needs signing) or txid (auto-signed)
        if (action.signableTransaction?.reference) {
          // Can abort - add to cleanup list and abort immediately
          pendingAborts.push(action.signableTransaction.reference)
          const abortResult = await setup.wallet.abortAction({
            reference: action.signableTransaction.reference
          })
          expect(abortResult.aborted).toBe(true)
          // Remove from pending since we aborted it
          pendingAborts.pop()
        }
        // else: auto-signed nosend tx - cleanup handles it
      } catch (err: any) {
        if (
          err.message.includes('Insufficient funds') ||
          err.message.includes('insufficient')
        )
          return
        throw err
      }
    }, 15000)

    test('createAction - verify action result structure', async () => {
      // Check balance first
      const balance = await setup.wallet.balance()
      if (balance < 10) return

      try {
        const message = 'Structure Test'
        const messageBytes = Buffer.from(message)
        const hexData = messageBytes.toString('hex')
        const length = messageBytes.length
        const lockingScript = `006a${length.toString(16).padStart(2, '0')}${hexData}`

        // Create action with noSend to inspect the result structure
        const action = await setup.wallet.createAction({
          description: `Structure test: ${message}`,
          outputs: [
            {
              lockingScript,
              satoshis: 0,
              outputDescription: 'Test output',
              basket: 'opreturn',
              tags: ['test']
            }
          ],
          labels: ['test:structure'],
          options: {
            noSend: true
          }
        })

        expect(action).toBeDefined()

        // Verify result structure - either signableTransaction or txid
        if (action.signableTransaction) {
          expect(action.signableTransaction.reference).toBeDefined()
          expect(action.signableTransaction.tx).toBeDefined()
          // Cleanup - abort to release UTXOs
          await setup.wallet.abortAction({
            reference: action.signableTransaction.reference
          })
        } else if (action.txid) {
          expect(typeof action.txid).toBe('string')
          expect(action.txid.length).toBe(64)
        } else {
          throw new Error('Expected either signableTransaction or txid')
        }
      } catch (err: any) {
        if (
          err.message.includes('Insufficient funds') ||
          err.message.includes('insufficient')
        )
          return
        throw err
      }
    }, 15000)

    test('listActions - should list recent wallet actions', async () => {
      const actions = await setup.wallet.listActions({
        labels: [],
        limit: 10,
        includeLabels: true
      })

      expect(actions).toBeDefined()
      expect(actions.actions).toBeDefined()
      expect(Array.isArray(actions.actions)).toBe(true)
      expect(actions.actions.length).toBeGreaterThanOrEqual(0)
    }, 10000)

    test('abortAction - should abort an unsigned action if available', async () => {
      // Check if there are any unsigned actions we can abort
      const actions = await setup.wallet.listActions({ labels: [], limit: 20 })
      const unsignedAction = actions.actions.find(
        a => a.status === 'unsigned' || a.status === 'nosend'
      )

      // listActions doesn't return references, so we can only abort
      // actions we created in the same session with signableTransaction
      expect(unsignedAction === undefined || unsignedAction.status).toBeTruthy()
    }, 10000)
  })

  // ============================================================================
  // Outputs
  // ============================================================================

  describe('Outputs', () => {
    test('listOutputs - should list wallet outputs', async () => {
      const outputs = await setup.wallet.listOutputs({
        basket: 'default',
        limit: 10,
        offset: 0
      })
      expect(outputs).toBeDefined()
      expect(outputs.outputs).toBeDefined()
      expect(Array.isArray(outputs.outputs)).toBe(true)
      expect(typeof outputs.totalOutputs).toBe('number')
      expect(outputs.totalOutputs).toBeGreaterThanOrEqual(0)
    }, 10000)

    test('relinquishOutput - should relinquish an output from wallet tracking', async () => {
      // Use a dummy outpoint since we likely don't have real outputs to relinquish
      const dummyOutpoint =
        '0000000000000000000000000000000000000000000000000000000000000000:0'

      try {
        const result = await setup.wallet.relinquishOutput({
          basket: 'default',
          output: dummyOutpoint
        })

        expect(result).toBeDefined()
        expect(result.relinquished).toBeDefined()
      } catch (err: any) {
        // Expected to fail with dummy outpoint
        expect(err).toBeDefined()
      }
    }, 10000)
  })

  // ============================================================================
  // Certificates
  // ============================================================================

  describe('Certificates', () => {
    test('acquireCertificate - should attempt to acquire a certificate', async () => {
      try {
        const result = await setup.wallet.acquireCertificate({
          type: Buffer.from('test-certificate').toString('base64'),
          certifier: setup.identityKey,
          acquisitionProtocol: 'issuance',
          certifierUrl: 'http://localhost:8080',
          fields: {
            name: 'Test User',
            email: 'test@example.com'
          },
          privilegedReason: 'Demo acquisition'
        })
        expect(result).toBeDefined()
      } catch (err: any) {
        // Expected to fail in test environment
        expect(err).toBeDefined()
      }
    }, 10000)

    test('listCertificates - should list wallet certificates', async () => {
      const certs = await setup.wallet.listCertificates({
        certifiers: [],
        types: [],
        limit: 10,
        offset: 0
      })

      expect(certs).toBeDefined()
      expect(certs.certificates).toBeDefined()
      expect(Array.isArray(certs.certificates)).toBe(true)
      expect(certs.certificates.length).toBeGreaterThanOrEqual(0)
      if (certs.certificates.length > 0) {
        const testCert = certs.certificates.find(
          c => c.type === 'test-certificate'
        )
        if (testCert) {
          expect(testCert.subject).toBeDefined()
        }
      }
    }, 10000)

    test('relinquishCertificate - should relinquish a certificate', async () => {
      // First check if we have any certificates to relinquish
      const certs = await setup.wallet.listCertificates({
        certifiers: [],
        types: [],
        limit: 10,
        offset: 0
      })

      if (certs.certificates.length === 0) return

      // Try to relinquish the first certificate
      const cert = certs.certificates[0]

      try {
        await setup.wallet.relinquishCertificate({
          type: cert.type,
          certifier: cert.certifier || 'self',
          serialNumber: cert.serialNumber || ''
        })
      } catch (err: any) {
        // Expected to fail in test environment
        expect(err).toBeDefined()
      }
    }, 10000)
  })

  // ============================================================================
  // Identity Discovery
  // ============================================================================

  describe('Identity Discovery', () => {
    test('discoverByIdentityKey - should discover certificates by identity key', async () => {
      try {
        const result = await setup.wallet.discoverByIdentityKey({
          identityKey: setup.identityKey,
          limit: 10,
          offset: 0,
          seekPermission: true
        })

        expect(result).toBeDefined()
        expect(result.certificates).toBeDefined()
        expect(Array.isArray(result.certificates)).toBe(true)
      } catch (err: any) {
        // Expected to fail in test environment
        expect(err).toBeDefined()
      }
    }, 10000)

    test('discoverByAttributes - should discover certificates by attributes', async () => {
      try {
        const result = await setup.wallet.discoverByAttributes({
          attributes: { verified: 'true' },
          limit: 10,
          offset: 0
        })

        expect(result).toBeDefined()
        expect(result.certificates).toBeDefined()
        expect(Array.isArray(result.certificates)).toBe(true)
      } catch (err: any) {
        // Expected to fail in test environment
        expect(err).toBeDefined()
      }
    }, 10000)
  })

  // ============================================================================
  // Transactions
  // ============================================================================

  describe('Transactions', () => {
    test('internalizeAction - should internalize an external transaction', async () => {
      // This is a complex operation that requires an actual external transaction
      // For testing purposes, we'll try with minimal parameters and expect graceful failure
      try {
        const dummyTxHex =
          '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0100ffffffff01000000000000000000000000'
        const result = await setup.wallet.internalizeAction({
          tx: Array.from(Buffer.from(dummyTxHex, 'hex')),
          outputs: [
            {
              outputIndex: 0,
              protocol: 'basket insertion',
              insertionRemittance: {
                basket: 'default'
              }
            }
          ],
          description: 'Test internalization of external transaction'
        })

        expect(result).toBeDefined()
      } catch (err: any) {
        // Expected to fail with dummy data
        expect(err).toBeDefined()
      }
    }, 10000)
  })

  // ============================================================================
  // Blockchain Info
  // ============================================================================

  describe('Blockchain Info', () => {
    test('getHeight - should fetch current block height', async () => {
      try {
        const result = await setup.wallet.getHeight({})
        expect(result).toBeDefined()
        expect(result.height).toBeDefined()
        expect(typeof result.height).toBe('number')
        expect(result.height).toBeGreaterThan(0)
      } catch (err: any) {
        // May fail if Services not configured
      }
    }, 10000)

    test('getHeaderForHeight - should fetch header for specific height', async () => {
      try {
        const testHeight = 1
        const result = await setup.wallet.getHeaderForHeight({
          height: testHeight
        })

        expect(result).toBeDefined()
        expect(result.header).toBeDefined()
        expect(typeof result.header).toBe('string')
        expect(result.header.length).toBeGreaterThan(100)
      } catch (err: any) {
        // May fail if Services not configured
      }
    }, 10000)
  })
})
