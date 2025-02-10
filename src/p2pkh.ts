import { Beef, PrivateKey } from '@bsv/sdk'
import { Setup, SetupWallet } from '@bsv/wallet-toolbox'

/**
 * Creates a new P2PKH output.
 */
async function outputP2PKH(setup: SetupWallet, toIdentityKey: string, satoshis: number)
: Promise<{ beef: Beef, outpoint: string, toIdentityKey: string, satoshis: number }>
{
    const env = Setup.getEnv(setup.chain)

    const { address } = Setup.getKeyPair(env.devKeys[toIdentityKey])
    const lock = Setup.getLockP2PKH(address)

    const label = 'outputP2PKH'

    const car = await setup.wallet.createAction({
        outputs: [
            {
                lockingScript: lock.toHex(),
                satoshis,
                outputDescription: label,
                tags: ['relinquish']
            }
        ],
        options: {
            randomizeOutputs: false,
            acceptDelayedBroadcast: false
        },
        labels: [label],
        description: label
    })

    const beef = Beef.fromBinary(car.tx!)
    const outpoint = `${car.txid!}.0`

    console.log(`
outputP2PKH to ${toIdentityKey}
outpoint ${outpoint}
satoshis ${satoshis}
BEEF
${beef.toHex}
${beef.toLogString()}
`)

    return { beef, outpoint, toIdentityKey, satoshis }
}

async function inputP2PKH(setup: SetupWallet, outputP2PKH: { beef: Beef, outpoint: string, toIdentityKey: string, satoshis: number }) {

    const env = Setup.getEnv(setup.chain)

    const o = outputP2PKH

    const privateKey = PrivateKey.fromString(env.devKeys[o.toIdentityKey])
 //   const lock = Setup.getUnlockP2PKH(privateKey, o.satoshis)
    const label = 'inputP2PKH'

    const car = await setup.wallet.createAction({
        description: 'inputP2PKH',
        inputs: [
            {
                outpoint: '',
                inputDescription: ''
            }
        ]
    })

}


//outputP2PKH().catch(console.error)