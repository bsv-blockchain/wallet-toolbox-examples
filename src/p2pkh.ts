import { Beef, PrivateKey, PublicKey, SignActionArgs } from '@bsv/sdk'
import { Setup, SetupWallet } from '@bsv/wallet-toolbox'

/**
 * Example of moving satoshis from one wallet to another using the P2PKH template
 * to send directly to the "address" associated with a private key.
 *
 * Historically, this was the primary transfer pattern for over a decade.
 * In particular, the sender would construct a new transaction with the payment output
 * and broadcast it to the network. The recipient then used network services to find
 * transactions that made a payment to "their" address.
 *
 * There are muliple drawbacks to this legacy method of exchange:
 *
 *   1. The receiver is insentivized to re-use addresses to simplify lookup, destroying privacy.
 *   2. The address must be transmitted without corruption from the receiver to the sender before starting the transfer.
 *   3. The receiver must poll the network to discover the payment transaction.
 *   4. The receiver typically couldn't use the new output as an input until some number of "confirmations",
 *      block mined on top of the original transaction mining event.
 *
 * A BRC-100 wallet replaces polling for transactions by payment address with SPV based BEEF packaging for all transactions and new outputs.
 * This means payments are transmitted directly to recipients as a new transaction built on inputs which can be directly validated
 * by the recipient against a local copy of mined block headers;
 * even if the chain of new transactions supporting the latest payment is arbitrarily long.
 *
 * SPV based BEEF packaging resolves drawbacks 3 and 4 and is used in this example.
 * The "brc29" example extends this example to demonstrate how to resolve drawbacks 1 and 2.
 *
 * @publicbody
 */
export async function transferP2PKH() {
  // obtain the secrets environment for the testnet network.
  const env = Setup.getEnv('test')
  // setup1 will be the sending wallet using the rootKey associated with identityKey, which is the default.
  const setup1 = await Setup.createWalletClient({ env })
  // setup2 will be the receiving wallet using the rootKey associated with identityKey2
  const setup2 = await Setup.createWalletClient({
    env,
    rootKeyHex: env.devKeys[env.identityKey2]
  })

  // create a new transaction with an output for setup2 in the amount of 42 satoshis.
  const o = await outputP2PKH(setup1, setup2.identityKey, 42)

  // use setup2 to consume the new output to demonstrate unlocking the output and adding it to the wallet's "change" outputs.
  await inputP2PKH(setup2, o)
}

/**
 * Create a new P2PKH output.
 *
 * @param {SetupWallet} setup The setup context which will create the new transaction containing the new P2PKH output.
 * @param {string} toIdentityKey The public key which will be able to unlock the output.
 * Note that the output uses the "address" associated with this public key: The HASH160 of the public key.
 * @param {number} satoshis How many satoshis to transfer to this new output.
 * @returns {Object} An object is returned with the following properties:
 * @returns {Beef} beef - object proving the validity of the new output where the last transaction contains the new output.
 * @returns {string} outpoint - The txid and index of the outpoint in the format `${txid}.${index}`.
 * @returns {string} toIdentityKey - The public key able to unlock the output.
 * @returns {number} satoshis - The amount assigned to the output.
 *
 * @publicbody
 */
export async function outputP2PKH(
  setup: SetupWallet,
  toIdentityKey: string,
  satoshis: number
): Promise<{
  beef: Beef
  outpoint: string
  toIdentityKey: string
  satoshis: number
}> {
  // Convert the destination identity key into its associated address and use that to generate a locking script.
  const address = PublicKey.fromString(toIdentityKey).toAddress()
  const lock = Setup.getLockP2PKH(address)

  // Use this label the new transaction can be found by `listActions` and as a "description" value.
  const label = 'outputP2PKH'

  // This call to `createAction` will create a new funded transaction containing the new output,
  // as well as sign and broadcast the transaction to the network.
  const car = await setup.wallet.createAction({
    outputs: [
      // Explicitly specify the new output to be created.
      // When outputs are explictly added to an action they must be funded:
      // Typically, at least one "change" input will automatically be added to fund the transaction,
      // and at least one output will be added to recapture excess funding.
      {
        lockingScript: lock.toHex(),
        satoshis,
        outputDescription: label,
        tags: ['relinquish']
      }
    ],
    options: {
      // Turn off automatic output order randomization to avoid having to figure out which output is the explicit one.
      // It will always be output zero.
      randomizeOutputs: false,
      // This example prefers to immediately wait for the new transaction to be broadcast to the network.
      // Typically, most production applications benefit from performance gains when broadcasts are handled in the background.
      acceptDelayedBroadcast: false
    },
    labels: [label],
    description: label
  })

  // Both the "tx" and "txid" results are expected to be valid when an action is created that does not need explicit input signing,
  // and when the "signAndProcess" option is allowed to default to true.

  // The `Beef` class is used here to decode the AtomicBEEF binary format of the new transaction.
  const beef = Beef.fromBinary(car.tx!)
  // The outpoint string is constructed from the new transaction's txid and the output index: zero.
  const outpoint = `${car.txid!}.0`

  console.log(`
outputP2PKH to ${toIdentityKey}
outpoint ${outpoint}
satoshis ${satoshis}
BEEF
${beef.toHex()}
${beef.toLogString()}
`)

  // Return the bits and pieces of the new output created.
  return { beef, outpoint, toIdentityKey, satoshis }
}

/**
 * Consume a P2PKH output.
 *
 * @param {SetupWallet} setup The setup context which will consume a P2PKH output as an input to a new transaction transfering
 * the output's satoshis to the "change" managed by the context's wallet.
 * @param {Object} outputP2PKH - An object returned by the outputP2PKH function with the following properties:
 * @returns {Beef} beef - object proving the validity of the new output where the last transaction contains the new output.
 * @returns {string} outpoint - The txid and index of the outpoint in the format `${txid}.${index}`.
 * @returns {string} toIdentityKey - The public key able to unlock the output. The .env "devKeys" must contain a matching private key.
 * @returns {number} satoshis - The amount assigned to the output.
 *
 * @publicbody
 */
export async function inputP2PKH(
  setup: SetupWallet,
  outputP2PKH: {
    beef: Beef
    outpoint: string
    toIdentityKey: string
    satoshis: number
  }
) {
  const o = outputP2PKH
  const env = Setup.getEnv(setup.chain)

  // Lookup the private key corresponding to the "toIdentityKey" associated with the new output.
  // This is a public key value whose associated address was used to lock the output.
  const privateKey: PrivateKey = PrivateKey.fromString(
    env.devKeys[o.toIdentityKey]
  )
  // Construct an "unlock" object which is then associated with the input to be signed
  // such that when the "sign" method is called, a signed "unlockingScript" is computed for that input.
  const unlock = Setup.getUnlockP2PKH(privateKey, o.satoshis)

  const label = 'inputP2PKH'

  /**
   * Creating an action with an input that requires it's own signing template is a two step process.
   * The call to createAction must include only the expected maximum script length of the unlockingScript.
   * This causes a "signableTransaction" to be returned instead of a completed "txid" and "tx".
   */
  const car = await setup.wallet.createAction({
    /**
     * An inputBEEF is always required when there are explicit inputs to the new action.
     * This beef must include each transaction with a corresponding outpoint txid.
     * Unlike an AtomicBEEF, inputBEEF validates the transactions containing the outpoints,
     * and may contain multiple unrelated transaction subtrees.
     */
    inputBEEF: o.beef.toBinary(),
    inputs: [
      {
        outpoint: o.outpoint,
        // The value of 108 is a constant for the P2PKH template.
        // You could use the `unlock.estimateLength` method to obtain it.
        // Or a quick look at the P2PKH source code to confirm it.
        unlockingScriptLength: 108,
        inputDescription: label
      }
    ],
    labels: [label],
    description: label
  })

  /**
   * Here is the essense of using `signAction` and custom script template:
   *
   * The `tx` property of the `signableTransaction` result can be parsed using
   * the standard `Beef` class, but it is not an ordinary valid AtomicBEEF for the
   * simple reason that the transaction has not been fully signed.
   *
   * You can either use the method shown here to obtain a signable `Transaction` object
   * from this beef or you can use the `Transaction.fromAtomicBEEF` mehtod.
   *
   * To sign an input, set the corresponding input's `unlockingScriptTemplate` to an appropriately
   * initialized unlock object and call the `Transaction` `sign` method.
   *
   * Once signed, capture the now valid `unlockingScript` valoue for the input and convert it to a hex string.
   */
  const st = car.signableTransaction!
  const beef = Beef.fromBinary(st.tx)
  const tx = beef.findAtomicTransaction(beef.txs.slice(-1)[0].txid)!
  tx.inputs[0].unlockingScriptTemplate = unlock
  await tx.sign()
  const unlockingScript = tx.inputs[0].unlockingScript!.toHex()

  /**
   * Note that the `signArgs` use the `reference` property of the `signableTransaction` result to
   * identify the `createAction` result to finish processing and optionally broadcasting.
   */
  const signArgs: SignActionArgs = {
    reference: st.reference,
    spends: { 0: { unlockingScript } },
    options: {
      // Force an immediate broadcast of the signed transaction.
      acceptDelayedBroadcast: false
    }
  }

  /**
   * Calling `signAction` completes the action creation process when inputs must be signed
   * using specific script templates.
   */
  const sar = await setup.wallet.signAction(signArgs)

  // This completes the example by logging evidence of what was created.
  {
    const beef = Beef.fromBinary(sar.tx!)
    const txid = sar.txid!

    console.log(`
inputP2PKH to ${setup.identityKey}
input's outpoint ${o.outpoint}
satoshis ${o.satoshis}
BEEF
${beef.toHex()}
${beef.toLogString()}
`)
  }
}

transferP2PKH().catch(console.error)
