import { PrivateKey, Utils } from '@bsv/sdk'
import { Setup, SetupWalletClient } from '@bsv/wallet-toolbox'
import { runArgv2Function } from './runArgv2Function'
import * as readline from 'readline'

/**
 * Default local wallet-infra endpoint URL.
 */
const DEFAULT_WALLET_INFRA_URL = 'http://localhost:8080'

// ============================================================================
// Setup Helpers
// ============================================================================

/**
 * Create a wallet setup connected to wallet-infra (or default Babbage storage).
 */
async function createSetup(): Promise<SetupWalletClient> {
  const endpointUrl = process.env.WALLET_INFRA_URL || DEFAULT_WALLET_INFRA_URL
  const env = Setup.getEnv('test')

  return await Setup.createWalletClient({
    env,
    rootKeyHex: env.devKeys[env.identityKey],
    endpointUrl
  })
}

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
 * Helper to wait for Enter key.
 */
function waitForEnter(): Promise<void> {
  return prompt('\nPress Enter to continue...').then(() => {})
}

// ============================================================================
// Wallet Info
// ============================================================================

/**
 * Display wallet info including address and balance.
 */
export async function walletInfo(): Promise<void> {
  const setup = await createSetup()
  const addressPrefix = setup.chain === 'main' ? 'mainnet' : 'testnet'
  const env = Setup.getEnv(setup.chain)

  console.log(`
================================================================================
💰 Wallet Information
================================================================================
`)

  const address = PrivateKey.fromString(env.devKeys[env.identityKey])
    .toPublicKey()
    .toAddress(addressPrefix)

  console.log(`📍 Receive address:`)
  console.log(`   ${address}`)
  console.log()

  try {
    const balance = await setup.wallet.balance()
    const balanceBsv = balance / 100_000_000
    console.log(`💰 Current balance:`)
    console.log(
      `   ${balance.toLocaleString()} sats (${balanceBsv.toFixed(8)} BSV)`
    )
    console.log()
  } catch (err: any) {
    console.log(`⚠️  Failed to fetch balance: ${err.message}`)
    console.log()
  }

  console.log(`💳 Payment URI (0.001 BSV):`)
  console.log(`   bitcoin:${address}?amount=0.001`)
  console.log()

  console.log(
    `================================================================================`
  )
  console.log(`📋 Explorer`)
  console.log(
    `================================================================================`
  )
  console.log()

  if (setup.chain === 'test') {
    console.log(`🔍 Testnet explorer:`)
    console.log(`   https://test.whatsonchain.com/address/${address}`)
    console.log()
    console.log(`💡 Need testnet coins? Use this faucet:`)
    console.log(`   https://scrypt.io/faucet/`)
  } else {
    console.log(`🔍 Mainnet explorer:`)
    console.log(`   https://whatsonchain.com/address/${address}`)
    console.log()
    console.log(`⚠️  You are dealing with real BSV funds.`)
  }
  console.log()
  console.log(
    `================================================================================`
  )
}

// ============================================================================
// Key Management
// ============================================================================

/**
 * Demo: Get a protocol-specific public key.
 */
export async function getPublicKey(): Promise<void> {
  const setup = await createSetup()

  console.log(`\n🔑 Fetching protocol-specific key\n`)

  const protocolName = await prompt('Protocol name', 'test protocol')
  const keyID = await prompt('Key ID', '1')
  const counterparty = await prompt('Counterparty (self/anyone)', 'self')

  try {
    const result = await setup.wallet.getPublicKey({
      identityKey: true,
      protocolID: [0, protocolName],
      keyID,
      counterparty
    })

    console.log(`\n✅ Public key retrieved`)
    console.log(`   Protocol   : ${protocolName}`)
    console.log(`   Key ID     : ${keyID}`)
    console.log(`   Counterparty: ${counterparty}`)
    console.log(`   Public key : ${result.publicKey}`)
  } catch (err: any) {
    console.log(`❌ Failed to get public key: ${err.message}`)
  }
}

/**
 * Demo: Sign data with wallet keys.
 */
export async function signData(): Promise<void> {
  const setup = await createSetup()

  console.log(`\n✍️  Signing data\n`)

  const message = await prompt('Message to sign', 'Hello, BSV!')
  const protocolName = await prompt('Protocol name', 'test protocol')
  const keyID = await prompt('Key ID', '1')

  try {
    const data = Array.from(Buffer.from(message))
    const result = await setup.wallet.createSignature({
      data,
      protocolID: [0, protocolName],
      keyID,
      counterparty: 'self'
    })

    console.log(`\n✅ Signature created`)
    console.log(`   Message  : ${message}`)
    console.log(`   Signature: ${result.signature.slice(0, 64)}...`)
  } catch (err: any) {
    console.log(`❌ Failed to sign message: ${err.message}`)
  }
}

// ============================================================================
// Action Management
// ============================================================================

/**
 * Demo: Create an OP_RETURN action.
 */
export async function createAction(): Promise<void> {
  const setup = await createSetup()

  console.log(`\n📋 Creating a demo action (OP_RETURN message)\n`)

  const message = await prompt('Message to embed', 'Hello, World!')

  try {
    const messageBytes = Buffer.from(message)
    const hexData = messageBytes.toString('hex')
    const length = messageBytes.length
    const lockingScript = `006a${length.toString(16).padStart(2, '0')}${hexData}`

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
        acceptDelayedBroadcast: false
      }
    })

    console.log(`\n✅ Action created`)

    if (action.signableTransaction) {
      console.log(`   Needs signing...`)
      const signed = await setup.wallet.signAction({
        spends: {},
        reference: action.signableTransaction.reference,
        options: { acceptDelayedBroadcast: false }
      })
      console.log(`✅ Action signed & broadcast`)
      console.log(`   TxID: ${signed.txid}`)
    } else {
      console.log(`   TxID: ${action.txid}`)
    }

    const explorer =
      setup.chain === 'main' ? 'whatsonchain.com' : 'test.whatsonchain.com'
    console.log(`\n   View on explorer:`)
    console.log(`   https://${explorer}/tx/${action.txid}`)
  } catch (err: any) {
    console.log(`❌ Failed to create action: ${err.message}`)
  }
}

/**
 * Demo: List recent actions.
 */
export async function listActions(): Promise<void> {
  const setup = await createSetup()

  console.log(`\n📋 Fetching recent actions...\n`)

  try {
    const actions = await setup.wallet.listActions({
      labels: [],
      limit: 10,
      includeLabels: true
    })

    console.log(`✅ Found ${actions.actions.length} actions\n`)

    if (actions.actions.length === 0) {
      console.log(`   (no actions recorded yet)`)
    } else {
      for (let i = 0; i < actions.actions.length; i++) {
        const act = actions.actions[i]
        console.log(`   ${i + 1}. ${act.description}`)
        console.log(`      TXID  : ${act.txid}`)
        console.log(`      Status: ${act.status}`)
        console.log()
      }
    }
  } catch (err: any) {
    console.log(`❌ Failed to list actions: ${err.message}`)
  }
}

/**
 * Demo: Abort a pending action.
 */
export async function abortAction(): Promise<void> {
  const setup = await createSetup()

  console.log(`\n🚫 Aborting an action\n`)

  try {
    const actions = await setup.wallet.listActions({ labels: [], limit: 10 })

    if (actions.actions.length === 0) {
      console.log(`No actions available to abort.`)
      return
    }

    console.log(`Available actions:`)
    for (let i = 0; i < actions.actions.length; i++) {
      const act = actions.actions[i]
      console.log(`   ${i + 1}. ${act.description} (${act.status})`)
    }

    const choice = await prompt('Select action index to abort', '1')
    const idx = parseInt(choice) - 1

    if (idx >= 0 && idx < actions.actions.length) {
      const txid = actions.actions[idx].txid
      const result = await setup.wallet.abortAction({ reference: txid })
      console.log(`\n✅ Action aborted`)
      console.log(`   TXID: ${txid}`)
    } else {
      console.log(`❌ Invalid selection.`)
    }
  } catch (err: any) {
    console.log(`❌ Failed to abort action: ${err.message}`)
  }
}

// ============================================================================
// Crypto Operations
// ============================================================================

/**
 * Demo: Create HMAC.
 */
export async function createHmac(): Promise<void> {
  const setup = await createSetup()

  console.log(`\n🔐 Creating HMAC\n`)

  const message = await prompt('Message', 'Hello, HMAC!')
  const protocolName = await prompt('Protocol name', 'test protocol')
  const keyID = await prompt('Key ID', '1')

  try {
    const data = Array.from(Buffer.from(message))
    const result = await setup.wallet.createHmac({
      data,
      protocolID: [0, protocolName],
      keyID,
      counterparty: 'self'
    })

    console.log(`\n✅ HMAC generated`)
    console.log(`   Message: ${message}`)
    console.log(`   HMAC   : ${result.hmac}`)
  } catch (err: any) {
    console.log(`❌ Failed to create HMAC: ${err.message}`)
  }
}

/**
 * Demo: Verify HMAC.
 */
export async function verifyHmac(): Promise<void> {
  const setup = await createSetup()

  console.log(`\n🔍 Verifying HMAC`)
  console.log(`Creating an HMAC first, then verifying it...\n`)

  const message = 'Test HMAC Verification'
  const protocolName = 'test protocol'
  const keyID = '1'

  try {
    const data = Array.from(Buffer.from(message))
    const createResult = await setup.wallet.createHmac({
      data,
      protocolID: [0, protocolName],
      keyID,
      counterparty: 'self'
    })

    console.log(
      `Generated HMAC preview: ${createResult.hmac.slice(0, 32)}...\n`
    )

    const verifyResult = await setup.wallet.verifyHmac({
      data,
      hmac: createResult.hmac,
      protocolID: [0, protocolName],
      keyID,
      counterparty: 'self'
    })

    console.log(`✅ Verification result: ${verifyResult.valid}`)
  } catch (err: any) {
    console.log(`❌ Failed to verify HMAC: ${err.message}`)
  }
}

/**
 * Demo: Verify signature.
 */
export async function verifySignature(): Promise<void> {
  const setup = await createSetup()

  console.log(`\n🔍 Verifying signature`)
  console.log(`Creating a signature first, then verifying...\n`)

  const message = 'Test Signature Verification'
  const protocolName = 'test protocol'
  const keyID = '1'

  try {
    const data = Array.from(Buffer.from(message))
    const createResult = await setup.wallet.createSignature({
      data,
      protocolID: [0, protocolName],
      keyID,
      counterparty: 'self'
    })

    console.log(`Signature preview : ${createResult.signature.slice(0, 32)}...`)
    console.log()

    const verifyResult = await setup.wallet.verifySignature({
      data,
      signature: createResult.signature,
      protocolID: [0, protocolName],
      keyID,
      counterparty: 'self'
    })

    console.log(`✅ Signature valid: ${verifyResult.valid}`)
  } catch (err: any) {
    console.log(`❌ Failed to verify signature: ${err.message}`)
  }
}

/**
 * Demo: Encrypt and decrypt data.
 */
export async function encryptDecrypt(): Promise<void> {
  const setup = await createSetup()

  console.log(`\n🔐 Encrypting and decrypting data\n`)

  const message = await prompt('Plaintext', 'Secret Message!')
  const protocolName = await prompt('Protocol name', 'encryption protocol')
  const keyID = await prompt('Key ID', '1')

  try {
    const plaintext = Array.from(Buffer.from(message))
    const encryptResult = await setup.wallet.encrypt({
      plaintext,
      protocolID: [0, protocolName],
      keyID,
      counterparty: 'self'
    })

    let cipherPreview: string
    const ciphertext = encryptResult.ciphertext as any
    if (typeof ciphertext === 'string') {
      cipherPreview = ciphertext.slice(0, 64)
    } else if (ciphertext instanceof Uint8Array) {
      cipherPreview = Buffer.from(ciphertext).toString('hex').slice(0, 64)
    } else {
      cipherPreview = String(ciphertext).slice(0, 64)
    }

    console.log(`\n✅ Data encrypted`)
    console.log(`   Plaintext : ${message}`)
    console.log(`   Ciphertext: ${cipherPreview}...`)

    const decryptResult = await setup.wallet.decrypt({
      ciphertext: encryptResult.ciphertext,
      protocolID: [0, protocolName],
      keyID,
      counterparty: 'self'
    })

    const decrypted = Buffer.from(decryptResult.plaintext).toString()
    console.log(`\n✅ Data decrypted`)
    console.log(`   Decrypted message: ${decrypted}`)
    console.log(`   Matches original : ${decrypted === message}`)
  } catch (err: any) {
    console.log(`❌ Encryption demo failed: ${err.message}`)
  }
}

// ============================================================================
// Outputs Management
// ============================================================================

/**
 * Demo: List outputs.
 */
export async function listOutputs(): Promise<void> {
  const setup = await createSetup()

  console.log(`\n📋 Fetching outputs (basket: default)\n`)

  try {
    const outputs = await setup.wallet.listOutputs({
      basket: 'default',
      limit: 10,
      offset: 0
    })

    console.log(`✅ Total outputs: ${outputs.totalOutputs}\n`)

    if (outputs.outputs.length === 0) {
      console.log(`   (no outputs tracked yet)`)
    } else {
      for (let i = 0; i < Math.min(outputs.outputs.length, 10); i++) {
        const output = outputs.outputs[i]
        console.log(`   ${i + 1}. Outpoint : ${output.outpoint}`)
        console.log(`      Satoshis : ${output.satoshis}`)
        console.log(`      Spendable: ${output.spendable}`)
        console.log()
      }
    }
  } catch (err: any) {
    console.log(`❌ Failed to list outputs: ${err.message}`)
  }
}

// ============================================================================
// Blockchain Info
// ============================================================================

/**
 * Demo: Get current block height.
 */
export async function getHeight(): Promise<void> {
  const setup = await createSetup()

  console.log(`\n📊 Fetching current block height...\n`)

  try {
    const result = await setup.wallet.getHeight({})
    console.log(`✅ Height: ${result.height}`)
  } catch (err: any) {
    console.log(`⚠️  Failed to fetch height: ${err.message}`)
    console.log(`   (This is expected until Services are configured.)`)
  }
}

/**
 * Demo: Get header for height.
 */
export async function getHeaderForHeight(): Promise<void> {
  const setup = await createSetup()

  console.log(`\n📊 Fetching block header\n`)

  const heightInput = await prompt('Block height', '1')

  try {
    const height = parseInt(heightInput)
    const result = await setup.wallet.getHeaderForHeight({ height })

    console.log(`\n✅ Header for height ${height}`)
    console.log(`   Header: ${result.header.slice(0, 64)}...`)
  } catch (err: any) {
    console.log(`⚠️  Failed to fetch header: ${err.message}`)
  }
}

// ============================================================================
// Certificate Management
// ============================================================================

/**
 * Demo: Acquire a certificate.
 */
export async function acquireCertificate(): Promise<void> {
  const setup = await createSetup()

  console.log(`\n📜 Acquiring certificate\n`)

  const certType = await prompt('Certificate type', 'test-certificate')
  const name = await prompt('Name', 'Test User')
  const email = await prompt('Email', 'test@example.com')

  try {
    const result = await setup.wallet.acquireCertificate({
      type: certType,
      certifier: setup.identityKey,
      acquisitionProtocol: 'direct',
      fields: { name, email },
      privilegedReason: 'Demo acquisition'
    })

    console.log(`\n✅ Certificate acquired`)
    console.log(`   Type: ${result.type}`)
  } catch (err: any) {
    console.log(`❌ Failed to acquire certificate: ${err.message}`)
  }
}

/**
 * Demo: List certificates.
 */
export async function listCertificates(): Promise<void> {
  const setup = await createSetup()

  console.log(`\n📜 Listing certificates...\n`)

  try {
    const certs = await setup.wallet.listCertificates({
      certifiers: [],
      types: [],
      limit: 10,
      offset: 0
    })

    console.log(`✅ Count: ${certs.certificates.length}\n`)

    if (certs.certificates.length === 0) {
      console.log(`   (no certificates yet)`)
    } else {
      for (let i = 0; i < certs.certificates.length; i++) {
        const cert = certs.certificates[i]
        console.log(`   ${i + 1}. ${cert.type}`)
        console.log(`      Subject: ${cert.subject}`)
        console.log()
      }
    }
  } catch (err: any) {
    console.log(`❌ Failed to list certificates: ${err.message}`)
  }
}

// ============================================================================
// Authentication
// ============================================================================

/**
 * Demo: Wait for authentication.
 */
export async function waitForAuthentication(): Promise<void> {
  const setup = await createSetup()

  console.log(`\n⏳ Waiting for authentication...\n`)

  try {
    const result = await setup.wallet.waitForAuthentication({})
    console.log(`✅ Authenticated: ${result.authenticated}`)
    console.log(`   (Base wallet resolves immediately.)`)
  } catch (err: any) {
    console.log(`❌ Failed to wait for authentication: ${err.message}`)
  }
}

// ============================================================================
// Interactive Menu
// ============================================================================

/**
 * Display the interactive menu.
 */
function showMenu(): void {
  console.log(`
================================================================================
🎮 BSV Wallet Toolbox - BRC-100 Demo (TypeScript)
================================================================================

[Basics]
  1. Show wallet info (address & balance)
  2. Wait for authentication

[Keys & Signatures]
  3. Get public key
  4. Sign data
  5. Verify signature

[Crypto]
  6. Create HMAC
  7. Verify HMAC
  8. Encrypt / decrypt data

[Actions]
  9. Create action (OP_RETURN)
 10. List actions
 11. Abort action

[Outputs]
 12. List outputs

[Certificates]
 13. Acquire certificate
 14. List certificates

[Blockchain Info]
 15. Get block height
 16. Get header for height

  0. Exit

================================================================================
`)
}

/**
 * Interactive BRC-100 demo menu.
 *
 * Run: `npx tsx brc100Demo`
 */
export async function brc100Demo(): Promise<void> {
  const endpointUrl = process.env.WALLET_INFRA_URL || DEFAULT_WALLET_INFRA_URL

  console.log(`
================================================================================
🎉 Welcome to the BRC-100 Wallet Demo (TypeScript)
================================================================================

Connecting to wallet-infra at: ${endpointUrl}

All major BRC-100 methods are available in this menu.
Select any option to trigger the corresponding call.
`)

  // Test connection first
  try {
    const setup = await createSetup()
    console.log(`✅ Connected successfully!`)
    console.log(`   Identity Key: ${setup.identityKey}`)
    console.log(`   Chain: ${setup.chain}`)
  } catch (err: any) {
    console.log(`
❌ Connection failed!

   Error: ${err.message}

   Make sure:
   1. wallet-infra is running: docker-compose up
   2. You have a .env file: npx tsx makeEnv > .env
`)
    return
  }

  while (true) {
    showMenu()
    const choice = await prompt('Select a menu option (0-16)')

    switch (choice) {
      case '0':
        console.log(`\n👋 Exiting demo. Thanks for trying the toolbox!\n`)
        return
      case '1':
        await walletInfo()
        break
      case '2':
        await waitForAuthentication()
        break
      case '3':
        await getPublicKey()
        break
      case '4':
        await signData()
        break
      case '5':
        await verifySignature()
        break
      case '6':
        await createHmac()
        break
      case '7':
        await verifyHmac()
        break
      case '8':
        await encryptDecrypt()
        break
      case '9':
        await createAction()
        break
      case '10':
        await listActions()
        break
      case '11':
        await abortAction()
        break
      case '12':
        await listOutputs()
        break
      case '13':
        await acquireCertificate()
        break
      case '14':
        await listCertificates()
        break
      case '15':
        await getHeight()
        break
      case '16':
        await getHeaderForHeight()
        break
      default:
        console.log(
          `\n❌ Invalid choice. Please type a number between 0 and 16.`
        )
    }

    await waitForEnter()
  }
}

runArgv2Function(module.exports)
