import { Beef, PrivateKey, PublicKey, SignActionArgs } from '@bsv/sdk'
import {
  randomBytesBase64,
  ScriptTemplateBRC29,
  Setup,
  SetupWallet
} from '@bsv/wallet-toolbox'

/**
 * Example of moving satoshis from one wallet to another using the BRC29 script template.
 *
 * This example can be run by the following command:
 *
 * ```bash
 * npx tsx brc29.ts
 * ```
 *
 * Combine this with the [balances](./README.md#function-balances) example to observe satoshis being transfered between
 * two wallets.
 *
 * @publicbody
 */
export async function transferBRC29() {
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
  const o = await outputBRC29(setup1, setup2.identityKey, 42)

  // use setup2 to consume the new output to demonstrate unlocking the output and adding it to the wallet's "change" outputs.
  await inputBRC29(setup2, o)
}

/**
 * Create a new BRC29 output.
 *
 * Convert the destination identity key into its associated address and use that to generate a locking script.
 *
 * Explicitly specify the new output to be created as part of a new action (transaction).
 *
 * When outputs are explictly added to an action they must be funded:
 * Typically, at least one "change" input will be automatically added to fund the transaction,
 * and at least one output will be added to recapture excess funding.
 *
 * @param {SetupWallet} setup The setup context which will create the new transaction containing the new BRC29 output.
 * @param {string} toIdentityKey The public key which will be able to unlock the output.
 * Note that the output uses the "address" associated with this public key: The HASH160 of the public key.
 * @param {number} satoshis How many satoshis to transfer to this new output.
 * @returns {Object} An object is returned with the following properties:
 * @returns {Beef} beef - object proving the validity of the new output where the last transaction contains the new output.
 * @returns {string} outpoint - The txid and index of the outpoint in the format `${txid}.${index}`.
 * @returns {string} fromIdentityKey - The public key that locked the output.
 * @returns {number} satoshis - The amount assigned to the output.
 * @returns {string} derivationPrefix - The BRC29 prefix string.
 * @returns {string} derivationSuffix - The BRC29 suffix string.
 *
 * @publicbody
 */
export async function outputBRC29(
  setup: SetupWallet,
  toIdentityKey: string,
  satoshis: number
): Promise<{
  beef: Beef
  outpoint: string
  fromIdentityKey: string
  satoshis: number
  derivationPrefix: string
  derivationSuffix: string
}> {
  const derivationPrefix = randomBytesBase64(8)
  const derivationSuffix = randomBytesBase64(8)
  const { keyDeriver } = setup

  const t = new ScriptTemplateBRC29({
    derivationPrefix,
    derivationSuffix,
    keyDeriver
  })

  // Use this label the new transaction can be found by `listActions` and as a "description" value.
  const label = 'outputBRC29'

  // This call to `createAction` will create a new funded transaction containing the new output,
  // as well as sign and broadcast the transaction to the network.
  const car = await setup.wallet.createAction({
    outputs: [
      // Explicitly specify the new output to be created.
      // When outputs are explictly added to an action they must be funded:
      // Typically, at least one "change" input will automatically be added to fund the transaction,
      // and at least one output will be added to recapture excess funding.
      {
        lockingScript: t.lock(setup.rootKey.toString(), toIdentityKey).toHex(),
        satoshis,
        outputDescription: label,
        tags: ['relinquish'],
        customInstructions: JSON.stringify({
          derivationPrefix,
          derivationSuffix,
          type: 'BRC29'
        })
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
outputBRC29 to ${toIdentityKey}
outpoint ${outpoint}
satoshis ${satoshis}
BEEF
${beef.toHex()}
${beef.toLogString()}
`)

  // Return the bits and pieces of the new output created.
  return {
    beef,
    outpoint,
    fromIdentityKey: setup.identityKey,
    satoshis,
    derivationPrefix,
    derivationSuffix
  }
}

async function recover() {
  const env = Setup.getEnv('test')
  const setup2 = await Setup.createWalletClient({ env, rootKeyHex: env.devKeys[env.identityKey2] })
  await inputBRC29(setup2, {
    beef: Beef.fromString('0200beef02fe2257190001020000d528a81575845d517327bb6008084162faa1d7808a1c5fc8caaefee5528ca8500102267478fcd15a18ab54b0a225967af25d9b88a87fedbd10a902fab97949810f6dfe1457190002020202b484db892f137d09b52e39e6de3d8d5f1889910c1377f1382f23d0ab2859277d0301010000dfd8c32e8611b014421615f3a1f5c3a8ae003849b7a03a18cd6dcf9743cf6acb0401000100000001c2e7cdd48d1eda505aad919bcb22f5e2f34d5364e12d6958633b041209dcba81010000006b483045022100d605275c2a94df58abccb55e621bbca6c3b49ab7f72529c3722e7d39f1e90d6e02201a796d8ae398138cef88d0253579961ce362857ff1e906f8118cd8958c082f4d412102ce5244744264c00142827fbbb768b90cf02a92d3eec77834843c85b01615876bffffffff022a000000000000001976a9142037e5ee9d3dd5e35cc624d5f3de4533123132e188ac21020000000000001976a914a5b44ccddba277a74537a090581781dc182ce36488ac00000000010101000000033e11a4c9ac09a841d058939e48cbc0e12f6067c9273044b8b6d2914fbd341171000000006b483045022100d7842c4aba7f9e51b017a0573c45493bb42bc0add88c71019b70b386185887c4022034ee91c538e79266e3b3bb416d33e53461dcfb87eb84803cc838bc69cdf4dd3541210296261b41bb8bb4a88f9ff09a08c388ba1166bb9f6ec6c392ec5c6ab680581d74ffffffffc2e7cdd48d1eda505aad919bcb22f5e2f34d5364e12d6958633b041209dcba81000000006a473044022034b3ef17f6070bfced30ed2d033d5ddba3512912c1821883d7d92cce2f798506022066aea07c6e1e4429dd430a5d379c40ed8559f519e89ce30d1be566b1fe2abb9b412102b184e6620b66bbec9e1459b31c694d0d64b8cb6f88cd2d36061dda3759c5bf57ffffffff512bc260ce5d7890226d67daacb2e92d6917b873592e8670579f8c92b23c89fd000000006b4830450221009a4c5133b364fcba18eacf9a919d6110e3cc28491ce9a43760a2ea4254e87265022066fd5c26fd803894e8414928b70d7aad993d8a19603a6468e9a0a32004f563cd412103bf92dccc0c14bd54337dddc5a9eca59754dfede78721cb0ebe5f4551ac28b602ffffffff0166010000000000001976a9145a5f65105a758522dff47ca0b78be85c7ccd7a7588ac00000000000100000001267478fcd15a18ab54b0a225967af25d9b88a87fedbd10a902fab97949810f6d010000006b483045022100fdda2fce85570dcb4984e9617c8b1371d60c94101cb81706d65825f0e7fe7ab0022065ba34d22b60d99840b94fbf92321137da01f57e2fb6a04a94aed588a486a3c3412103b80196f0ce653201e4faeb90b2508dc7c81057d6c5777b7ce64aeac933080279ffffffff022a000000000000001976a91412bd7f92aff9bd738c644b5fce5e16cc585049b488acf6010000000000001976a914519914d1e955a7ec3835c5a95055e486cf6ae32088ac0000000000010000000219abff64fff782d133cc736ecae839fdeae9c49c19f321b33569c48c312cd1a2000000006b483045022100e506a6e836521c7548fe952acfb5be908ee54df696628ab29c6dfd2726d6fd0502203530601c17915929924cbf51706b00fc61d6f835344137330a158df6e8025370412103c341f45f6fd447f84d1c7dd625611ae18e0250793b9af3af5cf6679ca4345e38ffffffffb484db892f137d09b52e39e6de3d8d5f1889910c1377f1382f23d0ab2859277d000000006b483045022100923f65c63f50de5b8cae0bc914a72b43654de19d64967259ce35deeb90b3c70802207488c13e877fdd468049f31a6b88966a3990718d6ad8e8733979f808bb3ee201412102b8de49b75c9c57d3e96fb1a24f4c26898d03c6992369d29d127f04e9049f5a8bffffffff018f010000000000001976a9140704d1f8fca5a68088c58fccfa72277a06023d7c88ac00000000'),
    outpoint: 'a2d12c318cc46935b321f3199cc4e9eafd39e8ca6e73cc33d182f7ff64ffab19.0',
    fromIdentityKey: env.identityKey,
    satoshis: 42,
    derivationPrefix: "9oForaKSyXQ=",
    derivationSuffix: "ACltTLJEqx8="
  })
}

/**
 * Consume a BRC29 output.
 *
 * To spend a BRC29 output a transaction input must be created and signed using the
 * associated private key.
 *
 * In this example, an initial `createAction` call constructs the overall shape of a
 * new transaction, returning a `signableTransaction`.
 *
 * The `tx` property of the `signableTransaction` should be parsed using
 * the standard `Beef` class. Note that it is not an ordinary AtomicBEEF for the
 * simple reason that the transaction has not yet been fully signed.
 *
 * You can either use the method shown here to obtain a signable `Transaction` object
 * from this beef or you can use the `Transaction.fromAtomicBEEF` method.
 *
 * To sign an input, set the corresponding input's `unlockingScriptTemplate` to an appropriately
 * initialized unlock object and call the `Transaction` `sign` method.
 *
 * Once signed, capture the input's now valid `unlockingScript` value and convert it to a hex string.
 *
 * @param {SetupWallet} setup The setup context which will consume a BRC29 output as an input to a new transaction transfering
 * the output's satoshis to the "change" managed by the context's wallet.
 * @param {Beef} outputBRC29.beef - An object proving the validity of the new output where the last transaction contains the new output.
 * @param {string} outputBRC29.outpoint - The txid and index of the outpoint in the format `${txid}.${index}`.
 * @param {string} outputBRC29.fromIdentityKey - The public key that locked the output.
 * @param {number} outputBRC29.satoshis - The amount assigned to the output.
 *
 * @publicbody
 */
export async function inputBRC29(
  setup: SetupWallet,
  outputBRC29: {
    beef: Beef
    outpoint: string
    fromIdentityKey: string
    satoshis: number
    derivationPrefix: string
    derivationSuffix: string
  }
) {
  const {
    derivationPrefix,
    derivationSuffix,
    fromIdentityKey,
    satoshis,
    beef: inputBeef,
    outpoint
  } = outputBRC29
  const env = Setup.getEnv(setup.chain)

  const { keyDeriver } = setup

  const t = new ScriptTemplateBRC29({
    derivationPrefix,
    derivationSuffix,
    keyDeriver
  })

  // Construct an "unlock" object which is then associated with the input to be signed
  // such that when the "sign" method is called, a signed "unlockingScript" is computed for that input.
  const unlock = t.unlock(setup.rootKey.toString(), fromIdentityKey, satoshis)

  const label = 'inputBRC29'

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
    inputBEEF: inputBeef.toBinary(),
    inputs: [
      {
        outpoint,
        // The value of 108 is a constant for the BRC29 template.
        // You could use the `unlock.estimateLength` method to obtain it.
        // Or a quick look at the P2PKH source code to confirm it.
        unlockingScriptLength: t.unlockLength,
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
   * from this beef or you can use the `Transaction.fromAtomicBEEF` method.
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
input's outpoint ${outpoint}
satoshis ${satoshis}
BEEF
${beef.toHex()}
${beef.toLogString()}
`)
  }
}

//transferBRC29().catch(console.error)
recover().catch(console.error)
