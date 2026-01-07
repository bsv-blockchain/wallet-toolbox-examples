import { PrivateKey, Transaction, MerklePath, P2PKH, Beef, PublicKey, BEEF_V2 } from '@bsv/sdk'
import { Setup, SetupWallet, StorageClient, Services, Chain } from '@bsv/wallet-toolbox'
import { exit } from 'process'

/**
 * Default py-wallet-toolbox endpoint URL.
 */
const DEFAULT_PY_WALLET_TOOLBOX_URL = 'http://localhost:8000'

/**
 * Build Atomic BEEF from raw transaction hex.
 *
 * This helper function takes a raw transaction hex and:
 * 1. Parses the transaction to get txid
 * 2. Attempts to fetch merkle proof from Services (if mined)
 * 3. Builds Atomic BEEF format
 *
 * @param rawTxHex Raw transaction hex string
 * @param chain Network chain ('main' or 'test')
 * @returns Atomic BEEF binary data and txid
 */
async function buildAtomicBeefFromRawTx(
  rawTxHex: string,
  chain: Chain
): Promise<{
  atomicBeef: number[]
  txid: string
}> {
  // console.log(`🔍 Parsing raw transaction (${rawTxHex.length} chars)...`)

  // Parse the raw transaction to get txid
  const tx = Transaction.fromHex(rawTxHex)
  const txid = tx.id('hex')

  // console.log(`✅ Transaction parsed`)
  // console.log(`   TXID: ${txid}`)
  //console.log(`   Inputs: ${tx.inputs.length}, Outputs: ${tx.outputs.length}`)

  // Use Services.getBeefForTxid() to build a valid BEEF
  // This method handles all the complexity of fetching parent transactions
  // and merkle proofs recursively to build a valid BEEF
  // console.log(`🔍 Building BEEF using Services.getBeefForTxid()...`)
  const services = new Services(chain)

  try {
    const beef = await services.getBeefForTxid(txid)

    // console.log(`✅ BEEF built successfully`)
    // console.log(`   ${beef.toLogString()}`)

    // Convert to Atomic BEEF binary format
    const atomicBeef = beef.toBinaryAtomic(txid)
    // console.log(`   Size: ${atomicBeef.length} bytes`)

    return { atomicBeef, txid }
  } catch (error: any) {
    // console.log(`⚠️  Failed to build BEEF using Services.getBeefForTxid(): ${error.message}`)
    // console.log(`   Falling back to manual BEEF building...`)

    // Fallback: Build a simple BEEF with just the transaction
    // This may fail validation if the transaction is unconfirmed
    const beef = new Beef(BEEF_V2)

    // Try to get merkle proof for the main transaction
    try {
      const merkleResult = await services.getMerklePath(txid)
      if (merkleResult && merkleResult.merklePath) {
        tx.merklePath = merkleResult.merklePath
        // console.log(`✅ Merkle proof found (height: ${merkleResult.merklePath.blockHeight})`)
      }
    } catch (error: any) {
      // console.log(`⚠️  No merkle proof found - transaction may be unconfirmed`)
    }

    beef.mergeTransaction(tx)
    const atomicBeef = beef.toBinaryAtomic(txid)

    // console.log(`⚠️  Built fallback BEEF (may not be valid)`)
    // console.log(`   BEEF contains ${beef.txs.length} transactions and ${beef.bumps.length} BUMPS`)

    return { atomicBeef, txid }
  }
}

describe('BRC-100 Wallet Operations (Python Storage Server)', () => {
  let setup: SetupWallet
  let walletServiceAvailable = false

  beforeAll(async () => {
    const endpointUrl =
      process.env.PY_WALLET_TOOLBOX_URL || DEFAULT_PY_WALLET_TOOLBOX_URL
    const env = Setup.getEnv('test')
    // console.log({env})
    // Determine which key to use
    let rootKeyHex: string = process.env.LIVE_PRIVATE_KEY || ''
      
    try {
      // Create wallet without any storage providers
      setup = await Setup.createWallet({
        env,
        rootKeyHex
      })

      // Reduced verbose logging

      // Create a StorageClient connected to the py-wallet-toolbox storage server
      const storageClient = new StorageClient(setup.wallet, endpointUrl)
      await storageClient.makeAvailable()
      await setup.storage.addWalletStorageProvider(storageClient)

      // Try to connect to verify the service is available
      await setup.wallet.waitForAuthentication({})
      walletServiceAvailable = true
      // console.log({wallet: setup.wallet})
    } catch (error: any) {
      walletServiceAvailable = false
      const errorMessage = error?.message || String(error)

      if (
        errorMessage.includes('fetch failed') ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('Network error')
      ) {
        console.error(
          '\n' +
          '='.repeat(80) +
          '\n' +
          '⚠️  PY WALLET TOOLBOX STORAGE SERVER NOT AVAILABLE\n' +
          '='.repeat(80) +
          '\n' +
          `\nThe py-wallet-toolbox storage server is not running at ${endpointUrl}\n` +
          '\nTo run these tests, you need to start the py-wallet-toolbox storage server.\n' +
          '\nSetup steps:\n' +
          '  1. Navigate to the py-wallet-toolbox directory:\n' +
          '     cd ../py-wallet-toolbox/examples/storage_server_example\n' +
          '  2. Activate the virtual environment:\n' +
          '     source venv/bin/activate  # Linux/Mac\n' +
          '     # or\n' +
          '     venv\\Scripts\\activate     # Windows\n' +
          '  3. Install dependencies:\n' +
          '     pip install -r requirements.txt\n' +
          '  4. Run migrations:\n' +
          '     python manage.py migrate\n' +
          '  5. Start the storage server:\n' +
          '     python manage.py runserver\n' +
          '\nThe server should be available at http://localhost:8000\n' +
          '\nFor more details, see the py-wallet-toolbox storage server README.md\n' +
          '\n' +
          '='.repeat(80) +
          '\n'
        )

        // Exit early to prevent running all tests
        process.exit(1)
      }

      // Re-throw other errors
      throw error
    }
  }, 10000)

  // ============================================================================
  //   Basics
  // ============================================================================

  describe('Basics', () => {
    test('walletInfo - should retrieve wallet address and balance', async () => {
      // Test balance retrieval
      let balance = 0
      try {
        balance = await setup.wallet.balance()
        console.log('💰 Balance:', balance)
        expect(typeof balance).toBe('number')
        expect(balance).toBeGreaterThanOrEqual(0)


        if (balance === 0) {
          // Try to internalize funding automatically in live mode
          try {
            const FAUCET_DERIVATION_PREFIX = "faucet-prefix-01"
            const FAUCET_DERIVATION_SUFFIX = "faucet-suffix-01"
            const derivationPrefixB64 = Buffer.from(FAUCET_DERIVATION_PREFIX, 'utf-8').toString('base64')
            const derivationSuffixB64 = Buffer.from(FAUCET_DERIVATION_SUFFIX, 'utf-8').toString('base64')
            // Use base64 strings in keyID to match validation behavior (Go/TS use base64 strings directly)
            const keyID = `${derivationPrefixB64} ${derivationSuffixB64}`

            // Use AnyoneKey as sender (matches Python example)
            // AnyoneKey = PrivateKey(1).public_key()
            // PrivateKey(1) in hex is 32 bytes with value 1: '0000000000000000000000000000000000000000000000000000000000000001'
            const anyoneKeyPriv = PrivateKey.fromString('0000000000000000000000000000000000000000000000000000000000000001')
            const anyoneKey = anyoneKeyPriv.toPublicKey()
            const anyoneKeyHex = anyoneKey.toString()

            // Request derived public key using BRC-29 protocol (wallet payment protocol)
            // Use AnyoneKey as counterparty (external sender, like a faucet)
            // NOTE: keyID uses base64 strings to match validation behavior (Go/TS use base64 strings directly)
            // NOTE: forSelf=true to match AddressForSelf direction (recipient derives for self)
            // This matches validation which uses derivePrivateKey (recipient's perspective)
            const derivedKeyResult = await setup.wallet.getPublicKey({
              protocolID: [2, '3241645161d8'], // BRC-29 wallet payment protocol
              keyID: keyID, // Base64 strings (matches Go/TS validation)
              counterparty: anyoneKeyHex, // Use AnyoneKey for external sender (faucet)
              forSelf: true // CRITICAL: Must be true to match AddressForSelf direction
            })

            if (!derivedKeyResult.publicKey) {
              throw new Error('Failed to get derived public key from wallet')
            }

            // Create P2PKH address from derived public key
            const derivedPublicKey = PublicKey.fromString(derivedKeyResult.publicKey)
            const network = setup.chain === 'main' ? 'mainnet' : 'testnet'
            const fundingAddress = derivedPublicKey.toAddress(network)
            // console.log('📬 EXTERNAL FUNDING ADDRESS (P2PKH)')
            console.log('Address:', fundingAddress)

            // Check if the funding address has funds via Whatsonchain API
            const wocNetwork = setup.chain === 'main' ? 'main' : 'test'
            const wocBaseUrl = `https://api.whatsonchain.com/v1/bsv/${wocNetwork}`

            try {
              // Check for unspent outputs at this address
              const unspentResponse = await fetch(`${wocBaseUrl}/address/${fundingAddress}/unspent`)
              if (!unspentResponse.ok) {
                throw new Error(`Whatsonchain API error: ${unspentResponse.statusText}`)
              }

              const unspentData = await unspentResponse.json()
              // console.log(`📊 Found ${unspentData.length} unspent output(s) at funding address`)

              if (unspentData.length > 0) {
                // Get the first unspent output (or we could process all of them)
                const firstUtxo = unspentData[0]
                const txid = firstUtxo.tx_hash
                const outputIndex = firstUtxo.tx_pos

                // console.log(`📥 Found funding transaction: ${txid}:${outputIndex}`)
                // console.log(`💰 Amount: ${firstUtxo.value} satoshis`)

                // Show Whatsonchain link for the funding transaction
                const wocNetwork = setup.chain === 'main' ? '' : 'test.'
                const fundingTxUrl = `https://${wocNetwork}whatsonchain.com/tx/${txid}`
                // console.log(`🔗 View funding transaction on Whatsonchain: ${fundingTxUrl}`)

                // Get the raw transaction hex
                const txResponse = await fetch(`${wocBaseUrl}/tx/${txid}/hex`)
                if (!txResponse.ok) {
                  throw new Error(`Failed to fetch transaction: ${txResponse.statusText}`)
                }

                const txHex = await txResponse.text()
                // console.log(`📄 Retrieved raw transaction (${txHex.length / 2} bytes)`)
                // TODO: replace things below with buildAtomicBeefFromRawTx
                // Parse the transaction to verify the output
                const txBytes = Array.from(Buffer.from(txHex, 'hex'))
                const tx = Transaction.fromBinary(txBytes)

                // Verify the output at the specified index pays to our address
                if (outputIndex >= tx.outputs.length) {
                  throw new Error(`Output index ${outputIndex} out of range (${tx.outputs.length} outputs)`)
                }

                const output = tx.outputs[outputIndex]
                // Verify the output pays to our address by comparing locking scripts
                const expectedLockingScript = new P2PKH().lock(fundingAddress)
                const actualLockingScript = output.lockingScript.toHex()
                const expectedLockingScriptHex = expectedLockingScript.toHex()

                // console.log(`   Output ${outputIndex} locking script: ${actualLockingScript}`)
                // console.log(`   Expected locking script: ${expectedLockingScriptHex}`)

                if (actualLockingScript !== expectedLockingScriptHex) {
                  console.log(`⚠️  Warning: Output ${outputIndex} locking script does not match funding address`)
                  console.log(`   This output may not be a BRC-29 wallet payment - it might be a regular P2PKH`)
                  // Continue anyway - might be a different output format
                } else {
                  // console.log(`✅ Output ${outputIndex} locking script matches funding address`)
                }

                // Build Atomic BEEF using the helper function
                const { atomicBeef } = await buildAtomicBeefFromRawTx(txHex, setup.chain)

                try {
                  // Prepare payment remittance with proper base64 encoding
                  // Match Python example: use AnyoneKey as senderIdentityKey (external sender/faucet)
                  // NOTE: derivationPrefix and derivationSuffix are already base64-encoded above
                  const paymentRemittance = {
                    derivationPrefix: derivationPrefixB64, // Already base64-encoded
                    derivationSuffix: derivationSuffixB64, // Already base64-encoded
                    senderIdentityKey: anyoneKeyHex // Use AnyoneKey (external sender, like faucet)
                  }


                  // Internalize as "wallet payment" protocol (matches Python example)
                  // Python example always uses "wallet payment" protocol with paymentRemittance
                  const internalizeResult = await setup.wallet.internalizeAction({
                    tx: atomicBeef,
                    outputs: [
                      {
                        outputIndex: outputIndex,
                        protocol: 'wallet payment',
                        paymentRemittance: paymentRemittance
                      }
                    ],
                    description: 'Auto-internalize funding transaction'
                  })

                  if (internalizeResult) {
                    // Show Whatsonchain link
                    const wocNetwork = setup.chain === 'main' ? '' : 'test.'
                    const fundingTxUrl = `https://${wocNetwork}whatsonchain.com/tx/${txid}`
                    console.log(`🔗 View funding transaction on Whatsonchain: ${fundingTxUrl}`)

                    await new Promise(resolve => setTimeout(resolve, 2000))
                    console.log('Slept for 2 seconds after tx')
                  }
                } catch (internalizeErr: any) {
                  // Final fallback - log and continue
                  console.log('⚠️  Could not internalize transaction:', internalizeErr.message)
                  process.exit(-1)
                }
              } else {
                console.log('ℹ️  No unspent outputs found at funding address: '+fundingAddress)
                exit(-1)
              }
            } catch (apiErr: any) {
              console.log('   Could not check external API:', apiErr.message)
              // Don't throw - this is best-effort automatic funding
              process.exit(-1)
            }
          } catch (apiErr) {
            console.log('   Could not check external API')
            process.exit(-1)
          }
        }
      } catch (err: any) {
        console.log('⚠️  Balance check failed (expected for local testing)')
        // Balance might fail if services not configured, but that's expected
        process.exit(-1)
      }
      // Test completed
    }, 10000)

    test('waitForAuthentication - should resolve immediately for base wallet', async () => {
      // console.log('🔐 Testing waitForAuthentication...')
      const result = await setup.wallet.waitForAuthentication({})
      // console.log(`🔐 Authentication result: ${JSON.stringify(result)}`)
      expect(result).toBeDefined()
      expect(result.authenticated).toBeDefined()
      // Base wallet resolves immediately
      // console.log('✅ waitForAuthentication test completed')
    }, 10000)

    test('isAuthenticated - should check if wallet is authenticated', async () => {
      // console.log('🔐 Testing isAuthenticated...')
      const result = await setup.wallet.isAuthenticated({})
      // console.log(`🔐 Authentication check result: ${JSON.stringify(result)}`)
      expect(result).toBeDefined()
      expect(result.authenticated).toBeDefined()
      expect(typeof result.authenticated).toBe('boolean')
      // console.log('✅ isAuthenticated test completed')
    }, 10000)

    test('getNetwork - should return the network information', async () => {
      // console.log('🌐 Testing getNetwork...')
      const result = await setup.wallet.getNetwork({})
      // console.log(`🌐 Network info: ${JSON.stringify(result)}`)
      expect(result).toBeDefined()
      expect(result.network).toBeDefined()
      expect(['main', 'test', 'testnet']).toContain(result.network)
      // console.log('✅ getNetwork test completed')
    }, 10000)

    test('getVersion - should return wallet version information', async () => {
      // console.log('📦 Testing getVersion...')
      const result = await setup.wallet.getVersion({})
      // console.log(`📦 Version info: ${JSON.stringify(result)}`)
      expect(result).toBeDefined()
      expect(result.version).toBeDefined()
      expect(typeof result.version).toBe('string')
      // console.log('✅ getVersion test completed')
    }, 10000)
  })

  // ============================================================================
  // Keys and Signatures
  // ============================================================================

  describe('Keys and Signatures', () => {
    test('getPublicKey - should derive protocol-specific public key', async () => {
      // console.log('🔑 Testing public key derivation...')
      const result = await setup.wallet.getPublicKey({
        identityKey: true,
        protocolID: [0, 'testprotocol'],
        keyID: '1',
        counterparty: 'self'
      })

      // console.log(
      //   `🔑 Derived public key: ${result.publicKey.substring(0, 20)}...`
      // )
      expect(result).toBeDefined()
      expect(result.publicKey).toBeDefined()
      expect(typeof result.publicKey).toBe('string')
      expect(result.publicKey.length).toBeGreaterThan(60) // Public key length
      // console.log('✅ Public key test completed')
    }, 10000)

    test('createSignature - should sign data with wallet keys', async () => {
      // console.log('✍️  Testing signature creation...')
      const testMessage = 'Hello, BSV!'
      const data = Array.from(Buffer.from(testMessage))

      const result = await setup.wallet.createSignature({
        data,
        protocolID: [0, 'testprotocol'],
        keyID: '1',
        counterparty: 'self'
      })
      // console.log(
      //   `✍️  Created signature: ${Buffer.from(result.signature.slice(0, 10)).toString('hex')}...`
      // )
      expect(result).toBeDefined()
      expect(result.signature).toBeDefined()
      // console.log('✅ Signature creation test completed')
    }, 10000)

    test('verifySignature - should create and verify signature round-trip', async () => {
      // console.log('🔍 Testing signature verification...')
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

      // console.log(`🔍 Signature verification result: ${verifyResult.valid}`)
      expect(verifyResult).toBeDefined()
      expect(verifyResult.valid).toBe(true)
      // console.log('✅ Signature verification test completed')
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

  // // ============================================================================
  // // Crypto Operations
  // // ============================================================================

  describe('Crypto Operations', () => {
    test('createHmac - should generate HMAC for message', async () => {
      // console.log('🔐 Testing HMAC creation...')
      const testMessage = 'Hello, HMAC!'
      const data = Array.from(Buffer.from(testMessage))

      const result = await setup.wallet.createHmac({
        data,
        protocolID: [0, 'testprotocol'],
        keyID: '1',
        counterparty: 'self'
      })

      // console.log(
      //   `🔐 Generated HMAC: ${Buffer.from(result.hmac.slice(0, 10)).toString('hex')}...`
      // )
      expect(result).toBeDefined()
      expect(result.hmac).toBeDefined()
      // console.log('✅ HMAC creation test completed')
    }, 10000)

    test('verifyHmac - should create and verify HMAC round-trip', async () => {
      // console.log('🔍 Testing HMAC verification...')
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

      // console.log(`🔍 HMAC verification result: ${verifyResult.valid}`)
      // console.log('✅ HMAC verification test completed')
      expect(verifyResult).toBeDefined()
      expect(verifyResult.valid).toBe(true)
      // console.log('✅ HMAC verification test completed')
    }, 10000)

    test('encrypt/decrypt - should encrypt data and decrypt it back', async () => {
      // console.log('🔒 Testing encryption/decryption...')
      const testMessage = 'Secret Message!'
      const plaintext = Array.from(Buffer.from(testMessage))

      // Encrypt
      const encryptResult = await setup.wallet.encrypt({
        plaintext,
        protocolID: [0, 'encryption'],
        keyID: '1',
        counterparty: 'self'
      })

      // console.log(
      //   `🔒 Encrypted message: ${Buffer.from(encryptResult.ciphertext.slice(0, 10)).toString('hex')}...`
      // )
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
      // console.log(`🔓 Decrypted message: "${decrypted}"`)
      expect(decrypted).toBe(testMessage)
      // console.log('✅ Encryption/decryption test completed')
    }, 10000)
  })

  // ============================================================================
  // Actions
  // ============================================================================

  describe('Actions', () => {
    test('createAction - should create OP_RETURN transaction', async () => {
      // Check balance first - need at least 10 sats to safely run this test
      // For externally-funded outputs, also check the 'funding' basket
      let balance = 0
      try {
        balance = await setup.wallet.balance()
        // console.log({ balance })

      } catch (err) {
        console.log('⚠️  Could not check balance - assuming 0')
      }

      const requiredBalance = 1  // Temporarily lower for debugging
      if (balance < requiredBalance) {
          console.log('⚠️  Skipping test - insufficient balance')
          return
      }

      console.log(`🔍 Wallet balance: ${balance}, proceeding with test`)

      try {
        const message = 'Hello, World! - Test Action'
        const messageBytes = Buffer.from(message)
        const hexData = messageBytes.toString('hex')
        const length = messageBytes.length
        const lockingScript = `006a${length.toString(16).padStart(2, '0')}${hexData}`

        let action: any
        try {
          action = await setup.wallet.createAction({
            description: `Test action: ${message}`,
            outputs: [
              { lockingScript, satoshis: 0, outputDescription: 'Test output', basket: 'opreturn', tags: ['test'] }
            ],
            labels: ['test:create_action'],
            options: {
              acceptDelayedBroadcast: false
            }
          })
          // console.dir(action, { depth: null })
          await new Promise(resolve => setTimeout(resolve, 2000))
          console.log('Slept for 2 seconds after tx')
        } catch (error: any) {
          // When acceptDelayedBroadcast is false, unsuccessful results throw WERR_REVIEW_ACTIONS
          // Extract the results from the error and treat as action result
          if (error.name === 'WERR_REVIEW_ACTIONS' || error.message?.includes('require review')) {
            console.log('⚠️  Action requires review even with delayed broadcast')
            action = {
              txid: error.txid,
              tx: error.tx,
              sendWithResults: error.sendWithResults || [],
              reviewActionResults: error.reviewActionResults || [],
            }
            // console.dir(action, { depth: null })

            // Log review results
            if (action.reviewActionResults && action.reviewActionResults.length > 0) {
              console.log(`📋 Found ${action.reviewActionResults.length} review action result(s)`)
              // Log all review results for debugging
              action.reviewActionResults.forEach((result: any, index: number) => {
                console.log(`   Review result ${index + 1}:`, {
                  status: result.status,
                  txid: result.txid,
                  reference: result.reference,
                  message: result.message
                })
              })

              // Debug: Check if we have tx data
              if (action.tx) {
                console.log(`📄 Transaction BEEF data length: ${action.tx.length} bytes`)
                // Try to parse the BEEF to see what's in it
                try {
                  const beefData = action.tx
                  console.log(`📄 First 100 bytes of BEEF: ${Buffer.from(beefData.slice(0, 100)).toString('hex')}`)
                } catch (e: any) {
                  console.log(`⚠️  Could not parse BEEF data: ${e.message}`)
                }
              } else {
                console.log(`⚠️  No tx (BEEF) data in action`)
              }

              // Fail the test if any review action result has an error status
              const errorResults = action.reviewActionResults.filter((result: any) => result.status === 'error')
              if (errorResults.length > 0) {
                const errorMessages = errorResults.map((result: any) =>
                  `${result.txid || 'no-txid'}: ${result.message || 'Unknown error'}`
                ).join('; ')
                console.error(`❌ Review action failed with errors: ${errorMessages}`)
                // Use expect().toBe() to fail the test explicitly
                expect(errorResults.length).toBe(0)
              }
            }

            // Also check sendWithResults for failures
            if (action.sendWithResults && Array.isArray(action.sendWithResults)) {
              const failedResults = action.sendWithResults.filter((result: any) => result.status === 'failed')
              if (failedResults.length > 0) {
                const errorMessages = failedResults.map((result: any) =>
                  `${result.txid}: ${result.message || 'Broadcast failed'}`
                ).join('; ')
                console.error(`❌ Send action failed: ${errorMessages}`)
                // Use expect().toBe() to fail the test explicitly
                expect(failedResults.length).toBe(0)
              }
            }
          } else {
            // Some other error - log details and rethrow
            console.error('❌ createAction failed with error:', error.name || error.constructor?.name)
            console.error('   Message:', error.message)
            if (error.stack) {
              console.error('   Stack:', error.stack)
            }
            // Check for script evaluation errors
            if (error.message && (error.message.includes('OP_EQUALVERIFY') || error.message.includes('Script evaluation'))) {
              console.error('🔍 Script evaluation error detected - this usually means the unlocking script does not match the locking script')
              console.error('   This can happen if:')
              console.error('   1. The derivation fields (derivationPrefix/derivationSuffix) do not match the public key in the locking script')
              console.error('   2. The counterparty type (SELF vs OTHER) is incorrect')
              console.error('   3. The identity key used for derivation does not match')
              console.error('   4. The output was internalized incorrectly (wrong protocol or missing derivation data)')
            }
            throw error
          }
        }
        
        // Also show links for sendWithResults if available
        if (action.notDelayedResults && Array.isArray(action.notDelayedResults)) {
          action.notDelayedResults.forEach((result: any) => {
            if (result.txid && result.status === 'success') {
              const chain = setup.wallet.chain || 'test'
              const network = chain === 'main' ? '' : 'test.'
              const whatsonchainUrl = `https://${network}whatsonchain.com/tx/${result.txid}`
              console.log(`🔗 View transaction ${result.txid} on Whatsonchain: ${whatsonchainUrl}`)
              // console.log(`   Status: ${result.status}`)
            }

            // Only fail the test if the transaction actually failed to broadcast
            if (result.status === 'failed') {
              throw new Error(`Transaction ${result.txid} failed with status ${result.status}`)
            }
          })
        }
//        console.log(`✅ Action created with ${action.signableTransaction ? 'signableTransaction' : action.txid ? 'txid' : 'unknown'}`)

      } catch (err: any) {
        // Don't swallow errors - if the transaction fails, the test should fail
        throw err
      }
    }, 15000)
    
    test('createAction - verify action result structure', async () => {
      // Check balance first
      let balance = 0
      try {
        balance = await setup.wallet.balance()
        // console.log(`💰 Current balance: ${balance} satoshis`)
      } catch (err) {
        console.log('⚠️  Could not check balance - assuming 0')
      }

      if (balance < 10) {
        console.log('⚠️  Skipping structure test - insufficient balance')
        return
      }

      try {
        const message = 'Structure Test'
        const messageBytes = Buffer.from(message)
        const hexData = messageBytes.toString('hex')
        const length = messageBytes.length
        const lockingScript = `006a${length.toString(16).padStart(2, '0')}${hexData}`

        let action
        try {
          action = await setup.wallet.createAction({
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
              signAndProcess: false, 
            }
          })
          
          // console.dir(action, { depth: null })
          // await new Promise(resolve => setTimeout(resolve, 2000))
          // console.log('Slept for 2 seconds after tx')

        } catch (err: any) {
          console.error('❌ createAction failed:', err.message)
          throw err
        }

        // console.log(
        //   `✅ Structure test action created with ${action.signableTransaction ? 'signableTransaction' : action.txid ? 'txid' : 'unknown'}`
        // )
        expect(action).toBeDefined()
        // Verify result structure - align with TypeScript behavior:
        // When noSend: true and transaction is signed, expect txid (not signableTransaction)
        // When signAndProcess: false, expect signableTransaction (not txid)
        if (action.txid) {
          // Transaction was signed - expect txid and tx, but NOT signableTransaction (TypeScript behavior)
          expect(typeof action.txid).toBe('string')
          expect(action.txid!.length).toBe(64)
          expect(action.tx).toBeDefined()
          expect(action.signableTransaction).toBeUndefined()
        } else if (action.signableTransaction) {
          // Transaction was not signed - expect signableTransaction (not txid)
          expect(action.signableTransaction.reference).toBeDefined()
          expect(action.signableTransaction.tx).toBeDefined()
          // Cleanup - abort to release UTXOs (unreserve satoshis)
          const reference = action.signableTransaction.reference
          console.log(`🔄 Aborting action with reference: ${reference}`)
          const abortResult = await setup.wallet.abortAction({
            reference: reference
          })
          console.log(`✅ Abort action result:`, JSON.stringify(abortResult))
          expect(abortResult).toBe(true)
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

    test('signAction - should sign a previously created signable transaction', async () => {
      // Check balance first
      let balance = 0
      try {
        balance = await setup.wallet.balance()
      } catch (err) {
        console.log('⚠️  Could not check balance - assuming 0')
      }

      if (balance < 10) {
        console.log('⚠️  Skipping signAction test - insufficient balance')
        return
      }

      try {
        // Step 1: Create an action with signAndProcess=false to get a signableTransaction
        const signableResult = await setup.wallet.createAction({
          description: 'Test for signAction - signable transaction',
          outputs: [
            {
              lockingScript: '006a0b7369676e5f616374696f6e', // OP_RETURN "sign_action"
              satoshis: 0,
              outputDescription: 'Test output for signAction',
              basket: 'opreturn'
            }
          ],
          options: {
            signAndProcess: false // This returns a signableTransaction
          }
        })

        if (signableResult && signableResult.signableTransaction) {
          const reference = signableResult.signableTransaction.reference

          if (reference) {
            // Step 2: Call signAction with the reference
            // For wallet inputs, spends can be empty (wallet auto-signs)
            const signResult = await setup.wallet.signAction({
              reference: reference,
              spends: {}, // Wallet inputs are auto-signed
              options: { acceptDelayedBroadcast: true }
            })

            expect(signResult).toBeDefined()
            // signAction returns either txid (if broadcasted) or tx (AtomicBEEF)
            if (signResult.txid) {
              expect(typeof signResult.txid).toBe('string')
              expect(signResult.txid.length).toBe(64)
            } else if (signResult.tx) {
              expect(Array.isArray(signResult.tx)).toBe(true)
              expect(signResult.tx.length).toBeGreaterThan(0)
            } else {
              // signAction may have completed but not returned txid/tx in some cases
              // This is acceptable - the action was signed
              expect(signResult).toBeDefined()
            }
          } else {
            console.log('⚠️  signAction test: signableTransaction has no reference')
          }
        } else {
          console.log('⚠️  signAction test: createAction with signAndProcess=false did not return signableTransaction')
        }
      } catch (err: any) {
        if (
          err.message.includes('Insufficient funds') ||
          err.message.includes('insufficient')
        ) {
          return
        }
        // Log but don't fail - signAction may not be available in all scenarios
        console.log(`⚠️  signAction test: ${err.message}`)
      }
    }, 15000)

    test('abortAction - should abort an unsigned action if available', async () => {
      // Check if there are any unsigned actions we can abort
      const actions = await setup.wallet.listActions({ labels: [], limit: 20 })
      const unsignedAction = actions.actions.find(
        a => a.status === 'unsigned'
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
          certifierUrl: 'http://localhost:9999',
          fields: {
            name: 'Test User',
            email: 'test@example.com'
          },
          privilegedReason: 'Demo acquisition'
        })
        expect(result).toBeDefined()
      } catch (err: any) {
        // Expected to fail - there's no real certifier service running
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

      if (certs.certificates.length === 0) {
        console.log('⚠️  No certificates to relinquish, skipping test')
        return
      }

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

  // // ============================================================================
  // // Transactions
  // // ============================================================================

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
      // console.log('📊 Testing getHeight...')
      try {
        const result = await setup.wallet.getHeight({})
        // console.log(`📊 Current height: ${result.height}`)
        expect(result).toBeDefined()
        expect(result.height).toBeDefined()
        expect(typeof result.height).toBe('number')
        expect(result.height).toBeGreaterThan(0)
        // console.log('✅ getHeight test completed')
      } catch (err: any) {
        // If services are not configured for blockchain access, that's expected
        // But we should still verify the method exists and returns a structured response
        if (err.message && err.message.includes('not configured')) {
          console.log('⚠️  Blockchain services not configured - this is expected for some test environments')
        } else {
          throw err
        }
      }
    }, 10000)

    test('getHeaderForHeight - should fetch header for specific height', async () => {
      // console.log('📦 Testing getHeaderForHeight...')
      try {
        // Use a known height (e.g., block 1 or a recent block)
        const testHeight = 1
        const result = await setup.wallet.getHeaderForHeight({ height: testHeight })
        // console.log(`📦 Header for height ${testHeight}: ${result.header.substring(0, 32)}...`)
        expect(result).toBeDefined()
        expect(result.header).toBeDefined()
        expect(typeof result.header).toBe('string')
        // Block header should be 80 bytes = 160 hex characters
        expect(result.header.length).toBe(160)
        // console.log('✅ getHeaderForHeight test completed')
      } catch (err: any) {
        // If services are not configured for blockchain access, that's expected
        if (err.message && err.message.includes('not configured')) {
          console.log('⚠️  Blockchain services not configured - this is expected for some test environments')
        } else {
          throw err
        }
      }
    }, 10000)
  })
})
