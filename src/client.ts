import type { DnsOptions, DnsQuery, DnsResponse } from './types'
import { promises as fs } from 'node:fs'
import { platform } from 'node:os'
import { buildQuery, parseResponse } from './protocol'
import { createTransport, TransportType } from './transport'
import { QClass, RecordType } from './types'
import { debugLog } from './utils'

/**
 * A powerful DNS client that supports multiple transport protocols and advanced DNS features.
 *
 * Features:
 * - Multiple transport protocols (UDP, TCP, TLS, HTTPS)
 * - EDNS support
 * - Protocol tweaks
 * - Automatic nameserver resolution
 * - Retry mechanism with exponential backoff
 * - Comprehensive error handling
 *
 * @example
 * ```ts
 * const client = new DnsClient({
 *   domains: ['example.com'],
 *   type: 'A',
 *   nameserver: '1.1.1.1'
 * })
 *
 * const responses = await client.query()
 * ```
 */
export class DnsClient {
  private options: DnsOptions
  private static readonly DEFAULT_NAMESERVER = '1.1.1.1'
  private static readonly RESOLV_CONF_PATH = '/etc/resolv.conf'
  private static readonly WINDOWS_DNS_KEY = 'SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Nameserver'

  /**
   * Validates a domain name according to DNS standards.
   * Checks for:
   * - Consecutive dots
   * - Start/end dots
   * - Overall length (max 253 characters)
   * - Label length (max 63 characters)
   * - Valid characters (a-z, 0-9, -, _)
   *
   * @param domain - The domain name to validate
   * @throws {Error} If the domain name is invalid
   */
  private validateDomainName(domain: string): void {
    // Check for consecutive dots
    if (domain.includes('..')) {
      throw new Error(`Invalid domain name: ${domain} (consecutive dots)`)
    }

    // Check start/end dots
    if (domain.startsWith('.') || domain.endsWith('.')) {
      throw new Error(`Invalid domain name: ${domain} (starts or ends with dot)`)
    }

    // Check length
    if (domain.length > 253) {
      throw new Error(`Domain name too long: ${domain}`)
    }

    // Check label lengths
    const labels = domain.split('.')
    for (const label of labels) {
      if (label.length > 63) {
        throw new Error(`Label too long in domain: ${domain}`)
      }

      // Check label characters
      if (!/^[a-z0-9_-]+$/i.test(label)) {
        throw new Error(`Invalid characters in domain label: ${label}`)
      }
    }
  }

  /**
   * Validates a DNS record type.
   * Accepts either string representation (e.g., 'A', 'MX') or numeric values.
   *
   * @param type - The record type to validate (string or number)
   * @throws {Error} If the record type is invalid
   * @throws {TypeError} If the type is neither string nor number
   */
  private validateRecordType(type: string | number): void {
    if (typeof type === 'string') {
      // Check if the type exists in RecordType enum
      const upperType = type.toUpperCase()
      if (!(upperType in RecordType)) {
        throw new Error(`Invalid record type: ${type}`)
      }
    }
    else if (typeof type === 'number') {
      // Check if the number is a valid enum value
      const values = Object.values(RecordType).filter(v => typeof v === 'number')
      if (!values.includes(type)) {
        throw new Error(`Invalid record type number: ${type}`)
      }
    }
    else {
      throw new TypeError('Record type must be string or number')
    }
  }

  /**
   * Creates a new DNS client instance with the specified options.
   *
   * @param options - Configuration options for the DNS client
   * @throws {Error} If the options are invalid
   */
  constructor(options: DnsOptions) {
    this.options = {
      transport: {
        type: TransportType.UDP,
      },
      verbose: false,
      ...options,
    }

    // Validate options
    this.validateOptions()
  }

  /**
   * Executes DNS queries based on the client configuration.
   *
   * Features:
   * - Automatic transport selection (UDP/TCP)
   * - Nameserver resolution
   * - Retry mechanism with exponential backoff
   * - Truncation handling (fallback to TCP)
   * - Comprehensive error handling
   *
   * @returns Promise resolving to an array of DNS responses
   * @throws {Error} If the query fails after all retries
   */
  async query(): Promise<DnsResponse[]> {
    try {
      // Create transport based on options
      const transportType = this.determineTransportType()
      debugLog('client', `Selected transport type: ${transportType}`, this.options.verbose)

      const transport = createTransport(transportType)
      if (!transport) {
        throw new Error(`Failed to create transport for type: ${transportType}`)
      }

      const responses: DnsResponse[] = []

      // Get nameserver first to fail fast if there's an issue
      const nameserver = await this.resolveNameserver()
      debugLog('client', `Resolved nameserver: ${nameserver}`, this.options.verbose)

      if (!nameserver) {
        throw new Error('Failed to resolve nameserver')
      }

      // Build and execute queries
      const queries = this.buildQueries()
      debugLog('client', `Built ${queries.length} queries`, this.options.verbose)

      for (const query of queries) {
        debugLog('client', `Processing query: ${JSON.stringify({
          query,
          nameserver,
          transportType,
        })}`, this.options.verbose)

        const request = buildQuery(query, {
          txid: this.options.txid,
          edns: this.options.edns,
          tweaks: this.options.tweaks,
          verbose: this.options.verbose,
        })

        debugLog('client', `Built DNS request: ${JSON.stringify({
          hexData: request.toString('hex'),
          length: request.length,
          txid: request.readUInt16BE(0),
          flags: request.readUInt16BE(2).toString(16),
        })}`, this.options.verbose)

        // Handle retries
        const maxRetries = this.options.retries || 3

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            debugLog('client', `Attempt ${attempt + 1}/${maxRetries}`, this.options.verbose)
            const response = await transport.query(nameserver, request)

            debugLog('client', `Received DNS response: ${JSON.stringify({
              hexData: response.toString('hex'),
              length: response.length,
              txid: response.readUInt16BE(0),
              flags: response.readUInt16BE(2).toString(16),
            })}`, this.options.verbose)

            // Validate DNS message before parsing
            if (response.length < 12) { // Minimum DNS message size
              throw new Error(`Response too short: ${response.length} bytes`)
            }

            const responseFlags = response.readUInt16BE(2)
            if (!(responseFlags & 0x8000)) { // Check QR bit
              throw new Error('Response flag not set in DNS message')
            }

            const parsed = parseResponse(response)
            debugLog('client', `Parsed DNS response: ${JSON.stringify({
              id: parsed.id,
              answerCount: parsed.answers.length,
              authorityCount: parsed.authorities.length,
              additionalCount: parsed.additionals.length,
            })}`, this.options.verbose)

            // Check for truncation with UDP
            if (transportType === TransportType.UDP && parsed.flags.truncated) {
              debugLog('client', 'Response truncated, retrying with TCP', this.options.verbose)
              // Retry with TCP if truncated
              const tcpTransport = createTransport(TransportType.TCP)
              const tcpResponse = await tcpTransport.query(nameserver, request)
              responses.push(parseResponse(tcpResponse))
            }
            else {
              responses.push(parsed)
            }

            break // Success, exit retry loop
          }
          catch (err) {
            debugLog('client', `Attempt ${attempt + 1} failed: ${(err as Error).message}`, this.options.verbose)

            if (attempt === maxRetries - 1) {
              debugLog('client', 'All retry attempts failed', this.options.verbose)
              throw err
            }

            // Wait before retry with exponential backoff
            const backoffTime = 2 ** attempt * 1000
            debugLog('client', `Waiting ${backoffTime}ms before retry`, this.options.verbose)
            await new Promise(resolve => setTimeout(resolve, backoffTime))
          }
        }
      }

      if (responses.length === 0) {
        throw new Error('No responses received')
      }

      return responses
    }
    catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
      debugLog('client', `Query failed with error: ${errorMessage}`, this.options.verbose)
      debugLog('client', `Full error: ${JSON.stringify(err)}`, this.options.verbose)
      throw new Error(`DNS query failed: ${errorMessage}`)
    }
  }

  private buildQueries(): DnsQuery[] {
    const queries: DnsQuery[] = []

    // Add validation to ensure domains exists
    if (!this.options.domains?.length) {
      throw new Error('No domains specified')
    }

    const domains = Array.isArray(this.options.domains)
      ? this.options.domains
      : [this.options.domains]

    const types = this.resolveTypes()
    const classes = this.resolveClasses()

    // Build cartesian product of domains, types, and classes
    for (const domain of domains) {
      for (const type of types) {
        for (const qclass of classes) {
          queries.push({ name: domain, type, class: qclass })
        }
      }
    }

    debugLog('client', `Built queries: ${JSON.stringify(queries)}`, this.options.verbose)
    return queries
  }

  private resolveTypes(): RecordType[] {
    if (!this.options.type) {
      return [RecordType.A]
    }

    const types = Array.isArray(this.options.type)
      ? this.options.type
      : [this.options.type]

    return types.map((type) => {
      this.validateRecordType(type)
      if (typeof type === 'number') {
        return type
      }
      const upperType = type.toUpperCase()
      return RecordType[upperType as keyof typeof RecordType]
    })
  }

  private resolveClasses(): QClass[] {
    if (!this.options.class)
      return [QClass.IN]

    const classes = Array.isArray(this.options.class)
      ? this.options.class
      : [this.options.class]

    return classes.map((cls) => {
      if (typeof cls === 'number')
        return cls
      const upperClass = cls.toUpperCase()
      const qclass = QClass[upperClass as keyof typeof QClass]
      if (qclass === undefined) {
        throw new Error(`Invalid query class: ${cls}`)
      }
      return qclass
    })
  }

  private validateNameserver(nameserver: string): boolean {
    // Skip validation for HTTPS URLs
    if (nameserver.startsWith('https://')) {
      return true
    }

    // Check for link-local addresses
    if (nameserver.includes('%')) {
      return false
    }

    // Basic IPv4 validation
    const ipv4Regex = /^(?:\d{1,3}\.){3}\d{1,3}$/
    if (ipv4Regex.test(nameserver)) {
      const parts = nameserver.split('.')
      return parts.every((part) => {
        const num = Number.parseInt(part, 10)
        return num >= 0 && num <= 255
      })
    }

    // Basic IPv6 validation (simplified)
    if (nameserver.includes(':')) {
      return false // For now, prefer IPv4
    }

    return false
  }

  private async resolveNameserver(): Promise<string> {
    try {
      // Use explicitly configured nameserver
      if (this.options.nameserver) {
        debugLog('client', `Checking configured nameserver: ${this.options.nameserver}`, this.options.verbose)
        if (this.validateNameserver(this.options.nameserver)) {
          return this.options.nameserver
        }
      }

      // Platform-specific nameserver resolution
      const currentPlatform = platform()
      debugLog('client', `Resolving nameserver for platform: ${currentPlatform}`, this.options.verbose)

      let nameserver: string
      if (currentPlatform === 'win32') {
        nameserver = await this.resolveWindowsNameserver()
      }
      else {
        nameserver = await this.resolveUnixNameserver()
      }

      if (this.validateNameserver(nameserver)) {
        return nameserver
      }

      // Fallback to default if validation fails
      debugLog('client', `Using default nameserver: ${DnsClient.DEFAULT_NAMESERVER}`, this.options.verbose)
      return DnsClient.DEFAULT_NAMESERVER
    }
    catch (err) {
      debugLog('client', `Failed to resolve nameserver: ${(err as Error).message}`, this.options.verbose)
      // Fallback to default
      debugLog('client', `Using default nameserver: ${DnsClient.DEFAULT_NAMESERVER}`, this.options.verbose)
      return DnsClient.DEFAULT_NAMESERVER
    }
  }

  private async resolveUnixNameserver(): Promise<string> {
    try {
      const content = await fs.readFile(DnsClient.RESOLV_CONF_PATH, 'utf-8')
      const lines = content.split('\n')
      const nameservers: string[] = []

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('nameserver')) {
          const [, nameserver] = trimmed.split(/\s+/)
          if (nameserver && !nameserver.includes('%')) { // Skip link-local addresses
            nameservers.push(nameserver)
          }
        }
      }

      // Prefer IPv4 addresses
      const ipv4Nameserver = nameservers.find(ns => !ns.includes(':'))
      if (ipv4Nameserver) {
        debugLog('client', `Using IPv4 nameserver from resolv.conf: ${ipv4Nameserver}`, this.options.verbose)
        return ipv4Nameserver
      }

      // If no IPv4 nameserver found, use Cloudflare's DNS
      debugLog('client', `No valid nameserver found in resolv.conf, using fallback: ${DnsClient.DEFAULT_NAMESERVER}`, this.options.verbose)
      return DnsClient.DEFAULT_NAMESERVER
    }
    catch (err) {
      debugLog('client', `Failed to read resolv.conf: ${(err as Error).message}`, this.options.verbose)
      debugLog('client', `Using fallback nameserver: ${DnsClient.DEFAULT_NAMESERVER}`, this.options.verbose)
      return DnsClient.DEFAULT_NAMESERVER
    }
  }

  private async resolveWindowsNameserver(): Promise<string> {
    try {
      // On Windows, we could use the Registry or PowerShell
      // This is a simplified version - in practice, you might want to use
      // a native module or execute a PowerShell command to get this info
      debugLog('client', `Using default nameserver for Windows: ${DnsClient.DEFAULT_NAMESERVER}`, this.options.verbose)
      return DnsClient.DEFAULT_NAMESERVER
    }
    catch (err) {
      debugLog('client', `Failed to get Windows nameserver: ${(err as Error).message}`, this.options.verbose)
      throw new Error('Failed to get Windows nameserver')
    }
  }

  private determineTransportType(): TransportType {
    if (this.options.https)
      return TransportType.HTTPS
    if (this.options.tls)
      return TransportType.TLS
    if (this.options.tcp)
      return TransportType.TCP
    if (this.options.udp)
      return TransportType.UDP

    // Check if transport is TransportConfig
    if (typeof this.options.transport === 'object') {
      // Extract type from TransportConfig
      return this.options.transport.type || TransportType.UDP
    }

    // Otherwise assume it's directly a TransportType
    return TransportType.UDP
  }

  private validateOptions(): void {
    // Validate domains
    if (this.options.domains) {
      for (const domain of Array.isArray(this.options.domains) ? this.options.domains : [this.options.domains]) {
        this.validateDomainName(domain)
      }
    }

    // Validate record type(s)
    if (this.options.type) {
      const types = Array.isArray(this.options.type)
        ? this.options.type
        : [this.options.type]

      for (const type of types) {
        this.validateRecordType(type)
      }
    }

    // Transport validation
    const transportCount = [
      this.options.udp,
      this.options.tcp,
      this.options.tls,
      this.options.https,
    ].filter(Boolean).length

    if (transportCount > 1) {
      throw new Error('Only one transport type can be specified')
    }

    // Validate HTTPS transport
    if (this.options.https && !this.options.nameserver?.startsWith('https://')) {
      throw new Error('HTTPS transport requires an HTTPS nameserver URL')
    }

    debugLog('client', 'Options validation completed successfully', this.options.verbose)
  }
}
