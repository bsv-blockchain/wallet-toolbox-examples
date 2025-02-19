# BRC29 Funding Example: BSV Wallet Toolbox API Documentation

The documentation is split into various pages, this page covers getting funded via the BRC29 script template example
of the `@bsv/wallet-toolbox-examples` package; which accompanies the `@bsv/wallet-toolbox`.

[BRC-29](https://github.com/bitcoin-sv/BRCs/blob/master/payments/0029.md) 
Historically, the P2PKH script template was the primary transfer pattern used for over a decade.

[Return To Top](./README.md)

<!--#region ts2md-api-merged-here-->
### API

Links: [API](#api), [Interfaces](#interfaces), [Functions](#functions)

#### Interfaces

#### Functions

##### Function: receiveBRC29Funding

Example receiving funding satoshis from an external BRC-100 wallet to your wallet to another using the BRC29 script template.

Edit the funding information into this example, then run the code.

This example can be run by the following command:

```bash
npx tsx brc29Funding.ts
```

Combine this with the [balances](./README.md#function-balances) example to observe satoshis being transfered between
two wallets.

```ts
export async function receiveBRC29Funding() {
    const env = Setup.getEnv("test");
    const setup = await Setup.createWalletClient({ env });
    const funding = {
        beef: Beef.fromString(""),
        outpoint: "",
        fromIdentityKey: "",
        satoshis: 0,
        derivationPrefix: "",
        derivationSuffix: ""
    };
    await inputBRC29(setup, funding);
}
```

See also: [inputBRC29](./brc29.md#function-inputbrc29)

Links: [API](#api), [Interfaces](#interfaces), [Functions](#functions)

---

<!--#endregion ts2md-api-merged-here-->