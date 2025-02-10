import { Setup } from '@bsv/wallet-toolbox'

async function inputP2PKH() {

    const env = Setup.getEnv('test')
    const setup = await Setup.createWalletClient({ env })

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

inputP2PKH().catch(console.error)