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
  const counterparty = '0320295654f4c8d4d2bc2ed79b0169f7584e62519b17f6a829adebe400316c90d6'; // Server public key
  
  console.log('\n--- Creating Signature ---');
  console.log('Data:', testData.toString('hex'));
  console.log('ProtocolID:', protocolID);
  console.log('KeyID:', keyID);
  console.log('Counterparty:', counterparty);
  
  const sigResult = await setup.wallet.createSignature({
    data: Array.from(testData),
    protocolID,
    keyID,
    counterparty
  });
  
  console.log('Signature:', Buffer.from(sigResult.signature).toString('hex'));
  
  // Now verify
  console.log('\n--- Verifying Signature ---');
  const verifyResult = await setup.wallet.verifySignature({
    data: Array.from(testData),
    protocolID,
    keyID,
    counterparty,
    signature: sigResult.signature
  });
  
  console.log('Verification result:', verifyResult.valid);
  
  process.exit(0);
}

debugSignature().catch(console.error);


