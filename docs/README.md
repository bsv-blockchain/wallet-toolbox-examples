# Examples: BSV Wallet Toolbox API Documentation

The examples documentation is split into various pages, common bits are described here, more complex examples have their own pages:

- [makeEnv](#function-makeenv) — Create a '.env' file with secrets to support experimentation.
- [balances](#function-balances) — Sum available change outputs to display wallet balances.
- [backup](#function-backup) — Add and use a backup storage provider.
- [P2PKH Script Template](./p2pkh.md) — Create and consume P2PKH outputs.
- [BRC29 Script Template](./brc29.md) — Create and consume BRC29 outputs.
- [PushDrop Script Template](./pushdrop.md) — Create and consume PushDrop outputs.

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
| [backup2](#function-backup2) |
| [balances](#function-balances) |
| [makeEnv](#function-makeenv) |

Links: [API](#api), [Functions](#functions)

---

##### Function: backup

```ts
export async function backup(): Promise<void> {
    const env = Setup.getEnv("test");
    const setup = await Setup.createWalletClient({ env });
    const { activeStorage: backup } = await Setup.createWalletSQLite({
        env,
        filePath: "myBackup.sqlite",
        databaseName: "myBackup"
    });
    await setup.storage.addWalletStorageProvider(backup);
    await setup.storage.updateBackups();
    await backup.destroy();
}
```

Links: [API](#api), [Functions](#functions)

---
##### Function: backup2

```ts
export async function backup2(): Promise<void> {
    const env = Setup.getEnv("test");
    const setup = await Setup.createWalletClient({
        env,
        rootKeyHex: env.devKeys[env.identityKey2]
    });
    const { activeStorage: backup } = await Setup.createWalletSQLite({
        env,
        filePath: "myBackup2.sqlite",
        databaseName: "myBackup2"
    });
    await setup.storage.addWalletStorageProvider(backup);
    await setup.storage.updateBackups();
    await backup.destroy();
}
```

See also: [backup](./README.md#function-backup)

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