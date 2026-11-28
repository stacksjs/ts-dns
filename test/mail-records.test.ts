import { expect, test } from 'bun:test'
import { Buffer } from 'node:buffer'
import { buildQuery, DnsClient, parseResponse } from '../src'
import { QClass, RecordType } from '../src/types'

function txtResponse(data: Buffer): Buffer {
  const query = buildQuery({ name: 'example.test', type: RecordType.TXT, class: QClass.IN })
  query.writeUInt16BE(0x8180, 2)
  query.writeUInt16BE(1, 6)
  const answer = Buffer.from('c00c001000010000003c0000', 'hex')
  answer.writeUInt16BE(data.length, 10)
  return Buffer.concat([query, answer, data])
}

function segment(value: Buffer | string): Buffer {
  const data = Buffer.from(value)
  return Buffer.concat([Buffer.from([data.length]), data])
}

test('accepts DNS owner labels used by DMARC and DKIM', () => {
  expect(() => new DnsClient({ domains: ['_dmarc.example.test', 'mail._domainkey.example.test'], type: 'TXT' })).not.toThrow()
  expect(() => new DnsClient({ domains: ['not valid.example.test'], type: 'TXT' })).toThrow()
})

test('decodes a single DNS TXT character string without its length byte', () => {
  const data = 'v=spf1 mx -all'
  expect(parseResponse(txtResponse(segment(data))).answers[0]?.data).toBe(data)
  expect(parseResponse(txtResponse(segment(''))).answers[0]?.data).toBe('')
})

test('joins DNS TXT character strings before decoding their UTF-8 bytes', () => {
  const subject = Buffer.from('é')
  const data = Buffer.concat([segment('v=DKIM1; '), segment(subject.subarray(0, 1)), segment(subject.subarray(1))])
  expect(parseResponse(txtResponse(data)).answers[0]?.data).toBe('v=DKIM1; é')
})

test('rejects a DNS TXT segment that extends beyond its record', () => {
  expect(() => parseResponse(txtResponse(Buffer.from([5, 97, 98])))).toThrow('Invalid TXT character-string length')
})
