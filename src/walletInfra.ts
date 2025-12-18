import {
  Beef,
  BEEF_V2,
  InternalizeActionArgs,
  MerklePath,
  P2PKH,
  Script,
  Transaction
} from '@bsv/sdk'
import { PrivateKey } from '@bsv/sdk'
import { Setup, Services } from '@bsv/wallet-toolbox'
import { Chain } from '@bsv/wallet-toolbox'
import { runArgv2Function } from './runArgv2Function'
import * as readline from 'readline'

/**
 * Default local wallet-infra endpoint URL.
 * This matches the default port in wallet-infra's docker-compose setup.
 */
const DEFAULT_WALLET_INFRA_URL = 'http://localhost:8080'

/**
 * Helper to prompt user for input.
 */
function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
  const displayQuestion = defaultValue
    ? `${question} [Enter=${defaultValue}]: `
    : `${question}: `
  return new Promise(resolve => {
    rl.question(displayQuestion, answer => {
      rl.close()
      resolve(answer.trim() || defaultValue || '')
    })
  })
}

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
  console.log(`🔍 Parsing raw transaction (${rawTxHex.length} chars)...`)

  // Parse the raw transaction
  const tx = Transaction.fromHex(rawTxHex)
  const txid = tx.id('hex')

  console.log(`✅ Transaction parsed`)
  console.log(`   TXID: ${txid}`)
  console.log(`   Inputs: ${tx.inputs.length}, Outputs: ${tx.outputs.length}`)

  // Debug: check inputs
  for (let i = 0; i < tx.inputs.length; i++) {
    const input = tx.inputs[i]
    console.log(
      `   Input ${i}: ${input.sourceTXID} (vout: ${input.sourceOutputIndex})`
    )
  }

  // Create Atomic BEEF
  const beef = new Beef(BEEF_V2)

  // Try to fetch merkle proof if the transaction is mined
  try {
    const services = new Services(chain)
    console.log(`🔎 Looking up merkle proof for txid: ${txid}...`)

    const merkleResult = await services.getMerklePath(txid)
    console.log({ merkleResult })
    if (merkleResult && merkleResult.merklePath) {
      // Attach merkle path to transaction - mergeTransaction will handle it
      tx.merklePath = merkleResult.merklePath
      console.log(
        `✅ Merkle proof found (height: ${merkleResult.merklePath.blockHeight})`
      )
    } else {
      console.log(`⚠️  No merkle proof found - transaction may be unconfirmed`)
    }
  } catch (error: any) {
    console.log(`⚠️  Failed to fetch merkle proof: ${error.message}`)
  }

  // Add transaction to BEEF
  beef.mergeTransaction(tx)

  // Use toBinaryAtomic() to create proper Atomic BEEF format
  const atomicBeef = beef.toBinaryAtomic(txid)

  console.log(`✅ Atomic BEEF built successfully`)
  console.log(`   Size: ${atomicBeef.length} bytes`)

  return { atomicBeef, txid }
}

/**
 * Internalize a raw transaction hex into wallet-infra storage.
 *
 * This function takes a raw transaction hex, builds Atomic BEEF (with merkle proof if mined),
 * and imports the specified output into the wallet storage using the basket insertion protocol.
 *
 * Run: `npx tsx walletInfra internalizeRawTx`
 *
 * @publicbody
 */
export async function internalizeRawTx(): Promise<void> {
  const endpointUrl = process.env.WALLET_INFRA_URL || DEFAULT_WALLET_INFRA_URL

  console.log(`
================================================================================
🏗️  Internalize Raw Transaction
================================================================================
`)

  try {
    // Get raw transaction hex
    const rawTxHex =
      process.env.RAW_TX ||
      (await prompt(
        'Raw transaction hex',
        '010000000103cb9012f93af9225957a2840b0850b5d438042a64720ca5f2bfa3d19014f627000000006b483045022100ac09a089f417587f2e8e74c66e9111fed55523df3b9e522e075d3744a0480f6902206a9e0c2b9e9fd528b0f910e774df91b209eb5f327f6ce7e836a24e0052ce828e412102ecc1a2735aa3a5aab36b6d215cd48f764c7552851d2d3ffe800ac08551ad1338ffffffff02e8030000000000001976a9140d227bc5e21d6c4bde15776cf767e646f78f1aa488ac90810100000000001976a9141cb6822fa326ce07ed55b10762d94db77272376d88ac00000000'
      ))

    // Get output index to internalize
    const outputIndexStr =
      process.env.OUTPUT_INDEX ||
      (await prompt('Output index to internalize', '0'))
    const outputIndex = parseInt(outputIndexStr, 10)

    if (isNaN(outputIndex) || outputIndex < 0) {
      console.log(`❌ Invalid output index: ${outputIndexStr}`)
      return
    }

    // Read the secrets from .env file created by 'makeEnv'
    const env = Setup.getEnv('test')

    // Create a wallet client connected to your local wallet-infra server
    const setup = await Setup.createWalletClient({
      env,
      rootKeyHex: env.devKeys[env.identityKey],
      endpointUrl
    })

    console.log(`✅ Connected successfully!`)
    console.log(`   Identity Key: ${setup.identityKey}`)
    console.log(`   Chain: ${setup.chain}`)
    console.log(`   Endpoint: ${setup.endpointUrl}`)
    console.log()

    // Build Atomic BEEF from raw transaction
    const { atomicBeef, txid } = await buildAtomicBeefFromRawTx(
      rawTxHex,
      setup.chain
    )
    const outpoint = `${txid}.${outputIndex}`

    console.log(`\n📍 Internalizing output: ${outpoint}`)
    console.log()

    // Internalize the transaction output using basket insertion protocol
    // NOTE: 'basket insertion' creates custom outputs that don't count toward balance!
    // Use 'external-utxos' basket to track these for later spending.
    const internalizeArgs: InternalizeActionArgs = {
      tx: atomicBeef,
      outputs: [
        {
          outputIndex,
          protocol: 'basket insertion',
          insertionRemittance: {
            basket: 'external-utxos',
            tags: ['wallet-infra-example', 'internalized', 'external-funding']
          }
        }
      ],
      description: `Internalized output ${outpoint}`,
      labels: [`txid:${txid}`, 'internalized']
    }

    console.log(`🚀 Internalizing transaction...`)
    const result = await setup.wallet.internalizeAction(internalizeArgs)

    console.log(`
================================================================================
✅ Transaction Internalized!
================================================================================
   TXID: ${txid}
   Outpoint: ${outpoint}
   Status: Transaction accepted

   View on explorer:
   https://${setup.chain === 'main' ? '' : 'test.'}whatsonchain.com/tx/${txid}
================================================================================
`)
  } catch (error: any) {
    console.error(`
❌ Internalization failed!

   Error: ${error.message}

   Possible issues:
   1. Is wallet-infra running? Start with: docker-compose up
   2. Is the raw transaction hex valid?
   3. Is the output index correct?
   4. Does this output belong to your wallet?

================================================================================
`)
    process.exit(1)
  }
}

/**
 * Main entry point - checks balance and shows receive address if empty.
 *
 * Run: `npx tsx walletInfra`
 *
 * @publicbody
 */
export async function walletInfra(): Promise<void> {
  const endpointUrl = process.env.WALLET_INFRA_URL || DEFAULT_WALLET_INFRA_URL

  console.log(`
================================================================================
🔗 Connecting to wallet-infra at: ${endpointUrl}
================================================================================
`)

  try {
    // Read the secrets from .env file created by 'makeEnv'
    const env = Setup.getEnv('test')

    // Create a wallet client connected to your local wallet-infra server
    const setup = await Setup.createWalletClient({
      env,
      rootKeyHex: env.devKeys[env.identityKey],
      endpointUrl
    })

    console.log(`✅ Connected successfully!`)
    console.log(`   Identity Key: ${setup.identityKey}`)
    console.log(`   Chain: ${setup.chain}`)
    console.log(`   Endpoint: ${setup.endpointUrl}`)

    // Get the wallet balance
    const balance = await setup.wallet.balance()

    console.log(`
================================================================================
💰 Wallet Balance: ${balance} satoshis
================================================================================
`)

    // If balance is zero, show how to fund the wallet
    if (balance === 0) {
      // Use correct address prefix based on chain (testnet vs mainnet)
      const addressPrefix = setup.chain === 'main' ? 'mainnet' : 'testnet'
      const address = PrivateKey.fromString(env.devKeys[env.identityKey])
        .toPublicKey()
        .toAddress(addressPrefix)

      console.log(`
⚠️  Your wallet has no funds!

To get started, send testnet BSV to your wallet:

   📍 Your Testnet Address:
   ${address}

   🚰 Get free testnet coins from:
   https://scrypt.io/faucet/

   📋 Steps:
   1. Copy your address above
   2. Visit the faucet URL
   3. Paste your address and request coins
   4. Wait for confirmation (~10 seconds)
   5. Run this command again to check your balance

   🔍 View on explorer:
   https://${setup.chain === 'main' ? '' : 'test.'}whatsonchain.com/address/${address}

================================================================================
`)
    } else {
      // Show outputs summary
      const outputs = await setup.wallet.listOutputs({
        basket: 'default',
        limit: 5
      })
      console.log(`📦 Outputs in 'default' basket: ${outputs.totalOutputs}`)

      if (outputs.outputs.length > 0) {
        console.log(`\n   Recent outputs:`)
        for (const output of outputs.outputs) {
          console.log(`   • ${output.outpoint}: ${output.satoshis} sats`)
        }
      }
      console.log('')
    }
  } catch (error: any) {
    console.error(`
❌ Connection failed!

   Error: ${error.message}

   Possible issues:
   1. Is wallet-infra running? Start with: docker-compose up
   2. Is the URL correct? Currently: ${endpointUrl}
   3. Do you have a .env file? Generate with: npx tsx makeEnv > .env

================================================================================
`)
    process.exit(1)
  }
}

/**
 * Connect to wallet-infra without requiring a .env file.
 *
 * This is useful for quick testing or when you want to manage keys differently.
 *
 * Run: `npx tsx walletInfra walletInfraNoEnv`
 *
 * @publicbody
 */
export async function walletInfraNoEnv(): Promise<void> {
  const endpointUrl = process.env.WALLET_INFRA_URL || DEFAULT_WALLET_INFRA_URL

  // Generate a new random key for testing, or use your own
  const rootKey = process.env.ROOT_KEY_HEX || PrivateKey.fromRandom().toHex()

  console.log(`
================================================================================
🔗 Connecting to wallet-infra (no .env) at: ${endpointUrl}
================================================================================
`)

  // Create wallet client without .env file
  const wallet = await Setup.createWalletClientNoEnv({
    chain: 'test',
    rootKeyHex: rootKey,
    storageUrl: endpointUrl
  })

  const identityKey = (await wallet.getPublicKey({ identityKey: true }))
    .publicKey

  console.log(`✅ Connected successfully!`)
  console.log(`   Identity Key: ${identityKey}`)

  // Get the wallet balance
  const balance = await wallet.balance()

  console.log(`
================================================================================
💰 Wallet Balance: ${balance} satoshis
================================================================================
`)

  // List any outputs in the default basket
  const outputs = await wallet.listOutputs({ basket: 'default', limit: 10 })
  console.log(`📦 Outputs in 'default' basket: ${outputs.totalOutputs}`)

  if (outputs.outputs.length > 0) {
    console.log(`\n   Recent outputs:`)
    for (const output of outputs.outputs.slice(0, 5)) {
      console.log(`   - ${output.outpoint}: ${output.satoshis} sats`)
    }
  }
}

/**
 * List actions from your wallet-infra connected wallet.
 *
 * Run: `npx tsx walletInfra walletInfraListActions`
 *
 * @publicbody
 */
export async function walletInfraListActions(): Promise<void> {
  const endpointUrl = process.env.WALLET_INFRA_URL || DEFAULT_WALLET_INFRA_URL
  const env = Setup.getEnv('test')

  console.log(`
================================================================================
📋 Listing Actions from wallet-infra at: ${endpointUrl}
================================================================================
`)

  const setup = await Setup.createWalletClient({
    env,
    rootKeyHex: env.devKeys[env.identityKey],
    endpointUrl
  })

  // List recent actions
  const actions = await setup.wallet.listActions({
    labels: [],
    limit: 10,
    includeLabels: true,
    includeInputs: true,
    includeOutputs: true
  })

  console.log(`\n📜 Total actions: ${actions.totalActions}`)

  if (actions.actions.length > 0) {
    console.log(`\n   Recent actions:`)
    for (const action of actions.actions) {
      console.log(`
   ─────────────────────────────────────────
   TXID: ${action.txid}
   Description: ${action.description}
   Status: ${action.status}
   Satoshis: ${action.satoshis}
   Labels: ${action.labels?.join(', ') || 'none'}
   Version: ${action.version}`)
    }
  } else {
    console.log(`\n   No actions found.`)
  }
}

/**
 * Create a simple OP_RETURN data transaction using wallet-infra.
 *
 * Run: `npx tsx walletInfra walletInfraCreateData`
 *
 * @publicbody
 */
export async function walletInfraCreateData(): Promise<void> {
  const endpointUrl = process.env.WALLET_INFRA_URL || DEFAULT_WALLET_INFRA_URL
  const env = Setup.getEnv('test')

  console.log(`
================================================================================
📝 Creating Data Transaction via wallet-infra at: ${endpointUrl}
================================================================================
`)

  const setup = await Setup.createWalletClient({
    env,
    rootKeyHex: env.devKeys[env.identityKey],
    endpointUrl
  })

  // Check balance first
  const balance = await setup.wallet.balance()
  console.log(`\n💰 Current balance: ${balance} satoshis`)

  if (balance < 100) {
    console.log(`\n⚠️  Insufficient balance. Please fund your wallet first.`)
    console.log(
      `   Your address: ${(await setup.wallet.getPublicKey({ identityKey: true })).publicKey}`
    )
    return
  }

  // Create a simple OP_RETURN transaction with embedded data
  const message = `Hello from wallet-infra! Timestamp: ${new Date().toISOString()}`
  const dataHex = Buffer.from(message).toString('hex')

  // OP_FALSE OP_RETURN <data>
  const opReturnScript = `006a${(dataHex.length / 2).toString(16).padStart(2, '0')}${dataHex}`

  const result = await setup.wallet.createAction({
    description: 'wallet-infra data transaction example',
    outputs: [
      {
        lockingScript: opReturnScript,
        satoshis: 0,
        outputDescription: 'OP_RETURN data'
      }
    ],
    labels: ['wallet-infra-example', 'data'],
    options: {
      acceptDelayedBroadcast: false
    }
  })

  console.log(`
================================================================================
✅ Transaction Created!
================================================================================
   TXID: ${result.txid}
   Message: "${message}"
   
   View on explorer:
   https://test.whatsonchain.com/tx/${result.txid}
================================================================================
`)
}

/**
 * Send P2PKH payment using wallet-infra.
 *
 * Run: `npx tsx walletInfra walletInfraSendP2PKH`
 *
 * @publicbody
 */
export async function walletInfraSendP2PKH(): Promise<void> {
  const endpointUrl = process.env.WALLET_INFRA_URL || DEFAULT_WALLET_INFRA_URL
  const env = Setup.getEnv('test')

  // Get recipient address from environment or use identity key 2
  const recipientAddress = process.env.RECIPIENT_ADDRESS
  const satoshisToSend = parseInt(process.env.SATOSHIS_TO_SEND || '100', 10)

  console.log(`
================================================================================
💸 Sending P2PKH Payment via wallet-infra at: ${endpointUrl}
================================================================================
`)

  const setup = await Setup.createWalletClient({
    env,
    rootKeyHex: env.devKeys[env.identityKey],
    endpointUrl
  })

  // Check balance first
  const balance = await setup.wallet.balance()
  console.log(`\n💰 Current balance: ${balance} satoshis`)

  if (balance < satoshisToSend + 100) {
    // Need extra for fees
    console.log(`\n⚠️  Insufficient balance to send ${satoshisToSend} sats.`)
    return
  }

  // If no recipient provided, create self-payment for testing
  let toAddress: string
  const addressPrefix = setup.chain === 'main' ? 'mainnet' : 'testnet'
  if (recipientAddress) {
    toAddress = recipientAddress
  } else {
    // Send to identity key 2 for testing
    toAddress = PrivateKey.fromString(env.devKeys[env.identityKey2])
      .toPublicKey()
      .toAddress(addressPrefix)
    console.log(
      `\n📍 No RECIPIENT_ADDRESS set, sending to identity key 2: ${toAddress}`
    )
  }

  // Create P2PKH output
  const lockingScript = Setup.getLockP2PKH(toAddress).toHex()

  const result = await setup.wallet.createAction({
    description: `P2PKH payment: ${satoshisToSend} sats`,
    outputs: [
      {
        lockingScript,
        satoshis: satoshisToSend,
        outputDescription: `P2PKH to ${toAddress}`
      }
    ],
    labels: ['wallet-infra-example', 'p2pkh'],
    options: {
      acceptDelayedBroadcast: false,
      randomizeOutputs: false
    }
  })

  console.log(`
================================================================================
✅ Payment Sent!
================================================================================
   TXID: ${result.txid}
   Amount: ${satoshisToSend} satoshis
   To: ${toAddress}
   
   View on explorer:
   https://test.whatsonchain.com/tx/${result.txid}
================================================================================
`)
}

/**
 * Test transaction parsing and BEEF building without wallet-infra connection.
 *
 * Run: `npx tsx walletInfra testParseRawTx`
 *
 * @publicbody
 */
export async function testParseRawTx(): Promise<void> {
  console.log(`
================================================================================
🧪 Test Raw Transaction Parsing
================================================================================
`)

  // Get raw transaction hex
  const rawTxHex =
    process.env.RAW_TX ||
    (await prompt(
      'Raw transaction hex',
      '010000000103cb9012f93af9225957a2840b0850b5d438042a64720ca5f2bfa3d19014f627000000006b483045022100ac09a089f417587f2e8e74c66e9111fed55523df3b9e522e075d3744a0480f6902206a9e0c2b9e9fd528b0f910e774df91b209eb5f327f6ce7e836a24e0052ce828e412102ecc1a2735aa3a5aab36b6d215cd48f764c7552851d2d3ffe800ac08551ad1338ffffffff02e8030000000000001976a9140d227bc5e21d6c4bde15776cf767e646f78f1aa488ac90810100000000001976a9141cb6822fa326ce07ed55b10762d94db77272376d88ac00000000'
    ))

  try {
    // Build Atomic BEEF from raw transaction
    const { atomicBeef, txid } = await buildAtomicBeefFromRawTx(
      rawTxHex,
      'test'
    )

    console.log(`
================================================================================
✅ Transaction Parsed Successfully!
================================================================================
   TXID: ${txid}
   Atomic BEEF Size: ${atomicBeef.length} bytes

   To internalize this transaction into wallet-infra:
   1. Start wallet-infra: docker-compose up
   2. Run: npx tsx walletInfra internalizeRawTx
================================================================================
`)
  } catch (error: any) {
    console.error(`
❌ Transaction parsing failed!

   Error: ${error.message}

   Possible issues:
   1. Is the raw transaction hex valid?
   2. Check the hex format (should be 64 hex characters per byte)

================================================================================
`)
    process.exit(1)
  }
}

/**
 * Display wallet info and receive address for funding from faucet.
 *
 * Run: `npx tsx walletInfra walletInfraReceive`
 *
 * @publicbody
 */
export async function walletInfraReceive(): Promise<void> {
  const endpointUrl = process.env.WALLET_INFRA_URL || DEFAULT_WALLET_INFRA_URL
  const env = Setup.getEnv('test')

  console.log(`
================================================================================
📬 Wallet Receive Address (wallet-infra: ${endpointUrl})
================================================================================
`)

  const setup = await Setup.createWalletClient({
    env,
    rootKeyHex: env.devKeys[env.identityKey],
    endpointUrl
  })

  // Get identity key for P2PKH address - use correct prefix based on chain
  const identityKey = setup.identityKey
  const addressPrefix = setup.chain === 'main' ? 'mainnet' : 'testnet'
  const address = PrivateKey.fromString(env.devKeys[env.identityKey])
    .toPublicKey()
    .toAddress(addressPrefix)

  const balance = await setup.wallet.balance()

  console.log(`
   Identity Key: ${identityKey}
   
   📍 Receive Address (P2PKH):
   ${address}
   
   💰 Current Balance: ${balance} satoshis
   
   🚰 Get testnet coins from faucet:
   https://scrypt.io/faucet/
   
   Then internalize the transaction using the internalize example.
================================================================================
`)
}

/**
 * Fund wallet from an external P2PKH output (like from a faucet).
 *
 * This is the CORRECT way to add external funds to your wallet. It:
 * 1. Takes a raw transaction with an output locked to your wallet's address
 * 2. Spends that output, creating proper wallet change that counts toward balance
 *
 * IMPORTANT: The output must be a P2PKH locked to your wallet's identity key address.
 *
 * Run: `RAW_TX="hex" OUTPUT_INDEX="0" WALLET_INFRA_URL=http://localhost:8080 npx tsx walletInfra fundFromExternal`
 *
 * @publicbody
 */
export async function fundFromExternal(): Promise<void> {
  const endpointUrl = process.env.WALLET_INFRA_URL || DEFAULT_WALLET_INFRA_URL
  const env = Setup.getEnv('test')

  console.log(`
================================================================================
💰 Fund Wallet from External P2PKH Output
================================================================================

This function takes an external P2PKH output (like from a faucet) and converts
it to proper wallet change that counts toward your balance.

NOTE: Do NOT use 'internalizeRawTx' for funding - that creates custom outputs
      that don't count toward balance. Use this function instead!
`)

  const setup = await Setup.createWalletClient({
    env,
    rootKeyHex: env.devKeys[env.identityKey],
    endpointUrl
  })

  console.log(`✅ Connected successfully!`)
  console.log(`   Identity Key: ${setup.identityKey}`)
  console.log(`   Chain: ${setup.chain}`)

  // Get the wallet's identity key and address
  const addressPrefix = setup.chain === 'main' ? 'mainnet' : 'testnet'
  const identityPrivKey = PrivateKey.fromString(env.devKeys[env.identityKey])
  const walletAddress = identityPrivKey.toPublicKey().toAddress(addressPrefix)
  const walletPubKeyHash = Buffer.from(
    identityPrivKey.toPublicKey().toHash()
  ).toString('hex')

  console.log(`   Your wallet address: ${walletAddress}`)
  console.log()

  // Get raw transaction hex
  const rawTxHex =
    process.env.RAW_TX ||
    (await prompt('Raw transaction hex containing the output to spend', ''))

  if (!rawTxHex) {
    console.log(`❌ No raw transaction provided.`)
    return
  }

  // Get output index
  const outputIndexStr =
    process.env.OUTPUT_INDEX || (await prompt('Output index to spend', '0'))
  const outputIndex = parseInt(outputIndexStr, 10)

  // Parse the transaction
  const tx = Transaction.fromHex(rawTxHex)
  const txid = tx.id('hex')

  if (outputIndex < 0 || outputIndex >= tx.outputs.length) {
    console.log(
      `❌ Invalid output index: ${outputIndex}. Transaction has ${tx.outputs.length} outputs.`
    )
    return
  }

  const sourceOutput = tx.outputs[outputIndex]
  const outpoint = `${txid}.${outputIndex}`

  console.log(`🔍 Analyzing output: ${outpoint}`)
  console.log(`   Satoshis: ${sourceOutput.satoshis}`)

  // Verify this output belongs to the wallet
  const outputScript = sourceOutput.lockingScript.toHex()
  const outputPubKeyHash = outputScript.slice(6, 46) // Extract hash from P2PKH script

  if (outputPubKeyHash !== walletPubKeyHash) {
    console.log(`
❌ This output does NOT belong to your wallet!

   Output locked to: ${outputPubKeyHash}
   Your wallet hash:  ${walletPubKeyHash}

   The output must be a P2PKH locked to your wallet's address: ${walletAddress}
`)
    return
  }

  console.log(`✅ Output belongs to your wallet`)
  console.log()

  // Build BEEF for the input transaction
  console.log(`🔎 Looking up merkle proof for input transaction...`)
  const { atomicBeef } = await buildAtomicBeefFromRawTx(rawTxHex, setup.chain)

  console.log(`
🔄 Creating funding transaction...
   This will spend the external output and route funds to your wallet as change.
`)

  try {
    // Create simple OP_RETURN output (marker for the funding tx)
    const message = `Fund: ${new Date().toISOString()}`
    const dataHex = Buffer.from(message).toString('hex')
    const opReturnScript = `006a${(dataHex.length / 2).toString(16).padStart(2, '0')}${dataHex}`

    // Create action with the external output as input
    const result = await setup.wallet.createAction({
      description: `Fund wallet from external: ${outpoint}`,
      inputBEEF: atomicBeef,
      inputs: [
        {
          outpoint,
          unlockingScriptLength: 108, // Standard P2PKH unlocking script
          inputDescription: 'External P2PKH funding'
        }
      ],
      outputs: [
        {
          lockingScript: opReturnScript,
          satoshis: 0,
          outputDescription: 'Funding marker'
        }
      ],
      labels: ['wallet-funding', 'external-p2pkh'],
      options: {
        acceptDelayedBroadcast: false
      }
    })

    if (result.signableTransaction) {
      console.log(`📝 Signing transaction...`)

      // Parse the signable transaction
      const signableTx = Transaction.fromBEEF(result.signableTransaction.tx)

      // Create P2PKH unlocker and sign
      const unlockingScript = await new P2PKH()
        .unlock(
          identityPrivKey,
          'all',
          false,
          sourceOutput.satoshis,
          sourceOutput.lockingScript
        )
        .sign(signableTx, 0)

      const signResult = await setup.wallet.signAction({
        reference: result.signableTransaction.reference,
        spends: {
          0: {
            unlockingScript: unlockingScript.toHex()
          }
        },
        options: { acceptDelayedBroadcast: false }
      })

      // Get new balance
      const newBalance = await setup.wallet.balance()

      console.log(`
================================================================================
✅ Wallet Funded Successfully!
================================================================================
   Source Output: ${outpoint}
   Amount: ${sourceOutput.satoshis} satoshis (minus fees)
   Funding TX: ${signResult.txid}
   
   New Balance: ${newBalance} satoshis
   
   View on explorer:
   https://${setup.chain === 'main' ? '' : 'test.'}whatsonchain.com/tx/${signResult.txid}
================================================================================
`)
    } else if (result.txid) {
      const newBalance = await setup.wallet.balance()
      console.log(`
================================================================================
✅ Wallet Funded!
================================================================================
   TXID: ${result.txid}
   New Balance: ${newBalance} satoshis
   
   View on explorer:
   https://${setup.chain === 'main' ? '' : 'test.'}whatsonchain.com/tx/${result.txid}
================================================================================
`)
    }
  } catch (error: any) {
    console.error(`
❌ Funding failed!

   Error: ${error.message}

   Common issues:
   1. The output may already be spent on-chain
   2. The transaction may not be confirmed yet
   3. Network connectivity issues

================================================================================
`)
  }
}

runArgv2Function(module.exports)
