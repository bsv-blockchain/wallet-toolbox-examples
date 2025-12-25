import { PrivateKey } from '@bsv/sdk'
import { runArgv2Function } from './runArgv2Function'

/**
 * Generate a new BSV testnet private key and address for live testing.
 *
 * This utility generates a new private key and displays:
 * - The private key (for .env file)
 * - The testnet address (for funding)
 * - Links to testnet faucets
 *
 * After generating, fund the address using a testnet faucet, then run the live tests.
 *
 * Usage:
 * ```bash
 * npx tsx generateKey
 * ```
 *
 * This will output:
 * - Private key for .env
 * - Testnet address for funding
 * - Faucet links
 *
 * @publicbody
 */
export async function generateKey() {
  console.log('🔑 Generating new BSV testnet key for live testing...\n')

  // Generate a new private key
  const privateKey = PrivateKey.fromRandom()
  const publicKey = privateKey.toPublicKey()

  // Get testnet address
  const testnetAddress = publicKey.toAddress('testnet')

  // Get private key as hex
  const privateKeyHex = privateKey.toString()

  console.log('='.repeat(80))
  console.log('🔑 NEW TESTNET KEY GENERATED')
  console.log('='.repeat(80))
  console.log()
  console.log('📝 Add this to your .env file:')
  console.log(`LIVE_PRIVATE_KEY=${privateKeyHex}`)
  console.log()
  console.log('💰 Fund this testnet address:')
  console.log(`${testnetAddress}`)
  console.log()
  console.log('🔗 Testnet Faucets:')
  console.log(
    '  • MoneyButton Testnet Faucet: https://testnetfaucet.moneybutton.com/'
  )
  console.log(
    '  • Whatsonchain Testnet Faucet: https://faucet.whatsonchain.com/'
  )
  console.log(
    '  • Mempool Testnet Faucet: https://testnet-faucet.mempool.space/'
  )
  console.log()
  console.log('⚠️  WARNING: This private key is for TESTNET only!')
  console.log('   Never use testnet keys or funds on mainnet!')
  console.log()
  console.log('🚀 After funding, run live tests with:')
  console.log('   npm run test:py:live')
  console.log()
  console.log('='.repeat(80))
}

runArgv2Function(module.exports)
