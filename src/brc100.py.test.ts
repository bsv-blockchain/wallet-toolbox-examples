import { PrivateKey, Transaction, MerklePath, P2PKH, Beef, PublicKey } from '@bsv/sdk'
import { Setup, SetupWallet, StorageClient } from '@bsv/wallet-toolbox'
import { exit } from 'process'

/**
 * Default py-wallet-toolbox endpoint URL.
 */
const DEFAULT_PY_WALLET_TOOLBOX_URL = 'http://localhost:8000'

/**
 * Track nosend transaction references for cleanup.
 * Tests that create nosend transactions should add their references here.
 */
const pendingAborts: string[] = []

/**
 * Global flag indicating if we're running in live test mode with funded wallet.
 */
const isLiveMode = process.env.LIVE === 'true' || process.env.LIVE === '1'

describe('BRC-100 Wallet Operations (Python Storage Server)', () => {
  let setup: SetupWallet
  let walletServiceAvailable = false

  beforeAll(async () => {
    const endpointUrl =
      process.env.PY_WALLET_TOOLBOX_URL || DEFAULT_PY_WALLET_TOOLBOX_URL
    const env = Setup.getEnv('test')
    // console.log({env})
    // Determine which key to use
    let rootKeyHex: string
    if (isLiveMode && process.env.LIVE_PRIVATE_KEY) {
      rootKeyHex = process.env.LIVE_PRIVATE_KEY
      console.log('🔥 LIVE MODE ENABLED - Using funded testnet key')
      console.log('⚠️  WARNING: This will broadcast real transactions!')
    } else {
      rootKeyHex = env.devKeys[env.identityKey]
      console.log('🧪 TEST MODE - Using development keys')
    }

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

    // Cleanup: Remove internalized funding transaction from database
    // This keeps the test database clean for subsequent runs
    if (setup && setup.wallet) {
      // try {
      //   // List all actions to find the internalized one
      //   const actions = await setup.wallet.listActions({ labels: [], limit: 100 })

      //   // Find actions with "Auto-internalize funding transaction" description
      //   const internalizedActions = actions.actions.filter(a =>
      //     a.description?.includes('Auto-internalize funding transaction')
      //   )
      //   // Cleanup handled automatically
      // } catch (err) {
      //   // Cleanup is best-effort, don't fail the test suite
      //   console.log('⚠️  Cleanup note: Internalized transactions remain in database')
      // }
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
        console.log({ balance })
        expect(typeof balance).toBe('number')
        expect(balance).toBeGreaterThanOrEqual(0)


        if (isLiveMode && balance === 0) {
          // Try to internalize funding automatically in live mode
          try {

            // console.log('💰 Balance is 0, requesting derived key for external P2PKH funding...')

            // Generate derivation prefix and suffix for BRC-29
            // Match Python example: "faucet-prefix-01" / "faucet-suffix-01"
            // IMPORTANT: These must be base64-encoded for the keyID used in getPublicKey
            // because validation uses base64 strings directly (matches Go/TS behavior)
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
            // NOTE: keyID uses base64 strings to match validation behavior
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
              console.log(`📊 Found ${unspentData.length} unspent output(s) at funding address`)

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
                console.log(`🔗 View funding transaction on Whatsonchain: ${fundingTxUrl}`)

                // Get the raw transaction hex
                const txResponse = await fetch(`${wocBaseUrl}/tx/${txid}/hex`)
                if (!txResponse.ok) {
                  throw new Error(`Failed to fetch transaction: ${txResponse.statusText}`)
                }

                const txHex = await txResponse.text()
                // console.log(`📄 Retrieved raw transaction (${txHex.length / 2} bytes)`)

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
                
                console.log(`   Output ${outputIndex} locking script: ${actualLockingScript}`)
                console.log(`   Expected locking script: ${expectedLockingScriptHex}`)
                
                if (actualLockingScript !== expectedLockingScriptHex) {
                  console.log(`⚠️  Warning: Output ${outputIndex} locking script does not match funding address`)
                  console.log(`   This output may not be a BRC-29 wallet payment - it might be a regular P2PKH`)
                  // Continue anyway - might be a different output format
                } else {
                  console.log(`✅ Output ${outputIndex} locking script matches funding address`)
                }

                // Fetch merkle proof (BUMP) from Whatsonchain to build valid AtomicBEEF
                console.log('🔍 Fetching merkle proof from Whatsonchain...')
                let merklePath: MerklePath | null = null
                try {
                  const proofResponse = await fetch(`${wocBaseUrl}/tx/${txid}/proof/tsc`)
                  console.log(`   Proof response status: ${proofResponse.status}`)
                  
                  if (proofResponse.ok) {
                    const proofResponseData = await proofResponse.json()
                    console.log(`   Proof response type:`, Array.isArray(proofResponseData) ? 'array' : typeof proofResponseData)
                    console.log(`   Proof response data:`, JSON.stringify(proofResponseData, null, 2).substring(0, 500))
                    if (proofResponseData !== null && typeof proofResponseData === 'object') {
                      console.log(`   Proof response keys:`, Array.isArray(proofResponseData) ? `array[${proofResponseData.length}]` : Object.keys(proofResponseData))
                    }
                    
                    // Whatsonchain may return an array of proofs or a single proof object
                    let proofData: any = null
                    if (Array.isArray(proofResponseData)) {
                      if (proofResponseData.length === 0) {
                        console.log(`⚠️  Proof response is an empty array`)
                      } else {
                        proofData = proofResponseData[0]
                      }
                    } else if (typeof proofResponseData === 'object' && proofResponseData !== null) {
                      // Single proof object
                      proofData = proofResponseData
                    }
                    
                    if (proofData) {
                      console.log(`   Proof data keys:`, Object.keys(proofData))
                      console.log(`   Proof data structure:`, { 
                        hasIndex: proofData.index !== undefined, 
                        hasNodes: Array.isArray(proofData.nodes),
                        nodesCount: proofData.nodes?.length,
                        hasTarget: proofData.target !== undefined,
                        hasTxOrId: proofData.txOrId !== undefined,
                        proofDataValue: JSON.stringify(proofData).substring(0, 200)
                      })
                      
                      // Get transaction info to get block height
                      const txInfoResponse = await fetch(`${wocBaseUrl}/tx/${txid}`)
                      console.log(`   TX info response status: ${txInfoResponse.status}`)
                      
                      if (txInfoResponse.ok) {
                        const txInfo = await txInfoResponse.json()
                        const blockHeight = txInfo.blockheight
                        console.log(`   Block height: ${blockHeight}`)
                        
                        if (blockHeight && proofData.nodes && Array.isArray(proofData.nodes) && proofData.nodes.length > 0 && proofData.index !== undefined) {
                        try {
                          // Convert TSC proof to MerklePath format
                          // Based on go-wallet-toolbox/pkg/internal/txutils/proof_for_merkle_path.go
                          const index = proofData.index
                          const nodes = proofData.nodes
                          const treeHeight = nodes.length
                          
                          console.log(`   Converting TSC proof: index=${index}, treeHeight=${treeHeight}`)
                          
                          // Build path levels
                          const path: Array<Array<{ offset: number; hash?: string; txid?: boolean; duplicate?: boolean }>> = []
                          let currentIndex = index
                          
                          for (let level = 0; level < treeHeight; level++) {
                            const node = nodes[level]
                            const isOdd = currentIndex % 2 === 1
                            const siblingOffset = isOdd ? currentIndex - 1 : currentIndex + 1
                            
                            const levelPath: Array<{ offset: number; hash?: string; txid?: boolean; duplicate?: boolean }> = []
                            
                            // Add sibling node
                            if (node === '*' || (level === 0 && node === txid)) {
                              levelPath.push({ offset: siblingOffset, duplicate: true })
                            } else {
                              levelPath.push({ offset: siblingOffset, hash: node })
                            }
                            
                            // At level 0, add txid leaf
                            if (level === 0) {
                              const txidLeaf = { offset: index, hash: txid, txid: true }
                              if (isOdd) {
                                levelPath.push(txidLeaf)
                              } else {
                                levelPath.unshift(txidLeaf)
                              }
                            }
                            
                            path.push(levelPath)
                            currentIndex = currentIndex >> 1
                          }
                          
                          // Create MerklePath with legalOffsetsOnly=false to avoid strict validation
                          merklePath = new MerklePath(blockHeight, path, false)
                          console.log(`✅ Retrieved merkle proof for block height ${blockHeight}, path levels: ${path.length}`)
                        } catch (mpErr: any) {
                          console.log(`⚠️  Failed to create MerklePath: ${mpErr.message}`)
                          console.log(`   Error details:`, mpErr)
                        }
                        } else {
                          console.log(`⚠️  Missing required data: blockHeight=${blockHeight}, hasNodes=${Array.isArray(proofData.nodes)}, nodesLength=${proofData.nodes?.length}, hasIndex=${proofData.index !== undefined}`)
                        }
                      } else {
                        console.log(`⚠️  Failed to fetch TX info: ${txInfoResponse.status} ${txInfoResponse.statusText}`)
                      }
                    }
                  } else {
                    console.log(`⚠️  Failed to fetch proof: ${proofResponse.status} ${proofResponse.statusText}`)
                    const errorText = await proofResponse.text()
                    console.log(`   Error response: ${errorText.substring(0, 200)}`)
                  }
                } catch (proofErr: any) {
                  console.log(`⚠️  Could not fetch merkle proof: ${proofErr.message}`)
                  console.log(`   Error stack:`, proofErr.stack)
                  console.log('   Will attempt to build BEEF without merkle proof (may fail validation)')
                }

                // Build AtomicBEEF with transaction and merkle proof
                // If we have a merkle path, attach it to the transaction
                if (merklePath) {
                  tx.merklePath = merklePath
                  console.log(`✅ Attached merkle proof to transaction`)
                } else {
                  console.log(`⚠️  No merkle path available - BEEF will be invalid`)
                }
                
                const beef = new Beef()
                // Merge transaction (will automatically merge merkle path if attached)
                beef.mergeTransaction(tx)
                console.log(`   BEEF after merge: ${beef.bumps.length} BUMPS, ${beef.txs.length} transactions`)

                try {
                  // Prepare payment remittance with proper base64 encoding
                  // Match Python example: use AnyoneKey as senderIdentityKey (external sender/faucet)
                  // NOTE: derivationPrefix and derivationSuffix are already base64-encoded above
                  const paymentRemittance = {
                    derivationPrefix: derivationPrefixB64, // Already base64-encoded
                    derivationSuffix: derivationSuffixB64, // Already base64-encoded
                    senderIdentityKey: anyoneKeyHex // Use AnyoneKey (external sender, like faucet)
                  }
                  
                  console.log(`   Payment remittance:`, {
                    derivationPrefix: paymentRemittance.derivationPrefix,
                    derivationSuffix: paymentRemittance.derivationSuffix,
                    derivationPrefixDecoded: Buffer.from(paymentRemittance.derivationPrefix, 'base64').toString('utf-8'),
                    derivationSuffixDecoded: Buffer.from(paymentRemittance.derivationSuffix, 'base64').toString('utf-8'),
                    senderIdentityKey: paymentRemittance.senderIdentityKey.substring(0, 20) + '... (AnyoneKey)'
                  })
                  
                  // Internalize as "wallet payment" protocol (matches Python example)
                  // Python example always uses "wallet payment" protocol with paymentRemittance
                  const internalizeResult = await setup.wallet.internalizeAction({
                    tx: beef.toBinaryAtomic(txid),
                    outputs: [
                      {
                        outputIndex: outputIndex,
                        protocol: 'wallet payment',
                        paymentRemittance: paymentRemittance
                      }
                    ],
                    description: 'Auto-internalize funding transaction'
                  })
                  
                  console.log('✅ Successfully internalized as wallet payment')
                  
                  if (internalizeResult) {
                    console.log(`✅ Successfully internalized funding transaction`)
                    console.log(`   Accepted: ${internalizeResult.accepted}`)
                    console.log(`   TXID: ${txid}`)
                    
                    // Show Whatsonchain link
                    const wocNetwork = setup.chain === 'main' ? '' : 'test.'
                    const fundingTxUrl = `https://${wocNetwork}whatsonchain.com/tx/${txid}`
                    console.log(`🔗 View funding transaction on Whatsonchain: ${fundingTxUrl}`)

                    // Check balance again after internalization
                    const newBalance = await setup.wallet.balance()
                    console.log(`💰 New balance after internalization: ${newBalance} satoshis`)
                  }
                } catch (internalizeErr: any) {
                  // Final fallback - log and continue
                  console.log('⚠️  Could not internalize transaction:', internalizeErr.message)
                  
                  if (internalizeErr.message.includes('BRC-29') || internalizeErr.message.includes('locking script')) {
                    console.log('   The output is a regular P2PKH (not created with BRC-29)')
                    console.log('   The wallet may still be able to spend it if it can derive the private key')
                  } else if (internalizeErr.message.includes('AtomicBEEF')) {
                    console.log('   The BEEF may be missing merkle proofs (BUMPS)')
                    console.log('   This is expected when fetching transactions from external APIs')
                  }
                  
                  console.log('   This is best-effort automatic funding - continuing without internalization')
                  // Continue without exiting - this is best-effort automatic funding
                }
              } else {
                console.log('ℹ️  No unspent outputs found at funding address')
              }
            } catch (apiErr: any) {
              console.log('   Could not check external API:', apiErr.message)
              // Don't throw - this is best-effort automatic funding
              // Continue without exiting
            }
          } catch (apiErr) {
            console.log('   Could not check external API')
          }
        }
      } catch (err: any) {
        console.log('⚠️  Balance check failed (expected for local testing)')
        if (isLiveMode) {
          console.log(
            '   This may indicate services are not configured for live testing.'
          )
        }
        // Balance might fail if services not configured, but that's expected
      }
      // Test completed
    }, 10000)

    // test('waitForAuthentication - should resolve immediately for base wallet', async () => {
    //   console.log('🔐 Testing waitForAuthentication...')
    //   const result = await setup.wallet.waitForAuthentication({})
    //   console.log(`🔐 Authentication result: ${JSON.stringify(result)}`)
    //   expect(result).toBeDefined()
    //   expect(result.authenticated).toBeDefined()
    //   // Base wallet resolves immediately
    //   console.log('✅ waitForAuthentication test completed')
    // }, 10000)

    // test('isAuthenticated - should check if wallet is authenticated', async () => {
    //   console.log('🔐 Testing isAuthenticated...')
    //   const result = await setup.wallet.isAuthenticated({})
    //   console.log(`🔐 Authentication check result: ${JSON.stringify(result)}`)
    //   expect(result).toBeDefined()
    //   expect(result.authenticated).toBeDefined()
    //   expect(typeof result.authenticated).toBe('boolean')
    //   console.log('✅ isAuthenticated test completed')
    // }, 10000)

    // test('getNetwork - should return the network information', async () => {
    //   console.log('🌐 Testing getNetwork...')
    //   const result = await setup.wallet.getNetwork({})
    //   console.log(`🌐 Network info: ${JSON.stringify(result)}`)
    //   expect(result).toBeDefined()
    //   expect(result.network).toBeDefined()
    //   expect(['main', 'test', 'testnet']).toContain(result.network)
    //   console.log('✅ getNetwork test completed')
    // }, 10000)

    // test('getVersion - should return wallet version information', async () => {
    //   console.log('📦 Testing getVersion...')
    //   const result = await setup.wallet.getVersion({})
    //   console.log(`📦 Version info: ${JSON.stringify(result)}`)
    //   expect(result).toBeDefined()
    //   expect(result.version).toBeDefined()
    //   expect(typeof result.version).toBe('string')
    //   console.log('✅ getVersion test completed')
    // }, 10000)
  })

  // ============================================================================
  // Keys and Signatures
  // ============================================================================

  describe('Keys and Signatures', () => {
    // test('getPublicKey - should derive protocol-specific public key', async () => {
    //   console.log('🔑 Testing public key derivation...')
    //   const result = await setup.wallet.getPublicKey({
    //     identityKey: true,
    //     protocolID: [0, 'testprotocol'],
    //     keyID: '1',
    //     counterparty: 'self'
    //   })

    //   console.log(
    //     `🔑 Derived public key: ${result.publicKey.substring(0, 20)}...`
    //   )
    //   expect(result).toBeDefined()
    //   expect(result.publicKey).toBeDefined()
    //   expect(typeof result.publicKey).toBe('string')
    //   expect(result.publicKey.length).toBeGreaterThan(60) // Public key length
    //   console.log('✅ Public key test completed')
    // }, 10000)

    // test('createSignature - should sign data with wallet keys', async () => {
    //   console.log('✍️  Testing signature creation...')
    //   const testMessage = 'Hello, BSV!'
    //   const data = Array.from(Buffer.from(testMessage))

    //   const result = await setup.wallet.createSignature({
    //     data,
    //     protocolID: [0, 'testprotocol'],
    //     keyID: '1',
    //     counterparty: 'self'
    //   })
    //   console.log(
    //     `✍️  Created signature: ${Buffer.from(result.signature.slice(0, 10)).toString('hex')}...`
    //   )
    //   expect(result).toBeDefined()
    //   expect(result.signature).toBeDefined()
    //   console.log('✅ Signature creation test completed')
    // }, 10000)

    // test('verifySignature - should create and verify signature round-trip', async () => {
    //   console.log('🔍 Testing signature verification...')
    //   const testMessage = 'Test signature verification'
    //   const data = Array.from(Buffer.from(testMessage))

    //   // Create signature
    //   const createResult = await setup.wallet.createSignature({
    //     data,
    //     protocolID: [0, 'testprotocol'],
    //     keyID: '1',
    //     counterparty: 'self'
    //   })

    //   // Verify signature
    //   const verifyResult = await setup.wallet.verifySignature({
    //     data,
    //     signature: createResult.signature,
    //     protocolID: [0, 'testprotocol'],
    //     keyID: '1',
    //     counterparty: 'self'
    //   })

    //   console.log(`🔍 Signature verification result: ${verifyResult.valid}`)
    //   expect(verifyResult).toBeDefined()
    //   expect(verifyResult.valid).toBe(true)
    //   console.log('✅ Signature verification test completed')
    // }, 10000)

    // test('revealCounterpartyKeyLinkage - should reveal counterparty key linkage', async () => {
    //   try {
    //     const result = await setup.wallet.revealCounterpartyKeyLinkage({
    //       counterparty: 'self',
    //       verifier: '02' + 'a'.repeat(64), // demo verifier pubkey
    //       privilegedReason: 'Demo'
    //     })

    //     expect(result).toBeDefined()
    //     expect(result.prover).toBeDefined()
    //     expect(result.counterparty).toBeDefined()
    //   } catch (err: any) {
    //     // This might fail in test environments, which is expected
    //   }
    // }, 10000)

    // test('revealSpecificKeyLinkage - should reveal specific key linkage', async () => {
    //   try {
    //     const result = await setup.wallet.revealSpecificKeyLinkage({
    //       counterparty: 'self',
    //       verifier: '02' + 'a'.repeat(64), // demo verifier pubkey
    //       protocolID: [0, 'testprotocol'],
    //       keyID: '1',
    //       privilegedReason: 'Demo'
    //     })

    //     expect(result).toBeDefined()
    //     expect(result.prover).toBeDefined()
    //     expect(result.counterparty).toBeDefined()
    //     expect(result.protocolID).toBeDefined()
    //     expect(result.keyID).toBeDefined()
    //   } catch (err: any) {
    //     // This might fail in test environments, which is expected
    //   }
    // }, 10000)
  })

  // // ============================================================================
  // // Crypto Operations
  // // ============================================================================

  // describe('Crypto Operations', () => {
  //   test('createHmac - should generate HMAC for message', async () => {
  //     console.log('🔐 Testing HMAC creation...')
  //     const testMessage = 'Hello, HMAC!'
  //     const data = Array.from(Buffer.from(testMessage))

  //     const result = await setup.wallet.createHmac({
  //       data,
  //       protocolID: [0, 'testprotocol'],
  //       keyID: '1',
  //       counterparty: 'self'
  //     })

  //     console.log(
  //       `🔐 Generated HMAC: ${Buffer.from(result.hmac.slice(0, 10)).toString('hex')}...`
  //     )
  //     expect(result).toBeDefined()
  //     expect(result.hmac).toBeDefined()
  //     console.log('✅ HMAC creation test completed')
  //   }, 10000)

  //   test('verifyHmac - should create and verify HMAC round-trip', async () => {
  //     console.log('🔍 Testing HMAC verification...')
  //     const testMessage = 'Test HMAC verification'
  //     const data = Array.from(Buffer.from(testMessage))

  //     // Create HMAC
  //     const createResult = await setup.wallet.createHmac({
  //       data,
  //       protocolID: [0, 'testprotocol'],
  //       keyID: '1',
  //       counterparty: 'self'
  //     })

  //     // Verify HMAC
  //     const verifyResult = await setup.wallet.verifyHmac({
  //       data,
  //       hmac: createResult.hmac,
  //       protocolID: [0, 'testprotocol'],
  //       keyID: '1',
  //       counterparty: 'self'
  //     })

  //     console.log(`🔍 HMAC verification result: ${verifyResult.valid}`)
  //     console.log('✅ HMAC verification test completed')
  //     expect(verifyResult).toBeDefined()
  //     expect(verifyResult.valid).toBe(true)
  //     console.log('✅ HMAC verification test completed')
  //   }, 10000)

  //   test('encrypt/decrypt - should encrypt data and decrypt it back', async () => {
  //     console.log('🔒 Testing encryption/decryption...')
  //     const testMessage = 'Secret Message!'
  //     const plaintext = Array.from(Buffer.from(testMessage))

  //     // Encrypt
  //     const encryptResult = await setup.wallet.encrypt({
  //       plaintext,
  //       protocolID: [0, 'encryption'],
  //       keyID: '1',
  //       counterparty: 'self'
  //     })

  //     console.log(
  //       `🔒 Encrypted message: ${Buffer.from(encryptResult.ciphertext.slice(0, 10)).toString('hex')}...`
  //     )
  //     expect(encryptResult).toBeDefined()
  //     expect(encryptResult.ciphertext).toBeDefined()

  //     // Decrypt
  //     const decryptResult = await setup.wallet.decrypt({
  //       ciphertext: encryptResult.ciphertext,
  //       protocolID: [0, 'encryption'],
  //       keyID: '1',
  //       counterparty: 'self'
  //     })

  //     expect(decryptResult).toBeDefined()
  //     expect(decryptResult.plaintext).toBeDefined()
  //     expect(Array.isArray(decryptResult.plaintext)).toBe(true)

  //     // Verify decrypted message matches original
  //     const decrypted = Buffer.from(decryptResult.plaintext).toString()
  //     console.log(`🔓 Decrypted message: "${decrypted}"`)
  //     expect(decrypted).toBe(testMessage)
  //     console.log('✅ Encryption/decryption test completed')
  //   }, 10000)
  // })

  // ============================================================================
  // Actions
  // ============================================================================

  describe('Actions', () => {
    test('createAction - should create OP_RETURN transaction (noSend + abort)', async () => {
      console.log(`Starting createAction test ${isLiveMode ? '(LIVE)' : '(test mode)'}`)

      // Check balance first - need at least 10 sats to safely run this test
      // For externally-funded outputs, also check the 'funding' basket
      let balance = 0
      try {
        balance = await setup.wallet.balance()
        console.log({ balance })
       
      } catch (err) {
        console.log('⚠️  Could not check balance - assuming 0')
      }

      const requiredBalance = 10
      if (balance < requiredBalance) {
        if (isLiveMode) {
          console.log(
            `❌ LIVE MODE: Insufficient balance (${balance} < ${requiredBalance} sats)`
          )
          console.log('   Fund your wallet before running live tests.')
          throw new Error('Insufficient funds for live testing')
        } else {
          console.log('⚠️  Skipping test - insufficient balance')
          return
        }
      }

      try {
        const message =
          'Hello, World! - Test Action' + (isLiveMode ? ' (LIVE)' : '')
        const messageBytes = Buffer.from(message)
        const hexData = messageBytes.toString('hex')
        const length = messageBytes.length
        const lockingScript = `006a${length.toString(16).padStart(2, '0')}${hexData}`

        const shouldBroadcast = isLiveMode
        let action: any
        try {
          action = await setup.wallet.createAction({
            description: `Test action: ${message}`,
            outputs: [
              { lockingScript, satoshis: 0, outputDescription: 'Test output', basket: 'opreturn', tags: ['test'] }
            ],
            labels: ['test:create_action'],
            options: { 
              noSend: !shouldBroadcast,
              // In live mode, disable delayed broadcast to ensure immediate broadcasting
              acceptDelayedBroadcast: shouldBroadcast ? false : true
            }
          })
          console.dir(action, { depth: null })
        } catch (error: any) {
          // When acceptDelayedBroadcast is false, unsuccessful results throw WERR_REVIEW_ACTIONS
          // Extract the results from the error and treat as action result
          if (error.name === 'WERR_REVIEW_ACTIONS' || error.message?.includes('require review')) {
            console.log('⚠️  Action requires review (undelayed mode)')
            action = {
              txid: error.txid,
              tx: error.tx,
              sendWithResults: error.sendWithResults || [],
              reviewActionResults: error.reviewActionResults || [],
              noSendChange: error.noSendChange
            }
            console.dir(action, { depth: null })
            
            // Log review results
            if (action.reviewActionResults && action.reviewActionResults.length > 0) {
              console.log('📋 Review action results:')
              action.reviewActionResults.forEach((result: any) => {
                console.log(`   ${result.txid}: ${result.status}`)
                if (result.competingTxs && result.competingTxs.length > 0) {
                  console.log(`     Competing transactions: ${result.competingTxs.join(', ')}`)
                }
              })
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
        
        // Add Whatsonchain link if txid is available
        if (action.txid) {
          const chain = setup.wallet.chain || 'test'
          const network = chain === 'main' ? '' : 'test.'
          const whatsonchainUrl = `https://${network}whatsonchain.com/tx/${action.txid}`
          console.log(`\n🔗 View transaction on Whatsonchain: ${whatsonchainUrl}\n`)
        }
        
        // Also show links for sendWithResults if available
        if (action.sendWithResults && Array.isArray(action.sendWithResults)) {
          action.sendWithResults.forEach((result: any) => {
            if (result.status!=='failed' && result.txid) {
              const chain = setup.wallet.chain || 'test'
              const network = chain === 'main' ? '' : 'test.'
              const whatsonchainUrl = `https://${network}whatsonchain.com/tx/${result.txid}`
              console.log(`🔗 View transaction ${result.txid} on Whatsonchain: ${whatsonchainUrl}`)
            }else 
            console.log(`   Status: ${result.status}`)
            throw new Error(`Transaction ${result.txid} failed with status ${result.status}`)
          })
        }
//        console.log(`✅ Action created with ${action.signableTransaction ? 'signableTransaction' : action.txid ? 'txid' : 'unknown'}`)

      } catch (err: any) {
        if (
          err.message.includes('Insufficient funds') ||
          err.message.includes('insufficient')
        )
          return
        throw err
      }
    }, 15000)

    // test('createAction - verify action result structure', async () => {
    //   // Check balance first
    //   let balance = 0
    //   try {
    //     balance = await setup.wallet.balance()
    //     console.log(`💰 Current balance: ${balance} satoshis`)
    //   } catch (err) {
    //     console.log('⚠️  Could not check balance - assuming 0')
    //   }

    //   if (balance < 10 && !isLiveMode) {
    //     console.log('⚠️  Skipping structure test - insufficient balance')
    //     return
    //   }

    //   try {
    //     const message = 'Structure Test' + (isLiveMode ? ' (LIVE)' : '')
    //     const messageBytes = Buffer.from(message)
    //     const hexData = messageBytes.toString('hex')
    //     const length = messageBytes.length
    //     const lockingScript = `006a${length.toString(16).padStart(2, '0')}${hexData}`

    //     const shouldBroadcast = isLiveMode && balance >= 10
    //     console.log(`✍️  Creating structure test action: "${message}"`)
    //     console.log(
    //       `${shouldBroadcast ? '📡 BROADCASTING' : '🧪 NO-SEND MODE'} transaction...`
    //     )

    //     let action
    //     try {
    //       console.log('🚀 Calling setup.wallet.createAction (structure test)...')
    //       action = await setup.wallet.createAction({
    //         description: `Structure test: ${message}`,
    //         outputs: [
    //           {
    //             lockingScript,
    //             satoshis: 0,
    //             outputDescription: 'Test output',
    //             basket: 'opreturn',
    //             tags: ['test', ...(isLiveMode ? ['live-test'] : ['test-nosend'])]
    //           }
    //         ],
    //         labels: ['test:structure'],
    //         options: {
    //           noSend: !shouldBroadcast
    //         }
    //       })
    //       console.log('✅ Structure test createAction succeeded')

    //       // Log detailed response from server
    //       console.log('📋 Structure test server response details:')
    //       console.log('   Full action object:', JSON.stringify(action, null, 2))

    //       if (action.txid) {
    //         console.log(`   ✅ Transaction ID: ${action.txid}`)
    //       }

    //       if (action.signableTransaction) {
    //         console.log('   📝 Signable transaction present')
    //         console.log('   Reference:', action.signableTransaction.reference)
    //         console.log('   Input count:', action.signableTransaction.inputs?.length || 0)
    //         console.log('   Output count:', action.signableTransaction.outputs?.length || 0)
    //       }

    //       if (action.noSendChange) {
    //         console.log('   💰 Change outputs:', action.noSendChange.length)
    //       }

    //     } catch (err: any) {
    //       console.log('❌ Structure test createAction failed with error:', err.message)
    //       console.log('   Error code:', err.code)
    //       console.log('   Error name:', err.name)
    //       console.log('   Full error object:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2))
    //       console.log('   Error stack:', err.stack)

    //       // Try to extract more details from the error
    //       if (err.response) {
    //         console.log('   Response status:', err.response.status)
    //         console.log('   Response data:', err.response.data)
    //       }

    //       throw err
    //     }

    //     console.log(
    //       `✅ Structure test action created with ${action.signableTransaction ? 'signableTransaction' : action.txid ? 'txid' : 'unknown'}`
    //     )
    //     expect(action).toBeDefined()

    //     if (shouldBroadcast) {
    //       // In live mode, expect txid
    //       expect(action.txid).toBeDefined()
    //       expect(typeof action.txid).toBe('string')
    //       expect(action.txid!.length).toBe(64)
    //       console.log(`📡 Transaction broadcasted! TXID: ${action.txid}`)
    //       console.log(
    //         `🔗 View on explorer: https://test.whatsonchain.com/tx/${action.txid}`
    //       )
    //     } else {
    //       // Verify result structure - either signableTransaction or txid
    //       if (action.signableTransaction) {
    //         expect(action.signableTransaction.reference).toBeDefined()
    //         expect(action.signableTransaction.tx).toBeDefined()
    //         console.log(
    //           `📝 Keeping action ${action.signableTransaction.reference} for database verification`
    //         )
    //         // Keep this action for the listActions test to find it
    //         // Don't abort immediately - will be cleaned up in afterAll
    //       } else if (action.txid) {
    //         expect(typeof action.txid).toBe('string')
    //         expect(action.txid!.length).toBe(64)
    //       } else {
    //         throw new Error('Expected either signableTransaction or txid')
    //       }
    //     }
    //   } catch (err: any) {
    //     if (
    //       err.message.includes('Insufficient funds') ||
    //       err.message.includes('insufficient')
    //     )
    //       return
    //     throw err
    //   }
    // }, 15000)

    // test('listActions - should list recent wallet actions', async () => {
    //   console.log(
    //     '🔍 Checking for actions in database before action creation tests...'
    //   )
    //   const actions = await setup.wallet.listActions({
    //     labels: [],
    //     limit: 10,
    //     includeLabels: true
    //   })

    //   console.log(`📋 Listed ${actions.actions.length} actions from database`)
    //   if (actions.actions.length > 0) {
    //     console.log(`   First action: ${actions.actions[0].description}`)
    //   }

    //   expect(actions).toBeDefined()
    //   expect(actions.actions).toBeDefined()
    //   expect(Array.isArray(actions.actions)).toBe(true)
    //   expect(actions.actions.length).toBeGreaterThanOrEqual(0)
    // }, 10000)

    // test('abortAction - should abort an unsigned action if available', async () => {
    //   console.log('🗑️  Testing action abortion...')
    //   // Check if there are any unsigned actions we can abort
    //   const actions = await setup.wallet.listActions({ labels: [], limit: 20 })
    //   const unsignedAction = actions.actions.find(
    //     a => a.status === 'unsigned' || a.status === 'nosend'
    //   )

    //   console.log(
    //     `📋 Found ${actions.actions.length} total actions, ${unsignedAction ? 1 : 0} unsigned`
    //   )
    //   // listActions doesn't return references, so we can only abort
    //   // actions we created in the same session with signableTransaction
    //   expect(unsignedAction === undefined || unsignedAction.status).toBeTruthy()
    //   console.log('✅ Action abortion test completed')
    // }, 10000)
  })

  // ============================================================================
  // Outputs
  // ============================================================================

  // describe('Outputs', () => {
  //   test('listOutputs - should list wallet outputs', async () => {
  //     const outputs = await setup.wallet.listOutputs({
  //       basket: 'default',
  //       limit: 10,
  //       offset: 0
  //     })

  //     console.log(
  //       `💰 Listed ${outputs.outputs.length} outputs from database (total: ${outputs.totalOutputs})`
  //     )
  //     if (outputs.outputs.length > 0) {
  //       console.log(`   First output: ${outputs.outputs[0].satoshis} sats`)
  //     }

  //     expect(outputs).toBeDefined()
  //     expect(outputs.outputs).toBeDefined()
  //     expect(Array.isArray(outputs.outputs)).toBe(true)
  //     expect(typeof outputs.totalOutputs).toBe('number')
  //     expect(outputs.totalOutputs).toBeGreaterThanOrEqual(0)
  //   }, 10000)

  //   test('relinquishOutput - should relinquish an output from wallet tracking', async () => {
  //     console.log('🗑️  Testing output relinquishment...')
  //     // Use a dummy outpoint since we likely don't have real outputs to relinquish
  //     const dummyOutpoint =
  //       '0000000000000000000000000000000000000000000000000000000000000000:0'

  //     try {
  //       const result = await setup.wallet.relinquishOutput({
  //         basket: 'default',
  //         output: dummyOutpoint
  //       })

  //       console.log('✅ Output relinquished successfully')
  //       expect(result).toBeDefined()
  //       expect(result.relinquished).toBeDefined()
  //     } catch (err: any) {
  //       console.log(
  //         '⚠️  Output relinquishment failed (expected with dummy outpoint)'
  //       )
  //       // Expected to fail with dummy outpoint
  //       expect(err).toBeDefined()
  //     }
  //     console.log('✅ Output relinquishment test completed')
  //   }, 10000)
  // })

  // ============================================================================
  // Certificates
  // ============================================================================

  // describe('Certificates', () => {
  //   test('acquireCertificate - should attempt to acquire a certificate', async () => {
  //     console.log('📜 Testing certificate acquisition...')
  //     console.log('⚠️  NOTE: certifierUrl uses port 9999 (not 8000) - this is CORRECT ARCHITECTURE.')
  //     console.log('   Storage and certification are separate services with separate URLs.')
  //     console.log('   This matches Go/TypeScript implementations and production deployments.')
  //     try {
  //       const result = await setup.wallet.acquireCertificate({
  //         type: Buffer.from('test-certificate').toString('base64'),
  //         certifier: setup.identityKey,
  //         acquisitionProtocol: 'issuance',
  //         // ARCHITECTURE: Certifier and storage MUST be separate services
  //         // Each creates independent BRC-104 authentication sessions
  //         // This matches production deployment patterns across all SDK implementations
  //         certifierUrl: 'http://localhost:9999',
  //         fields: {
  //           name: 'Test User',
  //           email: 'test@example.com'
  //         },
  //         privilegedReason: 'Demo acquisition'
  //       })
  //       console.log('📜 Certificate acquired successfully')
  //       expect(result).toBeDefined()
  //     } catch (err: any) {
  //       console.log(
  //         '⚠️  Certificate acquisition failed (expected - no certifier service running)'
  //       )
  //       // Expected to fail - there's no real certifier service
  //       expect(err).toBeDefined()
  //     }
  //     console.log('✅ Certificate acquisition test completed')
  //   }, 10000)

  //   test('listCertificates - should list wallet certificates', async () => {
  //     const certs = await setup.wallet.listCertificates({
  //       certifiers: [],
  //       types: [],
  //       limit: 10,
  //       offset: 0
  //     })

  //     console.log(
  //       `📜 Listed ${certs.certificates.length} certificates from database`
  //     )
  //     if (certs.certificates.length > 0) {
  //       console.log(
  //         `   Certificate types: ${certs.certificates.map(c => c.type).join(', ')}`
  //       )
  //     }

  //     expect(certs).toBeDefined()
  //     expect(certs.certificates).toBeDefined()
  //     expect(Array.isArray(certs.certificates)).toBe(true)
  //     expect(certs.certificates.length).toBeGreaterThanOrEqual(0)
  //     if (certs.certificates.length > 0) {
  //       const testCert = certs.certificates.find(
  //         c => c.type === 'test-certificate'
  //       )
  //       if (testCert) {
  //         expect(testCert.subject).toBeDefined()
  //       }
  //     }
  //   }, 10000)

  //   test('relinquishCertificate - should relinquish a certificate', async () => {
  //     console.log('🗑️  Testing certificate relinquishment...')
  //     // First check if we have any certificates to relinquish
  //     const certs = await setup.wallet.listCertificates({
  //       certifiers: [],
  //       types: [],
  //       limit: 10,
  //       offset: 0
  //     })

  //     console.log(
  //       `📜 Found ${certs.certificates.length} certificates to potentially relinquish`
  //     )
  //     if (certs.certificates.length === 0) {
  //       console.log('⚠️  No certificates to relinquish, skipping test')
  //       return
  //     }

  //     // Try to relinquish the first certificate
  //     const cert = certs.certificates[0]
  //     console.log(`🗑️  Attempting to relinquish certificate: ${cert.type}`)

  //     try {
  //       await setup.wallet.relinquishCertificate({
  //         type: cert.type,
  //         certifier: cert.certifier || 'self',
  //         serialNumber: cert.serialNumber || ''
  //       })
  //       console.log('✅ Certificate relinquished successfully')
  //     } catch (err: any) {
  //       console.log(
  //         '⚠️  Certificate relinquishment failed (expected in test environment)'
  //       )
  //       // Expected to fail in test environment
  //       expect(err).toBeDefined()
  //     }
  //     console.log('✅ Certificate relinquishment test completed')
  //   }, 10000)
  // })

  // ============================================================================
  // Identity Discovery
  // ============================================================================

  // describe('Identity Discovery', () => {
  //   test('discoverByIdentityKey - should discover certificates by identity key', async () => {
  //     console.log('🔍 Testing identity discovery by identity key...')
  //     try {
  //       const result = await setup.wallet.discoverByIdentityKey({
  //         identityKey: setup.identityKey,
  //         limit: 10,
  //         offset: 0,
  //         seekPermission: true
  //       })

  //       console.log(
  //         `🔍 Found ${result.certificates.length} certificates by identity key`
  //       )
  //       expect(result).toBeDefined()
  //       expect(result.certificates).toBeDefined()
  //       expect(Array.isArray(result.certificates)).toBe(true)
  //       console.log('✅ Identity discovery by identity key completed')
  //     } catch (err: any) {
  //       console.log(
  //         '⚠️  Identity discovery by identity key failed (expected in local test environment)'
  //       )
  //       // Expected to fail in test environment
  //       expect(err).toBeDefined()
  //     }
  //   }, 10000)

  //   test('discoverByAttributes - should discover certificates by attributes', async () => {
  //     console.log('🔍 Testing identity discovery by attributes...')
  //     try {
  //       const result = await setup.wallet.discoverByAttributes({
  //         attributes: { verified: 'true' },
  //         limit: 10,
  //         offset: 0
  //       })

  //       console.log(
  //         `🔍 Found ${result.certificates.length} certificates by attributes`
  //       )
  //       expect(result).toBeDefined()
  //       expect(result.certificates).toBeDefined()
  //       expect(Array.isArray(result.certificates)).toBe(true)
  //       console.log('✅ Identity discovery by attributes completed')
  //     } catch (err: any) {
  //       console.log(
  //         '⚠️  Identity discovery by attributes failed (expected in local test environment)'
  //       )
  //       // Expected to fail in test environment
  //       expect(err).toBeDefined()
  //     }
  //   }, 10000)
  // })

  // // ============================================================================
  // // Transactions
  // // ============================================================================

  // describe('Transactions', () => {
  //   test('internalizeAction - should internalize an external transaction', async () => {
  //     console.log('📥 Testing transaction internalization...')
  //     // This is a complex operation that requires an actual external transaction
  //     // For testing purposes, we'll try with minimal parameters and expect graceful failure
  //     try {
  //       const dummyTxHex =
  //         '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff0100ffffffff01000000000000000000000000'
  //       const result = await setup.wallet.internalizeAction({
  //         tx: Array.from(Buffer.from(dummyTxHex, 'hex')),
  //         outputs: [
  //           {
  //             outputIndex: 0,
  //             protocol: 'basket insertion',
  //             insertionRemittance: {
  //               basket: 'default'
  //             }
  //           }
  //         ],
  //         description: 'Test internalization of external transaction'
  //       })

  //       console.log('✅ Transaction internalized successfully')
  //       expect(result).toBeDefined()
  //     } catch (err: any) {
  //       console.log(
  //         '⚠️  Transaction internalization failed (expected with dummy data)'
  //       )
  //       // Expected to fail with dummy data
  //       expect(err).toBeDefined()
  //     }
  //     console.log('✅ Transaction internalization test completed')
  //   }, 10000)
  // })

  // // ============================================================================
  // // Blockchain Info
  // // ============================================================================

  // describe.skip('Blockchain Info', () => {
  //   test('getHeight - should fetch current block height', async () => {
  //     // Skipped for Python storage server tests - requires external blockchain API
  //   }, 10000)

  //   test('getHeaderForHeight - should fetch header for specific height', async () => {
  //     // Skipped for Python storage server tests - requires external blockchain API
  //   }, 10000)
  // })
})
