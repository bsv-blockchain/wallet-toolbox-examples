# Examples: BSV Wallet Toolbox API Documentation

The examples documentation is split into various pages, common bits are described here, more complex examples have their own pages:

- [makeEnv](#function-makeenv) — Create a '.env' file with secrets to support experimentation.
- [balances](#function-balances) — Sum available change outputs to display wallet balances.
- [listChange](./listChange.md) — List all spendable change outputs.
- [backup](#function-backup) — Add and use a backup storage provider.
- [p2pkh](./p2pkh.md) — Create and consume P2PKH outputs.
- [brc29Funding](./brc29Funding.md) — Consume an externally generated BRC29 funding outputs.
- [brc29](./brc29.md) — Create and consume BRC29 outputs to transfer satoshis between wallets.
- [pushdrop](./pushdrop.md) — Mint and redeem PushDrop tokens.

## Getting Started

### Installation

To install the toolbox, run:

```bash
git clone https://github.com/bitcoin-sv/wallet-toolbox-examples

cd wallet-toolbox-examples

npm install

cd src

npx tsx makeEnv > .env

cat .env
```

[Return To Top](./README.md)

<!--#region ts2md-api-merged-here-->
### API

Links: [API](#api), [Functions](#functions)

#### Functions

| |
| --- |
| [backup](#function-backup) |
| [backupToSQLite](#function-backuptosqlite) |
| [backupWalletClient](#function-backupwalletclient) |
| [balances](#function-balances) |
| [makeEnv](#function-makeenv) |

Links: [API](#api), [Functions](#functions)

---

##### Function: backup

```ts
export async function backup(): Promise<void> {
    const env = Setup.getEnv("test");
    await backupWalletClient(env, env.identityKey);
}
```

See also: [backupWalletClient](./README.md#function-backupwalletclient)

Links: [API](#api), [Functions](#functions)

---
##### Function: backupToSQLite

```ts
export async function backupToSQLite(setup: SetupWallet, filePath?: string, databaseName?: string): Promise<void> {
    const env = Setup.getEnv(setup.chain);
    filePath ||= `backup_${setup.identityKey}.sqlite`;
    databaseName ||= `${setup.identityKey} backup`;
    const backup = await Setup.createStorageKnex({
        env,
        knex: Setup.createSQLiteKnex(filePath),
        databaseName,
        rootKeyHex: setup.keyDeriver.rootKey.toHex()
    });
    await setup.storage.addWalletStorageProvider(backup);
    await setup.storage.updateBackups();
}
```

See also: [backup](./README.md#function-backup)

Links: [API](#api), [Functions](#functions)

---
##### Function: backupWalletClient

```ts
export async function backupWalletClient(env: SetupEnv, identityKey: string): Promise<void> {
    const setup = await Setup.createWalletClient({
        env,
        rootKeyHex: env.devKeys[identityKey]
    });
    await backupToSQLite(setup);
    await setup.wallet.destroy();
}
```

See also: [backupToSQLite](./README.md#function-backuptosqlite)

Links: [API](#api), [Functions](#functions)

---
##### Function: balances

The `balance` function demonstrates creating a `ServerClient` based wallet and
calculating the wallet's "balance" as the sum of spendable outputs in the 'default' basket.

The 'default' basket holds the outputs that are used to automatically fund new actions,
and receives new outputs generated to recapture excess funding.

Run this function using the following command:

```bash
npx tsx balances.ts
```

```ts
export async function balances(): Promise<void> {
    const env = Setup.getEnv("test");
    for (const identityKey of [env.identityKey, env.identityKey2]) {
        const setup = await Setup.createWalletClient({
            env,
            rootKeyHex: env.devKeys[identityKey]
        });
        const change = await setup.wallet.listOutputs({
            basket: "default",
            limit: 1000
        });
        const balance = change.outputs.reduce((b, o) => (b += o.satoshis), 0);
        console.log(`balance for ${identityKey} = ${balance}`);
    }
}
```

Links: [API](#api), [Functions](#functions)

---
##### Function: makeEnv

Running the `makeEnv` function generates several new private keys
and related `.env` file initializers which simplify use of the `Setup`
functions.

After running the function, copy or capture the output into a file named `.env`
in the `src` folder of this repository.

Note that you can replace or add to the auto-generated keys.

The following command will run the function,
capture the output into a file named '.env',
and display the file's contents:

```bash
npx tsx makeEnv.ts > .env; cat .env
```

```ts
export function makeEnv() {
    Setup.makeEnv();
}
```

Links: [API](#api), [Functions](#functions)

---

<!--#endregion ts2md-api-merged-here-->