import { Beef, SignActionArgs, PushDrop, WalletProtocol, Byte } from '@bsv/sdk'
import { Setup, SetupWallet, wait } from '@bsv/wallet-toolbox'

async function mintTokens(
  setup: SetupWallet,
  count: number
): Promise<{ txids: string[]; noSendChange: string[] }> {
  const r: { txids: string[]; noSendChange: string[] } = {
    txids: [],
    noSendChange: []
  }

  for (let i = 0; i < count; i++) {}

  return r
}

async function nosend() {
  const env = Setup.getEnv('test')
  const setup = await Setup.createWalletClient({ env })

  const mr = await mintTokens(setup, 2)
}

nosend().catch(console.error)
