import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { Buffer } from 'node:buffer'
import { buildQuery, DnsClient, DnsDecoder, DnsFlags, parseResponse } from '../src'
import { TransportType } from '../src/transport'
import { QClass, RecordType } from '../src/types'

// Mock DNS responses
const mockResponses = {
  A: Buffer.from('0d5e81800001000600000000076578616d706c6503636f6d0000010001c00c0001000100000124000417d70088c00c00010001000001240004600780c6c00c0001000100000124000417d7008ac00c0001000100000124000417c0e454c00c0001000100000124000417c0e450c00c00010001000001240004600780af', 'hex'),
  AAAA: Buffer.from('9c848180000100010000000006676f6f676c6503636f6d00001c0001c00c001c0001000000d700102a0014504001081c000000000000200e', 'hex'),
  MX: Buffer.from('c1ab81800001000100000000096d6963726f736f667403636f6d00000f0001c00c000f000100000df0002a000a0d6d6963726f736f66742d636f6d046d61696c0a70726f74656374696f6e076f75746c6f6f6bc016', 'hex'),
  TXT: Buffer.from('77aa838000010000000000000667697468756203636f6d0000100001', 'hex'),
}

// Mock the transport layer
mock.module('./src/transport', () => ({
  createTransport: () => ({
    query: async (_nameserver: string, _request: Buffer) => {
      // Return mock response based on record type
      const type = _request.readUInt16BE(_request.length - 4)
      switch (type) {
        case RecordType.A:
          return mockResponses.A
        case RecordType.AAAA:
          return mockResponses.AAAA
        case RecordType.MX:
          return mockResponses.MX
        case RecordType.TXT:
          return mockResponses.TXT
        default:
          throw new Error('Unsupported record type')
      }
    },
  }),
  TransportType,
}))

describe('DnsClient', () => {
  describe('Query Building', () => {
    it('should build valid DNS queries', () => {
      const query = buildQuery({
        name: 'example.com',
        type: RecordType.A,
        class: QClass.IN,
      })

      expect(query).toBeInstanceOf(Buffer)
      expect(query.length).toBeGreaterThan(12) // DNS header size
      expect(query.readUInt16BE(2) & 0x8000).toBe(0) // QR bit should be 0 for queries
    })

    it('should set recursion desired flag', () => {
      const query = buildQuery({
        name: 'example.com',
        type: RecordType.A,
        class: QClass.IN,
      })

      const flags = query.readUInt16BE(2)
      expect(flags & 0x0100).toBe(0x0100) // RD bit should be set
    })
  })

  describe('Response Parsing', () => {
    it('should parse A record responses', () => {
      const response = parseResponse(mockResponses.A)

      expect(response.answers).toHaveLength(6)
      expect(response.answers[0].type).toBe(RecordType.A)
      expect(typeof response.answers[0].data).toBe('string')
      expect(response.answers[0].data).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
    })

    it('should parse AAAA record responses', () => {
      const response = parseResponse(mockResponses.AAAA)

      expect(response.answers).toHaveLength(1)
      expect(response.answers[0].type).toBe(RecordType.AAAA)
      expect(typeof response.answers[0].data).toBe('string')
      expect(response.answers[0].data).toMatch(/^[0-9a-f:]+$/)
    })

    it('should parse MX record responses', () => {
      const response = parseResponse(mockResponses.MX)

      expect(response.answers).toHaveLength(1)
      expect(response.answers[0].type).toBe(RecordType.MX)
      expect(response.answers[0].data).toHaveProperty('preference')
      expect(response.answers[0].data).toHaveProperty('exchange')
    })

    it('should handle empty responses', () => {
      const response = parseResponse(mockResponses.TXT)

      expect(response.answers).toHaveLength(0)
    })
  })

  describe('DNS Flags', () => {
    it('should correctly parse response flags', () => {
      // Create a buffer with valid DNS flags
      const buffer = Buffer.alloc(2)
      buffer.writeUInt16BE(0x8180) // Standard response flags
      const flags = DnsFlags.fromBuffer(buffer)

      expect(flags.response).toBe(true)
      expect(flags.recursionDesired).toBe(true)
      expect(flags.recursionAvailable).toBe(true)
    })

    it('should correctly encode flags', () => {
      const flags = new DnsFlags()
      flags.response = true
      flags.recursionDesired = true

      const buffer = flags.toBuffer()
      expect(buffer.readUInt16BE(0) & 0x8000).toBe(0x8000) // QR bit
      expect(buffer.readUInt16BE(0) & 0x0100).toBe(0x0100) // RD bit
    })
  })

  describe('Integration Tests', () => {
    let client: DnsClient

    beforeAll(() => {
      client = new DnsClient({
        domains: ['example.com'],
        type: 'A',
        nameserver: '1.1.1.1',
      })
    })

    it('should resolve A records', async () => {
      const responses = await client.query()

      expect(responses).toHaveLength(1)
      expect(responses[0].answers.length).toBeGreaterThanOrEqual(1)
      expect(responses[0].answers[0].type).toBe(RecordType.A)
    })

    it('should handle multiple record types', async () => {
      client = new DnsClient({
        domains: ['example.com'],
        type: ['A', 'AAAA'],
        nameserver: '1.1.1.1',
      })

      const responses = await client.query()
      expect(responses).toHaveLength(2)
    })

    it('should handle multiple domains', async () => {
      client = new DnsClient({
        domains: ['example.com', 'google.com'],
        type: 'A',
        nameserver: '1.1.1.1',
      })

      const responses = await client.query()
      expect(responses).toHaveLength(2)
    })

    it('should work with different transport types', async () => {
      for (const transport of [TransportType.UDP, TransportType.TCP, TransportType.TLS, TransportType.HTTPS]) {
        client = new DnsClient({
          domains: ['example.com'],
          type: 'A',
          nameserver: '1.1.1.1',
          transport: { type: transport },
        })

        const responses = await client.query()
        expect(responses).toHaveLength(1)
      }
    })
  })

  describe('Error Handling', () => {
    it('should handle malformed responses', () => {
      expect(() => parseResponse(Buffer.from('invalid'))).toThrow()
    })

    it('should validate domain names', () => {
      expect(() => new DnsClient({
        domains: ['invalid..com'],
        type: 'A',
      })).toThrow()
    })

    it('should handle invalid record types', () => {
      expect(() => new DnsClient({
        domains: ['example.com'],
        type: 'INVALID' as any,
      })).toThrow()
    })

    it('should handle network errors', async () => {
      // Mock the transport to always fail
      const originalModule = await import('../src/transport')
      const mockTransport = {
        ...originalModule,
        createTransport: () => ({
          query: () => Promise.reject(new Error('Network error')),
        }),
      }

      mock.module('../src/transport', () => mockTransport)

      const client = new DnsClient({
        domains: ['example.com'],
        type: 'A',
      })

      expect(client.query()).rejects.toThrow('DNS query failed: Network error')
    })

    // Restore original transport after test
    afterAll(() => {
      mock.restore()
    })
  })

  describe('DNS Decoder', () => {
    it('should handle name compression', () => {
      const decoder = new DnsDecoder(mockResponses.MX)
      decoder.readHeader() // Skip header

      const name = decoder.readName()
      expect(name).toBe('microsoft.com')
    })

    it('should validate message boundaries', () => {
      const decoder = new DnsDecoder(Buffer.from([]))
      expect(() => decoder.readHeader()).toThrow()
    })
  })
})
