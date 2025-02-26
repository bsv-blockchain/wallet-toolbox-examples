import { Setup } from '@bsv/wallet-toolbox'
import { runArgv2Function } from './runArgv2Function'

/**
 * The `balance` function demonstrates creating a `ServerClient` based wallet and
 * calculating the wallet's "balance" as the sum of spendable outputs in the 'default' basket.
 *
 * The 'default' basket holds the outputs that are used to automatically fund new actions,
 * and receives new outputs generated to recapture excess funding.
 *
 * Run this function using the following command:
 *
 * ```bash
 * npx tsx balances balances
 * ```
 *
 * @publicbody
 */
export async function balances(): Promise<void> {
  // Read the "secrets" from the .env file created by `makeEnv`
  const env = Setup.getEnv('test')

  // Compute the balance for both wallets: identityKey and identityKey2
  for (const identityKey of [env.identityKey, env.identityKey2]) {
    // Create a setup context (which includes a wallet).
    // This wallet will be a client of the default cloud storage provider.
    const setup = await Setup.createWalletClient({
      env,
      rootKeyHex: env.devKeys[identityKey]
    })

    // Retrieve all the spendable outputs tracked by the 'default' basket
    // which holds the automatically managed "change" for the wallet.
    const change = await setup.wallet.listOutputs({
      basket: 'default',
      limit: 1000
    })

    // Sum the "satoshis" held by each output to compute the available balance.
    const balance = change.outputs.reduce((b, o) => (b += o.satoshis), 0)

    console.log(`balance for ${identityKey} = ${balance}`)
  }
}

runArgv2Function(module.exports)
