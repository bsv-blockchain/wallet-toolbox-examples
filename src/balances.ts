import { Setup } from '@bsv/wallet-toolbox'

/**
 * The `balance` function demonstrates creating a `ServerClient` based wallet and
 * calculating the wallet's "balance" as the sum of spendable outputs in the 'default' basket.
 *
 * The 'default' basket holds the outputs that are used to automatically fund new actions,
 * and receives new outputs generated to recapture excess funding.
 *
 * @publicbody
 */
export async function balances(): Promise<void> {
  const env = Setup.getEnv('test')
  for (const identityKey of [env.identityKey, env.identityKey2]) {
    const setup = await Setup.createWalletClient({
      env,
      rootKeyHex: env.devKeys[identityKey]
    })

    const change = await setup.wallet.listOutputs({
      basket: 'default',
      limit: 1000
    })
    const balance = change.outputs.reduce((b, o) => (b += o.satoshis), 0)

    console.log(`balance for ${identityKey} = ${balance}`)
  }
}

balances().catch(console.error)
