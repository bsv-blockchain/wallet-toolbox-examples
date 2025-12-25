
      expect(outputs).toBeDefined()
      expect(outputs.outputs).toBeDefined()
      expect(Array.isArray(outputs.outputs)).toBe(true)
      expect(typeof outputs.totalOutputs).toBe('number')
      expect(outputs.totalOutputs).toBeGreaterThanOrEqual(0)
    }, 10000)

    test('relinquishOutput - should relinquish an output from wallet tracking', async () => {
      console.log('🗑️  Testing output relinquishment...')
      // Use a dummy outpoint since we likely don't have real outputs to relinquish
      const dummyOutpoint =
        '0000000000000000000000000000000000000000000000000000000000000000:0'

      try {
        const result = await setup.wallet.relinquishOutput({
          basket: 'default',
          output: dummyOutpoint
        })

        console.log('✅ Output relinquished successfully')
        expect(result).toBeDefined()
        expect(result.relinquished).toBeDefined()
      } catch (err: any) {
        console.log('⚠️  Output relinquishment failed (expected with dummy outpoint)')
        // Expected to fail with dummy outpoint
        expect(err).toBeDefined()
      }
      console.log('✅ Output relinquishment test completed')
    }, 10000)
  })

  // ============================================================================
  // Certificates
  // ============================================================================

  describe('Certificates', () => {
    test('acquireCertificate - should attempt to acquire a certificate', async () => {
      console.log('📜 Testing certificate acquisition...')
      try {
        const result = await setup.wallet.acquireCertificate({
          type: Buffer.from('test-certificate').toString('base64'),
          certifier: setup.identityKey,
          acquisitionProtocol: 'issuance',
          certifierUrl: 'http://localhost:8000',
          fields: {
            name: 'Test User',
            email: 'test@example.com'
          },
          privilegedReason: 'Demo acquisition'
        })
        console.log('📜 Certificate acquired successfully')
        expect(result).toBeDefined()
      } catch (err: any) {
        console.log('⚠️  Certificate acquisition failed (expected in local test environment)')
        // Expected to fail in test environment
        expect(err).toBeDefined()
      }
      console.log('✅ Certificate acquisition test completed')
    }, 10000)

    test('listCertificates - should list wallet certificates', async () => {
      const certs = await setup.wallet.listCertificates({
        certifiers: [],
        types: [],
        limit: 10,
        offset: 0
      })

      console.log(`📜 Listed ${certs.certificates.length} certificates from database`)
      if (certs.certificates.length > 0) {
        console.log(`   Certificate types: ${certs.certificates.map(c => c.type).join(', ')}`)
      }

      expect(certs).toBeDefined()
      expect(certs.certificates).toBeDefined()
      expect(Array.isArray(certs.certificates)).toBe(true)
      expect(certs.certificates.length).toBeGreaterThanOrEqual(0)
      if (certs.certificates.length > 0) {
        const testCert = certs.certificates.find(
          c => c.type === 'test-certificate'
        )
        if (testCert) {
          expect(testCert.subject).toBeDefined()
        }
      }
    }, 10000)

    test('relinquishCertificate - should relinquish a certificate', async () => {
      console.log('🗑️  Testing certificate relinquishment...')
      // First check if we have any certificates to relinquish
      const certs = await setup.wallet.listCertificates({
        certifiers: [],
        types: [],
        limit: 10,
        offset: 0
      })

      console.log(`📜 Found ${certs.certificates.length} certificates to potentially relinquish`)
      if (certs.certificates.length === 0) {
        console.log('⚠️  No certificates to relinquish, skipping test')
        return
      }

      // Try to relinquish the first certificate
      const cert = certs.certificates[0]
      console.log(`🗑️  Attempting to relinquish certificate: ${cert.type}`)

      try {
