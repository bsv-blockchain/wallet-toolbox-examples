const { PrivateKey } = require('@bsv/sdk');
const { Setup } = require('@bsv/wallet-toolbox');

async function debugSignature() {
  const env = Setup.getEnv('test');
  const rootKeyHex = env.devKeys[env.identityKey];
  
  console.log('Client Root Key:', rootKeyHex);
  console.log('Client Identity Key:', env.identityKey);
  
  // Create wallet
  const setup = await Setup.createWallet({
    env,
    rootKeyHex
  });
  
  // Test data
  const testData = Buffer.from('hello world');
  const protocolID = [2, 'auth message signature'];
  const keyID = 'nonce1 nonce2';
  
  console.log('\n--- Test 1: With counterparty="self" ---');
  const sigResult1 = await setup.wallet.createSignature({
    data: Array.from(testData),
    protocolID,
    keyID,
    counterparty: 'self'
  });
  
  console.log('Signature:', Buffer.from(sigResult1.signature).toString('hex'));
  
  const verifyResult1 = await setup.wallet.verifySignature({
    data: Array.from(testData),
    protocolID,
    keyID,
    counterparty: 'self',
    signature: sigResult1.signature
  });
  
  console.log('Verification result:', verifyResult1.valid);
  
  console.log('\n--- Test 2: With counterparty="anyone" ---');
  const sigResult2 = await setup.wallet.createSignature({
    data: Array.from(testData),
    protocolID,
    keyID,
    counterparty: 'anyone'
  });
  
  console.log('Signature:', Buffer.from(sigResult2.signature).toString('hex'));
  
  const verifyResult2 = await setup.wallet.verifySignature({
    data: Array.from(testData),
    protocolID,
    keyID,
    counterparty: 'anyone',
    signature: sigResult2.signature
  });
  
  console.log('Verification result:', verifyResult2.valid);
  
  process.exit(0);
}

debugSignature().catch(console.error);


