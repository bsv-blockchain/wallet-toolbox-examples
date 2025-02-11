import { Setup } from '@bsv/wallet-toolbox'

/**
 * @publicbody
 */
export async function backup(): Promise<void> {
  const env = Setup.getEnv('test')

  const setup = await Setup.createWalletClient({ env })

  const { activeStorage: backup } = await Setup.createWalletSQLite({
    env,
    filePath: 'myBackup.sqlite',
    databaseName: 'myBackup'
  })

  await setup.storage.addWalletStorageProvider(backup)

  await setup.storage.updateBackups()

  await backup.destroy()
}

/**
 * @publicbody
 */
export async function backup2(): Promise<void> {
  const env = Setup.getEnv('test')

  const setup = await Setup.createWalletClient({
    env,
    rootKeyHex: env.devKeys[env.identityKey2]
  })

  const { activeStorage: backup } = await Setup.createWalletSQLite({
    env,
    filePath: 'myBackup2.sqlite',
    databaseName: 'myBackup2'
  })

  await setup.storage.addWalletStorageProvider(backup)

  await setup.storage.updateBackups()

  await backup.destroy()
}

backup().catch(console.error)
