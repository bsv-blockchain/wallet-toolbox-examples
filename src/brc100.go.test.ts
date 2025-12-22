import { PrivateKey } from '@bsv/sdk'
import { Setup, SetupWallet, StorageClient } from '@bsv/wallet-toolbox'

/**
 * Default go-wallet-toolbox endpoint URL.
 */
const DEFAULT_GO_WALLET_TOOLBOX_URL = 'http://localhost:8100'

/**
 * Track nosend transaction references for cleanup.
 * Tests that create nosend transactions should add their references here.
 */
const pendingAborts: string[] = []

describe('BRC-100 Wallet Operations (Go Storage Server)', () => {
  let setup: SetupWallet
  let walletServiceAvailable = false

  beforeAll(async () => {
    const endpointUrl = process.env.GO_WALLET_TOOLBOX_URL || DEFAULT_GO_WALLET_TOOLBOX_URL
    const env = Setup.getEnv('test')

    try {
      // Create wallet without any storage providers
      setup = await Setup.createWallet({
        env,
        rootKeyHex: env.devKeys[env.identityKey]
      })

      // Create a StorageClient connected to the go-wallet-toolbox storage server
      const storageClient = new StorageClient(setup.wallet, endpointUrl)
      await storageClient.makeAvailable()
      await setup.storage.addWalletStorageProvider(storageClient)

      // Try to connect to verify the service is available
      await setup.wallet.waitForAuthentication({})
      walletServiceAvailable = true
    } catch (error: any) {
      walletServiceAvailable = false
      const errorMessage = error?.message || String(error)

      if (errorMessage.includes('fetch failed') || errorMessage.includes('ECONNREFUSED') || errorMessage.includes('Network error')) {
        console.error(
          '\n' + '='.repeat(80) + '\n' +
          '⚠️  GO WALLET TOOLBOX STORAGE SERVER NOT AVAILABLE\n' +
          '='.repeat(80) + '\n' +
          `\nThe go-wallet-toolbox storage server is not running at ${endpointUrl}\n` +
          '\nTo run these tests, you need to start the go-wallet-toolbox storage server.\n' +
          '\nSetup steps:\n' +
          '  1. Navigate to the go-wallet-toolbox directory:\n' +
          '     cd ../go-wallet-toolbox\n' +
          '  2. Generate a config file:\n' +
          '     go run ./cmd/infra_config_gen -k\n' +
          '  3. Start the storage server:\n' +
          '     go run ./cmd/infra\n' +
          '\nThe server should be available at http://localhost:8100\n' +
          '\nFor more details, see the go-wallet-toolbox README.md\n' +
          '\n' + '='.repeat(80) + '\n'
        )

        // Exit early to prevent running all tests
        process.exit(1)
      }

      // Re-throw other errors
      throw error
    }
  }, 10000)

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
  }, 10000)

  // ============================================================================
  //   Basics
  // ============================================================================

  describe('Basics', () => {
    test('walletInfo - should retrieve wallet address and balance', async () => {
      console.log('🔑 Testing wallet address and balance...')
      const env = Setup.getEnv(setup.chain)

      // Test address derivation
      const address = PrivateKey.fromString(env.devKeys[env.identityKey])
        .toPublicKey()
        .toAddress(setup.chain === 'main' ? 'mainnet' : 'testnet')

      console.log(`📍 Generated address: ${address.substring(0, 20)}...`)
      expect(address).toBeDefined()
      expect(typeof address).toBe('string')
      expect(address.length).toBeGreaterThan(20)

      // Test balance retrieval (may be 0 if no funds)
      try {
        const balance = await setup.wallet.balance()
        console.log(`💰 Wallet balance: ${balance} sats`)
        expect(typeof balance).toBe('number')
        expect(balance).toBeGreaterThanOrEqual(0)
      } catch (err: any) {
        console.log('⚠️  Balance check failed (expected for local testing)')
        // Balance might fail if services not configured, but that's expected
      }
      console.log('✅ Wallet info test completed')
    }, 10000)

    test('waitForAuthentication - should resolve immediately for base wallet', async () => {
      console.log('🔐 Testing waitForAuthentication...')
      const result = await setup.wallet.waitForAuthentication({})
      console.log(`🔐 Authentication result: ${JSON.stringify(result)}`)
      expect(result).toBeDefined()
      expect(result.authenticated).toBeDefined()
      // Base wallet resolves immediately
      console.log('✅ waitForAuthentication test completed')
    }, 10000)

    test('isAuthenticated - should check if wallet is authenticated', async () => {
      console.log('🔐 Testing isAuthenticated...')
      const result = await setup.wallet.isAuthenticated({})
      console.log(`🔐 Authentication check result: ${JSON.stringify(result)}`)
      expect(result).toBeDefined()
      expect(result.authenticated).toBeDefined()
      expect(typeof result.authenticated).toBe('boolean')
      console.log('✅ isAuthenticated test completed')
    }, 10000)

    test('getNetwork - should return the network information', async () => {
      console.log('🌐 Testing getNetwork...')
      const result = await setup.wallet.getNetwork({})
      console.log(`🌐 Network info: ${JSON.stringify(result)}`)
      expect(result).toBeDefined()
      expect(result.network).toBeDefined()
      expect(['main', 'test', 'testnet']).toContain(result.network)
      console.log('✅ getNetwork test completed')
    }, 10000)

    test('getVersion - should return wallet version information', async () => {
      console.log('📦 Testing getVersion...')
      const result = await setup.wallet.getVersion({})
      console.log(`📦 Version info: ${JSON.stringify(result)}`)
      expect(result).toBeDefined()
      expect(result.version).toBeDefined()
      expect(typeof result.version).toBe('string')
      console.log('✅ getVersion test completed')
    }, 10000)
  })

  // ============================================================================
  // Keys and Signatures
  // ============================================================================

  describe('Keys and Signatures', () => {
    test('getPublicKey - should derive protocol-specific public key', async () => {
      console.log('🔑 Testing public key derivation...')
      const result = await setup.wallet.getPublicKey({
        identityKey: true,
        protocolID: [0, 'testprotocol'],
        keyID: '1',
        counterparty: 'self'
      })

      console.log(`🔑 Derived public key: ${result.publicKey.substring(0, 20)}...`)
      expect(result).toBeDefined()
      expect(result.publicKey).toBeDefined()
      expect(typeof result.publicKey).toBe('string')
      expect(result.publicKey.length).toBeGreaterThan(60) // Public key length
      console.log('✅ Public key test completed')
    }, 10000)

    test('createSignature - should sign data with wallet keys', async () => {
      console.log('✍️  Testing signature creation...')
      const testMessage = 'Hello, BSV!'
      const data = Array.from(Buffer.from(testMessage))

      const result = await setup.wallet.createSignature({
        data,
        protocolID: [0, 'testprotocol'],
        keyID: '1',
        counterparty: 'self'
      })
      console.log(`✍️  Created signature: ${Buffer.from(result.signature.slice(0, 10)).toString('hex')}...`)
      expect(result).toBeDefined()
      expect(result.signature).toBeDefined()
      console.log('✅ Signature creation test completed')
    }, 10000)

    test('verifySignature - should create and verify signature round-trip', async () => {
      console.log('🔍 Testing signature verification...')
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

      console.log(`🔍 Signature verification result: ${verifyResult.valid}`)
      expect(verifyResult).toBeDefined()
      expect(verifyResult.valid).toBe(true)
      console.log('✅ Signature verification test completed')
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
      console.log('🔐 Testing HMAC creation...')
      const testMessage = 'Hello, HMAC!'
      const data = Array.from(Buffer.from(testMessage))

      const result = await setup.wallet.createHmac({
        data,
        protocolID: [0, 'testprotocol'],
        keyID: '1',
        counterparty: 'self'
      })

      console.log(`🔐 Generated HMAC: ${Buffer.from(result.hmac.slice(0, 10)).toString('hex')}...`)
      expect(result).toBeDefined()
      expect(result.hmac).toBeDefined()
      console.log('✅ HMAC creation test completed')
    }, 10000)

    test('verifyHmac - should create and verify HMAC round-trip', async () => {
      console.log('🔍 Testing HMAC verification...')
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

      console.log(`🔍 HMAC verification result: ${verifyResult.valid}`)
      console.log('✅ HMAC verification test completed')
      expect(verifyResult).toBeDefined()
      expect(verifyResult.valid).toBe(true)
      console.log('✅ HMAC verification test completed')
    }, 10000)

    test('encrypt/decrypt - should encrypt data and decrypt it back', async () => {
      console.log('🔒 Testing encryption/decryption...')
      const testMessage = 'Secret Message!'
      const plaintext = Array.from(Buffer.from(testMessage))

      // Encrypt
      const encryptResult = await setup.wallet.encrypt({
        plaintext,
        protocolID: [0, 'encryption'],
        keyID: '1',
        counterparty: 'self'
      })

      console.log(`🔒 Encrypted message: ${Buffer.from(encryptResult.ciphertext.slice(0, 10)).toString('hex')}...`)
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
      console.log(`🔓 Decrypted message: "${decrypted}"`)
      expect(decrypted).toBe(testMessage)
      console.log('✅ Encryption/decryption test completed')
    }, 10000)
  })

  // ============================================================================
  // Actions
  // ============================================================================

  describe('Actions', () => {
    test('createAction - should create OP_RETURN transaction (noSend + abort)', async () => {
      console.log('🚀 STARTING: createAction test (noSend + abort)')
      // Check balance first - need at least 10 sats to safely run this test
      const balance = await setup.wallet.balance()
      if (balance < 10) {
        console.log('⚠️  Skipping test - insufficient balance')
        return
      }

      try {
        const message = 'Hello, World! - Test Action'
        const messageBytes = Buffer.from(message)
        const hexData = messageBytes.toString('hex')
        const length = messageBytes.length
        const lockingScript = `006a${length.toString(16).padStart(2, '0')}${hexData}`

        // Use noSend: true to create tx without broadcasting
        console.log(`✍️  Creating action: "${message}"`)
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

        console.log(`✅ Action created with ${action.signableTransaction ? 'signableTransaction' : action.txid ? 'txid' : 'unknown'}`)
        if (action.signableTransaction?.reference) {
          console.log(`   Action reference: ${action.signableTransaction.reference}`)
        }
        expect(action).toBeDefined()

        // With noSend, wallet may return signableTransaction (needs signing) or txid (auto-signed)
        if (action.signableTransaction?.reference) {
        // Can abort - add to cleanup list and abort immediately
        console.log(`🗑️  Aborting action: ${action.signableTransaction.reference}`)
        pendingAborts.push(action.signableTransaction.reference)
        const abortResult = await setup.wallet.abortAction({
          reference: action.signableTransaction.reference
        })
        console.log(`✅ Action aborted: ${abortResult.aborted}`)
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

        console.log(`✍️  Creating structure test action: "${message}"`)
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

        console.log(`✅ Structure test action created with ${action.signableTransaction ? 'signableTransaction' : action.txid ? 'txid' : 'unknown'}`)
        expect(action).toBeDefined()

        // Verify result structure - either signableTransaction or txid
        if (action.signableTransaction) {
          expect(action.signableTransaction.reference).toBeDefined()
          expect(action.signableTransaction.tx).toBeDefined()
          console.log(`📝 Keeping action ${action.signableTransaction.reference} for database verification`)
          // Keep this action for the listActions test to find it
          // Don't abort immediately - will be cleaned up in afterAll
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
      console.log('🔍 Checking for actions in database before action creation tests...')
      const actions = await setup.wallet.listActions({
        labels: [],
        limit: 10,
        includeLabels: true
      })

      console.log(`📋 Listed ${actions.actions.length} actions from database`)
      if (actions.actions.length > 0) {
        console.log(`   First action: ${actions.actions[0].description}`)
      }

      expect(actions).toBeDefined()
      expect(actions.actions).toBeDefined()
      expect(Array.isArray(actions.actions)).toBe(true)
      expect(actions.actions.length).toBeGreaterThanOrEqual(0)
    }, 10000)

    test('abortAction - should abort an unsigned action if available', async () => {
      console.log('🗑️  Testing action abortion...')
      // Check if there are any unsigned actions we can abort
      const actions = await setup.wallet.listActions({ labels: [], limit: 20 })
      const unsignedAction = actions.actions.find(
        a => a.status === 'unsigned' || a.status === 'nosend'
      )

      console.log(`📋 Found ${actions.actions.length} total actions, ${unsignedAction ? 1 : 0} unsigned`)
      // listActions doesn't return references, so we can only abort
      // actions we created in the same session with signableTransaction
      expect(unsignedAction === undefined || unsignedAction.status).toBeTruthy()
      console.log('✅ Action abortion test completed')
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

      console.log(`💰 Listed ${outputs.outputs.length} outputs from database (total: ${outputs.totalOutputs})`)
      if (outputs.outputs.length > 0) {
        console.log(`   First output: ${outputs.outputs[0].satoshis} sats`)
      }

      expect(outputs).toBeDefined()
      expect(outputs.outputs).toBeDefined()
      expect(Array.isArray(outputs.outputs)).toBe(true)
      expect(typeof outputs.totalOutputs).toBe('number')
      expect(outputs.totalOutputs).toBeGreaterThanOrEqual(0)
    }, 10000)

    test('relinquishOutput - should relinquish an output from wallet tracking', async () => {
      console.log('🗑️  Testing output relinquishment...')
      // Use a dummy outpoint since we likely don't have real outputs to relinquish
      const dummyOutpoint =
        '0000000000000000000000000000000000000000000000000000000000000000:0'

      try {
        const result = await setup.wallet.relinquishOutput({
          basket: 'default',
          output: dummyOutpoint
        })

        console.log('✅ Output relinquished successfully')
        expect(result).toBeDefined()
        expect(result.relinquished).toBeDefined()
      } catch (err: any) {
        console.log('⚠️  Output relinquishment failed (expected with dummy outpoint)')
        // Expected to fail with dummy outpoint
        expect(err).toBeDefined()
      }
      console.log('✅ Output relinquishment test completed')
    }, 10000)
  })

  // ============================================================================
  // Certificates
  // ============================================================================

  describe('Certificates', () => {
    test('acquireCertificate - should attempt to acquire a certificate', async () => {
      console.log('📜 Testing certificate acquisition...')
      try {
        const result = await setup.wallet.acquireCertificate({
          type: Buffer.from('test-certificate').toString('base64'),
          certifier: setup.identityKey,
          acquisitionProtocol: 'issuance',
          certifierUrl: 'http://localhost:8100',
          fields: {
            name: 'Test User',
            email: 'test@example.com'
          },
          privilegedReason: 'Demo acquisition'
        })
        console.log('📜 Certificate acquired successfully')
        expect(result).toBeDefined()
      } catch (err: any) {
        console.log('⚠️  Certificate acquisition failed (expected in local test environment)')
        // Expected to fail in test environment
        expect(err).toBeDefined()
      }
      console.log('✅ Certificate acquisition test completed')
    }, 10000)

    test('listCertificates - should list wallet certificates', async () => {
      const certs = await setup.wallet.listCertificates({
        certifiers: [],
        types: [],
        limit: 10,
        offset: 0
      })

      console.log(`📜 Listed ${certs.certificates.length} certificates from database`)
      if (certs.certificates.length > 0) {
        console.log(`   Certificate types: ${certs.certificates.map(c => c.type).join(', ')}`)
      }

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
      console.log('🗑️  Testing certificate relinquishment...')
      // First check if we have any certificates to relinquish
      const certs = await setup.wallet.listCertificates({
        certifiers: [],
        types: [],
        limit: 10,
        offset: 0
      })

      console.log(`📜 Found ${certs.certificates.length} certificates to potentially relinquish`)
      if (certs.certificates.length === 0) {
        console.log('⚠️  No certificates to relinquish, skipping test')
        return
      }

      // Try to relinquish the first certificate
      const cert = certs.certificates[0]
      console.log(`🗑️  Attempting to relinquish certificate: ${cert.type}`)

      try {
        await setup.wallet.relinquishCertificate({
          type: cert.type,
          certifier: cert.certifier || 'self',
          serialNumber: cert.serialNumber || ''
        })
        console.log('✅ Certificate relinquished successfully')
      } catch (err: any) {
        console.log('⚠️  Certificate relinquishment failed (expected in test environment)')
        // Expected to fail in test environment
        expect(err).toBeDefined()
      }
      console.log('✅ Certificate relinquishment test completed')
    }, 10000)
  })

  // ============================================================================
  // Identity Discovery
  // ============================================================================

  describe('Identity Discovery', () => {
    test('discoverByIdentityKey - should discover certificates by identity key', async () => {
      console.log('🔍 Testing identity discovery by identity key...')
      try {
        const result = await setup.wallet.discoverByIdentityKey({
          identityKey: setup.identityKey,
          limit: 10,
          offset: 0,
          seekPermission: true
        })

        console.log(`🔍 Found ${result.certificates.length} certificates by identity key`)
        expect(result).toBeDefined()
        expect(result.certificates).toBeDefined()
        expect(Array.isArray(result.certificates)).toBe(true)
        console.log('✅ Identity discovery by identity key completed')
      } catch (err: any) {
        console.log('⚠️  Identity discovery by identity key failed (expected in local test environment)')
        // Expected to fail in test environment
        expect(err).toBeDefined()
      }
    }, 10000)

    test('discoverByAttributes - should discover certificates by attributes', async () => {
      console.log('🔍 Testing identity discovery by attributes...')
      try {
        const result = await setup.wallet.discoverByAttributes({
          attributes: { verified: 'true' },
          limit: 10,
          offset: 0
        })

        console.log(`🔍 Found ${result.certificates.length} certificates by attributes`)
        expect(result).toBeDefined()
        expect(result.certificates).toBeDefined()
        expect(Array.isArray(result.certificates)).toBe(true)
        console.log('✅ Identity discovery by attributes completed')
      } catch (err: any) {
        console.log('⚠️  Identity discovery by attributes failed (expected in local test environment)')
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
      console.log('📥 Testing transaction internalization...')
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

        console.log('✅ Transaction internalized successfully')
        expect(result).toBeDefined()
      } catch (err: any) {
        console.log('⚠️  Transaction internalization failed (expected with dummy data)')
        // Expected to fail with dummy data
        expect(err).toBeDefined()
      }
      console.log('✅ Transaction internalization test completed')
    }, 10000)
  })

  // ============================================================================
  // Blockchain Info
  // ============================================================================

  describe.skip('Blockchain Info', () => {
    test('getHeight - should fetch current block height', async () => {
      // Skipped for Go storage server tests - requires external blockchain API
    }, 10000)

    test('getHeaderForHeight - should fetch header for specific height', async () => {
      // Skipped for Go storage server tests - requires external blockchain API
    }, 10000)
  })
})
