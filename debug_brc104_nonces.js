const { Setup } = require('@bsv/wallet-toolbox');
const { Peer, SimplifiedFetchTransport } = require('@bsv/sdk');

async function debugNonces() {
  const env = Setup.getEnv('test');
  const rootKeyHex = env.devKeys[env.identityKey];
  
  const setup = await Setup.createWallet({
    env,
    rootKeyHex
  });
  
  console.log('Client Identity:', env.identityKey);
  
  // Create transport and peer
  const transport = new SimplifiedFetchTransport('http://localhost:8000');
  const peer = new Peer(setup.wallet, transport);
  
  // Intercept the send method to log what's being sent
  const originalSend = transport.send.bind(transport);
  transport.send = async function(message) {
    if (message.messageType === 'general') {
      console.log('\n[CLIENT] Sending general message:');
      console.log('  nonce (request):', message.nonce);
      console.log('  yourNonce (server nonce from handshake):', message.yourNonce);
      console.log('  Expected keyID:', `${message.nonce} ${message.yourNonce}`);
    }
    return originalSend(message);
  };
  
  try {
    // This will trigger the handshake
    const testPayload = Buffer.from(JSON.stringify({ method: 'test' }));
    await peer.toPeer(Array.from(testPayload));
    console.log('\n✅ Message sent successfully!');
  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
  
  process.exit(0);
}

debugNonces().catch(console.error);

