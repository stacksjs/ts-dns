import type { DnsAnswer, DnsQuery, DnsResponse, EDNSMode, ProtocolTweaks } from './types'
import { Buffer } from 'node:buffer'
import { RecordType } from './types'
import { debugLog } from './utils'

// Wire format constants
const DNS_HEADER_SIZE = 12
const MAX_LABEL_LENGTH = 63
// const MAX_NAME_LENGTH = 255

/**
 * DNS header flags
 */
export class DnsFlags {
  response = false
  opcode = 0
  authoritative = false
  truncated = false
  recursionDesired = false
  recursionAvailable = false
  authenticData = false
  checkingDisabled = false
  responseCode = 0

  static fromBuffer(buffer: Buffer): DnsFlags {
    const flags = new DnsFlags()
    const rawFlags = buffer.readUInt16BE(0)

    // First byte contains QR, OPCODE, AA, TC, RD
    flags.response = (rawFlags & 0x8000) !== 0 // QR bit (bit 15)
    flags.opcode = (rawFlags & 0x7800) >>> 11 // OPCODE (bits 11-14)
    flags.authoritative = (rawFlags & 0x0400) !== 0 // AA bit (bit 10)
    flags.truncated = (rawFlags & 0x0200) !== 0 // TC bit (bit 9)
    flags.recursionDesired = (rawFlags & 0x0100) !== 0 // RD bit (bit 8)

    // Second byte contains RA, Z, AD, CD, RCODE
    flags.recursionAvailable = (rawFlags & 0x0080) !== 0 // RA bit (bit 7)
    flags.authenticData = (rawFlags & 0x0020) !== 0 // AD bit (bit 5)
    flags.checkingDisabled = (rawFlags & 0x0010) !== 0 // CD bit (bit 4)
    flags.responseCode = rawFlags & 0x000F // RCODE (bits 0-3)

    return flags
  }

  toBuffer(): Buffer {
    const buffer = Buffer.alloc(2)
    let flags = 0

    if (this.response)
      flags |= 0x8000
    flags |= (this.opcode & 0x0F) << 11
    if (this.authoritative)
      flags |= 0x0400
    if (this.truncated)
      flags |= 0x0200
    if (this.recursionDesired)
      flags |= 0x0100
    if (this.recursionAvailable)
      flags |= 0x0080
    if (this.authenticData)
      flags |= 0x0020
    if (this.checkingDisabled)
      flags |= 0x0010
    flags |= this.responseCode & 0x000F

    buffer.writeUInt16BE(flags, 0)
    return buffer
  }
}

/**
 * DNS wire format encoder
 */
export class DnsEncoder {
  private buffer: Buffer
  private offset: number
  private nameOffsets: Map<string, number>
  private verbose?: boolean

  constructor(size = 512, verbose?: boolean) {
    this.buffer = Buffer.alloc(size)
    this.offset = 0
    this.nameOffsets = new Map()
    this.verbose = verbose
  }

  writeHeader(id: number, flags: DnsFlags, counts: {
    qdcount: number
    ancount: number
    nscount: number
    arcount: number
  }): void {
    debugLog('encoder', `Writing DNS header: ${JSON.stringify({
      id,
      flags: {
        response: flags.response,
        opcode: flags.opcode,
        recursionDesired: flags.recursionDesired,
      },
      counts,
    })}`, this.verbose)

    this.writeUint16(id)
    const flagsBuffer = flags.toBuffer()
    this.buffer.set(flagsBuffer, this.offset)
    this.offset += 2
    this.writeUint16(counts.qdcount)
    this.writeUint16(counts.ancount)
    this.writeUint16(counts.nscount)
    this.writeUint16(counts.arcount)
  }

  writeName(name: string): void {
    debugLog('encoder', `Writing DNS name: ${name}`, this.verbose)
    const labels = name.split('.')

    for (const label of labels) {
      if (label.length > MAX_LABEL_LENGTH) {
        throw new Error(`Label too long: ${label}`)
      }

      // Write label length and data
      this.buffer[this.offset++] = label.length
      this.buffer.write(label, this.offset)
      this.offset += label.length
    }

    // Terminal zero
    this.buffer[this.offset++] = 0
  }

  // Write question section
  writeQuestion(query: DnsQuery): void {
    this.writeName(query.name)
    this.writeUint16(query.type)
    this.writeUint16(query.class)
  }

  private writeUint16(value: number): void {
    this.buffer.writeUInt16BE(value, this.offset)
    this.offset += 2
  }

  private writeUint32(value: number): void {
    this.buffer.writeUInt32BE(value, this.offset)
    this.offset += 4
  }

  // Get final buffer
  getBuffer(): Buffer {
    return this.buffer.slice(0, this.offset)
  }
}

/**
 * DNS wire format decoder
 */
export class DnsDecoder {
  private buffer: Buffer
  private offset: number

  constructor(buffer: Buffer) {
    this.buffer = buffer
    this.offset = 0
  }

  // Helper to check if we can safely read bytes
  private canRead(bytes: number): boolean {
    return this.offset + bytes <= this.buffer.length
  }

  readName(): string {
    const labels: string[] = []
    let jumping = false
    let jumpOffset = this.offset

    for (let jumps = 0; jumps < 5; jumps++) { // Limit compression jumps
      if (jumpOffset >= this.buffer.length) {
        throw new Error('Out of bounds access')
      }

      const len = this.buffer[jumpOffset]
      if (len === 0) {
        if (!jumping) {
          this.offset = jumpOffset + 1
        }
        break
      }

      if ((len & 0xC0) === 0xC0) { // Compression pointer
        if (!this.canRead(2)) {
          throw new Error('Out of bounds access')
        }

        if (!jumping) {
          this.offset = jumpOffset + 2
          jumping = true
        }

        jumpOffset = ((len & 0x3F) << 8) | this.buffer[jumpOffset + 1]
        continue
      }

      // Regular label
      jumpOffset++
      if (jumpOffset + len > this.buffer.length) {
        throw new Error('Out of bounds access')
      }

      const label = this.buffer.slice(jumpOffset, jumpOffset + len).toString('ascii')
      labels.push(label)
      jumpOffset += len
    }

    return labels.join('.')
  }

  readHeader(): { id: number, flags: DnsFlags, counts: { qdcount: number, ancount: number, nscount: number, arcount: number } } {
    if (!this.canRead(DNS_HEADER_SIZE)) {
      throw new Error(`Invalid DNS header size: ${this.buffer.length} bytes`)
    }

    const id = this.readUint16()
    const flags = DnsFlags.fromBuffer(this.buffer.slice(this.offset, this.offset + 2))
    this.offset += 2

    const counts = {
      qdcount: this.readUint16(),
      ancount: this.readUint16(),
      nscount: this.readUint16(),
      arcount: this.readUint16(),
    }

    return { id, flags, counts }
  }

  readQuestion(): DnsQuery {
    const name = this.readName()

    if (!this.canRead(4)) {
      throw new Error('Out of bounds access')
    }

    const type = this.readUint16()
    const qclass = this.readUint16()

    return { name, type, class: qclass }
  }

  readAnswer(): DnsAnswer {
    const name = this.readName()

    if (!this.canRead(10)) {
      throw new Error('Out of bounds access')
    }

    const type = this.readUint16()
    const qclass = this.readUint16()
    const ttl = this.readUint32()
    const rdlength = this.readUint16()

    if (!this.canRead(rdlength)) {
      throw new Error('Out of bounds access')
    }

    const data = this.readRData(type, rdlength)

    return {
      name,
      type,
      class: qclass,
      ttl,
      data,
    }
  }

  private readRData(type: number, length: number): any {
    const startOffset = this.offset
    let data: any

    switch (type) {
      case RecordType.A:
        if (length !== 4)
          throw new Error('Invalid IPv4 length')
        data = this.readIPv4()
        break
      case RecordType.AAAA:
        if (length !== 16)
          throw new Error('Invalid IPv6 length')
        data = this.readIPv6()
        break
      case RecordType.MX:
        if (length < 3)
          throw new Error('Invalid MX record length')
        data = {
          preference: this.readUint16(),
          exchange: this.readName(),
        }
        break
      case RecordType.TXT:
        data = this.readTxt(length)
        break
      case RecordType.CNAME:
      case RecordType.NS:
      case RecordType.PTR:
        data = this.readName()
        break
      default:
        data = this.buffer.slice(this.offset, this.offset + length).toString('hex')
        this.offset += length
    }

    // Ensure we've read exactly rdlength bytes
    const bytesRead = this.offset - startOffset
    if (bytesRead !== length) {
      this.offset = startOffset + length
    }

    return data
  }

  private readUint16(): number {
    if (!this.canRead(2)) {
      throw new Error('Out of bounds access')
    }

    const value = this.buffer.readUInt16BE(this.offset)
    this.offset += 2

    return value
  }

  private readUint32(): number {
    if (!this.canRead(4)) {
      throw new Error('Out of bounds access')
    }

    const value = this.buffer.readUInt32BE(this.offset)
    this.offset += 4

    return value
  }

  private readIPv4(): string {
    if (!this.canRead(4)) {
      throw new Error('Out of bounds access')
    }

    const parts = []
    for (let i = 0; i < 4; i++) {
      parts.push(this.buffer[this.offset++])
    }

    return parts.join('.')
  }

  private readIPv6(): string {
    if (!this.canRead(16)) {
      throw new Error('Out of bounds access')
    }

    const parts = []
    for (let i = 0; i < 8; i++) {
      parts.push(this.buffer.readUInt16BE(this.offset).toString(16))
      this.offset += 2
    }

    return parts.join(':')
  }

  private readTxt(length: number): string {
    if (length === 0) {
      throw new Error('TXT record has no character strings')
    }

    const end = this.offset + length
    const strings: Buffer[] = []
    while (this.offset < end) {
      const size = this.buffer.readUInt8(this.offset++)
      if (size > end - this.offset) {
        throw new Error('Invalid TXT character-string length')
      }
      strings.push(this.buffer.subarray(this.offset, this.offset + size))
      this.offset += size
    }
    return Buffer.concat(strings).toString()
  }
}

/**
 * Build a DNS query packet
 */
export function buildQuery(query: DnsQuery, options: {
  id?: number
  txid?: number
  edns?: EDNSMode
  tweaks?: ProtocolTweaks
  verbose?: boolean
} = {}): Buffer {
  const encoder = new DnsEncoder(512, options.verbose)

  // Create flags with correct settings
  const flags = new DnsFlags()
  flags.recursionDesired = true // We want recursive queries
  flags.response = false // This is a query, not a response

  // Use provided ID or generate random
  const id = options.txid ?? options.id ?? Math.floor(Math.random() * 65536)

  // Write header with proper counts
  encoder.writeHeader(id, flags, {
    qdcount: 1, // One question
    ancount: 0, // No answers in query
    nscount: 0, // No authority records
    arcount: 0, // No additional records
  })

  // Write question with correct type conversion
  encoder.writeQuestion({
    name: query.name,
    type: typeof query.type === 'string' ? RecordType[query.type as keyof typeof RecordType] : query.type,
    class: query.class,
  })

  return encoder.getBuffer()
}

/**
 * Parse a DNS response packet
 */
export function parseResponse(buffer: Buffer): DnsResponse {
  const decoder = new DnsDecoder(buffer)

  // Check if this is a response (QR bit should be 1)
  const rawFlags = buffer.readUInt16BE(2)
  if ((rawFlags & 0x8000) === 0) {
    throw new Error('Not a DNS response')
  }

  const { id, flags, counts } = decoder.readHeader()

  // Skip questions
  for (let i = 0; i < counts.qdcount; i++) {
    decoder.readQuestion()
  }

  // Read answers
  const answers: DnsAnswer[] = []
  for (let i = 0; i < counts.ancount; i++) {
    answers.push(decoder.readAnswer())
  }

  // Read authority records
  const authorities: DnsAnswer[] = []
  for (let i = 0; i < counts.nscount; i++) {
    authorities.push(decoder.readAnswer())
  }

  // Read additional records
  const additionals: DnsAnswer[] = []
  for (let i = 0; i < counts.arcount; i++) {
    additionals.push(decoder.readAnswer())
  }

  return {
    id,
    flags,
    answers,
    authorities,
    additionals,
  }
}
