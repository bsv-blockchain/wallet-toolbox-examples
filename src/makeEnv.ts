import { Setup } from '@bsv/wallet-toolbox'

/**
 * Running the `makeEnv` function generates several new private keys
 * and related `.env` file initializers which simplify use of the `Setup`
 * functions.
 * 
 * After running the function, copy or capture the output into a file named `.env`
 * in the `src` folder of this repository.
 */
Setup.makeEnv()
