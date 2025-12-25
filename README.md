# BSV WALLET TOOLBOX EXAMPLES

BSV BLOCKCHAIN | BRC100 Conforming Wallet Example Code

The BSV Wallet Toolbox builds on the [SDK](https://bsv-blockchain.github.io/ts-sdk) to add support for:

    - Persistent UTXO and transaction history management
    - Standardized key derivation protocols.

## Table of Contents

- [Objective](#objective)
- [Examples](#examples)
- [Documentation](#documentation)
- [Testing](#testing)
- [Contribution Guidelines](#contribution-guidelines)
- [Support \& Contacts](#support--contacts)
- [License](#license)

## Objective

The BSV Wallet Toolbox Examples provides a collection of self-contained sample code to support learning and getting started with the @bsv/wallet-toolbox.

## Documentation

[The Docs](https://bsv-blockchain.github.io/wallet-toolbox) are available here on Github pages.  
[Example code](https://docs.bsvblockchain.org/guides/sdks/ts/examples) is available over on our gitbook.  

The Toolbox is richly documented with code-level annotations. This should show up well within editors like VSCode.


## Testing

### Running Tests

To run the test suite:
```bash
npm test
```

For development with watch mode:
```bash
npm run test:watch
```

### Live Testing with Real Funds

The Python storage server tests (`brc100.py.test.ts`) support live testing with real testnet funds. This allows you to verify that transactions are properly broadcasted and confirmed on the testnet blockchain.

#### Setup for Live Testing

1. **Generate a Testnet Key**
   ```bash
   npm run keygen
   ```
   This will output a new private key and testnet address. The private key should be added to your `.env` file.

2. **Fund the Address**
   Copy the testnet address and fund it using one of these faucets:
   - [MoneyButton Testnet Faucet](https://testnetfaucet.moneybutton.com/)
   - [Whatsonchain Testnet Faucet](https://faucet.whatsonchain.com/)
   - [Mempool Testnet Faucet](https://testnet-faucet.mempool.space/)

   You'll need at least 10 satoshis to run the transaction tests.

3. **Configure Environment**
   Add the generated private key to your `.env` file:
   ```bash
   LIVE_PRIVATE_KEY=your_generated_private_key_here
   ```

4. **Fund the Address**
   Send testnet funds to the generated address using one of the faucets listed above.

5. **Start the Python Storage Server**
   Make sure the Python storage server is running:
   ```bash
   cd ../py-wallet-toolbox/examples/storage_server_example
   python manage.py runserver
   ```

6. **Run Live Tests**
   The tests will automatically detect your funded address and attempt to internalize the funding transaction:
   ```bash
   npm run test:py:live
   ```

   **Note**: Transaction internalization requires Atomic BEEF format. If automatic internalization fails, you can manually run:
   ```bash
   npm run internalize-funding
   ```
   ```bash
   npm run test:py:live
   ```

#### What Live Testing Does

- Uses your funded testnet key instead of development keys
- Broadcasts real transactions to the testnet blockchain
- Verifies transaction confirmations and balance updates
- Provides links to view transactions on blockchain explorers

**⚠️ WARNING**: Live testing uses real testnet funds. While testnet coins have no monetary value, they still cost gas fees and should be used responsibly.

#### Test Scripts

- `npm run keygen` - Generate a new testnet key and address
- `npm run internalize-funding` - Manually internalize funding transaction into wallet (if auto-internalization fails)
- `npm run test:py` - Run Python storage server tests in test mode (no broadcasting)
- `npm run test:py:live` - Run Python storage server tests in live mode with automatic funding detection


## Examples


## Contribution Guidelines

We're always looking for contributors to help us improve the SDK. Whether it's bug reports, feature requests, or pull requests - all contributions are welcome.

1. **Fork & Clone**: Fork this repository and clone it to your local machine.
2. **Set Up**: Run `npm install` to install all dependencies.
3. **Make Changes**: Create a new branch and make your changes.
4. **Test**: Ensure all tests pass by running `npm test`.
5. **Commit**: Commit your changes and push to your fork.
6. **Pull Request**: Open a pull request from your fork to this repository.
For more details, check the [contribution guidelines](./CONTRIBUTING.md).

## Support & Contacts

Project Owners: Thomas Giacomo and Darren Kellenschwiler

Development Team Lead: Ty Everett

For questions, bug reports, or feature requests, please open an issue on GitHub or contact us directly.

## License

The license for the code in this repository is the Open BSV License. Refer to [LICENSE.txt](./LICENSE.txt) for the license text.

Thank you for being a part of the BSV Blockchain Libraries Project. Let's build the future of BSV Blockchain together!
