### API

Links: [API](#api), [Functions](#functions)

#### Functions

| |
| --- |
| [balances](#function-balances) |
| [inputP2PKH](#function-inputp2pkh) |
| [outputP2PKH](#function-outputp2pkh) |
| [transferP2PKH](#function-transferp2pkh) |

Links: [API](#api), [Functions](#functions)

---

##### Function: balances

The `balance` function demonstrates creating a `ServerClient` based wallet and
calculating the wallet's "balance" as the sum of spendable outputs in the 'default' basket.

The 'default' basket holds the outputs that are used to automatically fund new actions,
and receives new outputs generated to recapture excess funding.

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
##### Function: inputP2PKH

Consume a P2PKH output.

```ts
export async function inputP2PKH(setup: SetupWallet, outputP2PKH: {
    beef: Beef;
    outpoint: string;
    toIdentityKey: string;
    satoshis: number;
}) {
    const o = outputP2PKH;
    const env = Setup.getEnv(setup.chain);
    const privateKey: PrivateKey = PrivateKey.fromString(env.devKeys[o.toIdentityKey]);
    const unlock = Setup.getUnlockP2PKH(privateKey, o.satoshis);
    const label = "inputP2PKH";
    const car = await setup.wallet.createAction({
        inputBEEF: o.beef.toBinary(),
        inputs: [
            {
                outpoint: o.outpoint,
                unlockingScriptLength: 108,
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
input's outpoint ${o.outpoint}
satoshis ${o.satoshis}
BEEF
${beef.toHex()}
${beef.toLogString()}
`);
    }
}
```

See also: [outputP2PKH](./examples.md#function-outputp2pkh)

Returns

beef - object proving the validity of the new output where the last transaction contains the new output.

outpoint - The txid and index of the outpoint in the format `${txid}.${index}`.

toIdentityKey - The public key able to unlock the output. The .env "devKeys" must contain a matching private key.

satoshis - The amount assigned to the output.

Argument Details

+ **setup**
  + The setup context which will consume a P2PKH output as an input to a new transaction transfering
the output's satoshis to the "change" managed by the context's wallet.
+ **outputP2PKH**
  + An object returned by the outputP2PKH function with the following properties:

Links: [API](#api), [Functions](#functions)

---
##### Function: outputP2PKH

Create a new P2PKH output.

```ts
export async function outputP2PKH(setup: SetupWallet, toIdentityKey: string, satoshis: number): Promise<{
    beef: Beef;
    outpoint: string;
    toIdentityKey: string;
    satoshis: number;
}> {
    const address = PublicKey.fromString(toIdentityKey).toAddress();
    const lock = Setup.getLockP2PKH(address);
    const label = "outputP2PKH";
    const car = await setup.wallet.createAction({
        outputs: [
            {
                lockingScript: lock.toHex(),
                satoshis,
                outputDescription: label,
                tags: ["relinquish"]
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
outputP2PKH to ${toIdentityKey}
outpoint ${outpoint}
satoshis ${satoshis}
BEEF
${beef.toHex()}
${beef.toLogString()}
`);
    return { beef, outpoint, toIdentityKey, satoshis };
}
```

Returns

An object is returned with the following properties:

beef - object proving the validity of the new output where the last transaction contains the new output.

outpoint - The txid and index of the outpoint in the format `${txid}.${index}`.

toIdentityKey - The public key able to unlock the output.

satoshis - The amount assigned to the output.

Argument Details

+ **setup**
  + The setup context which will create the new transaction containing the new P2PKH output.
+ **toIdentityKey**
  + The public key which will be able to unlock the output.
Note that the output uses the "address" associated with this public key: The HASH160 of the public key.
+ **satoshis**
  + How many satoshis to transfer to this new output.

Links: [API](#api), [Functions](#functions)

---
##### Function: transferP2PKH

Example of moving satoshis from one wallet to another using the P2PKH template
to send directly to the "address" associated with a private key.

Historically, this was the primary transfer pattern for over a decade.
In particular, the sender would construct a new transaction with the payment output
and broadcast it to the network. The recipient then used network services to find
transactions that made a payment to "their" address.

There are muliple drawbacks to this legacy method of exchange:

  1. The receiver is insentivized to re-use addresses to simplify lookup, destroying privacy.
  2. The address must be transmitted without corruption from the receiver to the sender before starting the transfer.
  3. The receiver must poll the network to discover the payment transaction.
  4. The receiver typically couldn't use the new output as an input until some number of "confirmations",
     block mined on top of the original transaction mining event.

A BRC-100 wallet replaces polling for transactions by payment address with SPV based BEEF packaging for all transactions and new outputs.
This means payments are transmitted directly to recipients as a new transaction built on inputs which can be directly validated
by the recipient against a local copy of mined block headers;
even if the chain of new transactions supporting the latest payment is arbitrarily long.

SPV based BEEF packaging resolves drawbacks 3 and 4 and is used in this example.
The "brc29" example extends this example to demonstrate how to resolve drawbacks 1 and 2.

```ts
export async function transferP2PKH() {
    const env = Setup.getEnv("test");
    const setup1 = await Setup.createWalletClient({ env });
    const setup2 = await Setup.createWalletClient({
        env,
        rootKeyHex: env.devKeys[env.identityKey2]
    });
    const o = await outputP2PKH(setup1, setup2.identityKey, 42);
    await inputP2PKH(setup2, o);
}
```

See also: [inputP2PKH](./examples.md#function-inputp2pkh), [outputP2PKH](./examples.md#function-outputp2pkh)

Links: [API](#api), [Functions](#functions)

---
