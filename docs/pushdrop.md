# PushDrop Example: BSV Wallet Toolbox API Documentation

The documentation is split into various pages, this page covers the PushDrop script template example
of the `@bsv/wallet-toolbox-examples` package; which accompanies the `@bsv/wallet-toolbox`.

[Return To Top](./README.md)

<!--#region ts2md-api-merged-here-->
### API

Links: [API](#api), [Functions](#functions)

#### Functions

| |
| --- |
| [inputPushDrop](#function-inputpushdrop) |
| [outputPushDrop](#function-outputpushdrop) |
| [transferPushDrop](#function-transferpushdrop) |

Links: [API](#api), [Functions](#functions)

---

##### Function: inputPushDrop

Consume a PushDrop output.

To spend a PushDrop output a transaction input must be created and signed using the
associated private key.

In this example, an initial `createAction` call constructs the overall shape of a
new transaction, returning a `signableTransaction`.

The `tx` property of the `signableTransaction` should be parsed using
the standard `Beef` class. Note that it is not an ordinary AtomicBEEF for the
simple reason that the transaction has not yet been fully signed.

You can either use the method shown here to obtain a signable `Transaction` object
from this beef or you can use the `Transaction.fromAtomicBEEF` method.

To sign an input, set the corresponding input's `unlockingScriptTemplate` to an appropriately
initialized unlock object and call the `Transaction` `sign` method.

Once signed, capture the input's now valid `unlockingScript` value and convert it to a hex string.

```ts
export async function inputPushDrop(setup: SetupWallet, outputPushDrop: {
    beef: Beef;
    outpoint: string;
    fromIdentityKey: string;
    satoshis: number;
    protocol: WalletProtocol;
    keyId: string;
}) {
    const { protocol, keyId, fromIdentityKey, satoshis, beef: inputBeef, outpoint } = outputPushDrop;
    const { keyDeriver } = setup;
    const t = new PushDrop(setup.wallet);
    const unlock = t.unlock(protocol, keyId, fromIdentityKey, "single", false, satoshis);
    const label = "inputPushDrop";
    const car = await setup.wallet.createAction({
        inputBEEF: inputBeef.toBinary(),
        inputs: [
            {
                outpoint,
                unlockingScriptLength: 73,
                inputDescription: label
            }
        ],
        labels: [label],
        description: label
    });
    const st = car.signableTransaction!;
    const beef = Beef.fromBinary(st.tx);
    const tx = beef.findAtomicTransaction(beef.txs.slice(-1)[0].txid)!;
    tx.inputs[0].unlockingScriptTemplate = unlock;
    await tx.sign();
    const unlockingScript = tx.inputs[0].unlockingScript!.toHex();
    const signArgs: SignActionArgs = {
        reference: st.reference,
        spends: { 0: { unlockingScript } },
        options: {
            acceptDelayedBroadcast: false
        }
    };
    const sar = await setup.wallet.signAction(signArgs);
    {
        const beef = Beef.fromBinary(sar.tx!);
        const txid = sar.txid!;
        console.log(`
inputP2PKH to ${setup.identityKey}
input's outpoint ${outpoint}
satoshis ${satoshis}
txid ${txid}
BEEF
${beef.toHex()}
${beef.toLogString()}
`);
    }
}
```

See also: [inputP2PKH](./p2pkh.md#function-inputp2pkh), [outputPushDrop](./pushdrop.md#function-outputpushdrop)

Argument Details

+ **setup**
  + The setup context which will consume a PushDrop output as an input to a new transaction transfering
the output's satoshis to the "change" managed by the context's wallet.
+ **outputPushDrop.beef**
  + An object proving the validity of the new output where the last transaction contains the new output.
+ **outputPushDrop.outpoint**
  + The txid and index of the outpoint in the format `${txid}.${index}`.
+ **outputPushDrop.fromIdentityKey**
  + The public key that locked the output.
+ **outputPushDrop.satoshis**
  + The amount assigned to the output.

Links: [API](#api), [Functions](#functions)

---
##### Function: outputPushDrop

Create a new PushDrop output.

Convert the destination identity key into its associated address and use that to generate a locking script.

Explicitly specify the new output to be created as part of a new action (transaction).

When outputs are explictly added to an action they must be funded:
Typically, at least one "change" input will be automatically added to fund the transaction,
and at least one output will be added to recapture excess funding.

```ts
export async function outputPushDrop(setup: SetupWallet, toIdentityKey: string, satoshis: number): Promise<{
    beef: Beef;
    outpoint: string;
    fromIdentityKey: string;
    satoshis: number;
    protocol: WalletProtocol;
    keyId: string;
}> {
    const t = new PushDrop(setup.wallet);
    const protocol: WalletProtocol = [2, "pushdropexample"];
    const keyId: string = "7";
    const lock = await t.lock([
        [1, 2, 3],
        [4, 5, 6]
    ], protocol, keyId, toIdentityKey, false, true, "before");
    const lockingScript = lock.toHex();
    const label = "outputPushDrop";
    const car = await setup.wallet.createAction({
        outputs: [
            {
                lockingScript,
                satoshis,
                outputDescription: label,
                tags: ["relinquish"],
                customInstructions: JSON.stringify({
                    protocol,
                    keyId,
                    counterparty: toIdentityKey,
                    type: "PushDrop"
                })
            }
        ],
        options: {
            randomizeOutputs: false,
            acceptDelayedBroadcast: false
        },
        labels: [label],
        description: label
    });
    const beef = Beef.fromBinary(car.tx!);
    const outpoint = `${car.txid!}.0`;
    console.log(`
outputPushDrop to ${toIdentityKey}
outpoint ${outpoint}
satoshis ${satoshis}
BEEF
${beef.toHex()}
${beef.toLogString()}
`);
    return {
        beef,
        outpoint,
        fromIdentityKey: setup.identityKey,
        satoshis,
        protocol,
        keyId
    };
}
```

Returns

An object is returned with the following properties:

beef - object proving the validity of the new output where the last transaction contains the new output.

outpoint - The txid and index of the outpoint in the format `${txid}.${index}`.

fromIdentityKey - The public key that locked the output.

satoshis - The amount assigned to the output.

derivationPrefix - The PushDrop prefix string.

derivationSuffix - The PushDrop suffix string.

Argument Details

+ **setup**
  + The setup context which will create the new transaction containing the new PushDrop output.
+ **toIdentityKey**
  + The public key which will be able to unlock the output.
Note that the output uses the "address" associated with this public key: The HASH160 of the public key.
+ **satoshis**
  + How many satoshis to transfer to this new output.

Links: [API](#api), [Functions](#functions)

---
##### Function: transferPushDrop

Example of moving satoshis from one wallet to another using the BRC29 script template.

This example can be run by the following command:

```bash
npx tsx brc29.ts
```

Combine this with the [balances](./README.md#function-balances) example to observe satoshis being transfered between
two wallets.

```ts
export async function transferPushDrop() {
    const env = Setup.getEnv("test");
    const setup1 = await Setup.createWalletClient({ env });
    const setup2 = await Setup.createWalletClient({
        env,
        rootKeyHex: env.devKeys[env.identityKey2]
    });
    const o = await outputPushDrop(setup1, setup2.identityKey, 42);
    await inputPushDrop(setup2, o);
}
```

See also: [inputPushDrop](./pushdrop.md#function-inputpushdrop), [outputPushDrop](./pushdrop.md#function-outputpushdrop)

Links: [API](#api), [Functions](#functions)

---

<!--#endregion ts2md-api-merged-here-->