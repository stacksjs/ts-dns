import { Buffer } from 'node:buffer'
import dgram from 'node:dgram'
import https from 'node:https'
import net from 'node:net'
import { isIP } from 'node:net'
import tls from 'node:tls'
import { URL } from 'node:url'

/**
 * Available DNS transport protocols.
 * Each transport type represents a different way to send DNS queries.
 */
export enum TransportType {
  UDP = 'udp', // Traditional UDP DNS (port 53)
  TCP = 'tcp', // TCP DNS (port 53)
  TLS = 'tls', // DNS-over-TLS (port 853)
  HTTPS = 'https', // DNS-over-HTTPS
}

/**
 * Interface for DNS transport implementations.
 * All transport types must implement this interface.
 */
export interface Transport {
  /**
   * Sends a DNS query to a nameserver and returns the response.
   *
   * @param nameserver - The nameserver to query (IP or hostname, optionally with port)
   * @param request - The DNS query packet as a Buffer
   * @returns Promise resolving to the DNS response packet
   * @throws {Error} If the query fails or times out
   */
  query: (nameserver: string, request: Buffer) => Promise<Buffer>
}

/**
 * UDP transport implementation for DNS queries.
 * Uses UDP datagrams for maximum performance with retransmission support.
 *
 * Features:
 * - Automatic port selection (default: 53)
 * - Configurable timeout
 * - Error handling for network issues
 */
class UDPTransport implements Transport {
  private static readonly DEFAULT_PORT = 53
  private static readonly TIMEOUT = 5000

  async query(nameserver: string, request: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const client = dgram.createSocket('udp4')
      let timeoutId: ReturnType<typeof setTimeout>

      // Parse nameserver string
      let host: string
      let port: number = UDPTransport.DEFAULT_PORT

      if (nameserver.includes(':')) {
        const [h, p] = nameserver.split(':')
        host = h
        const parsedPort = Number.parseInt(p, 10)
        if (parsedPort > 0 && parsedPort < 65536)
          port = parsedPort
      }
      else {
        host = nameserver
      }

      client.on('error', (err) => {
        clearTimeout(timeoutId)
        client.close()
        reject(err)
      })

      client.on('message', (msg: Buffer) => {
        clearTimeout(timeoutId)
        client.close()
        resolve(msg)
      })

      // Handle timeouts
      timeoutId = setTimeout(() => {
        client.close()
        reject(new Error('UDP query timed out'))
      }, UDPTransport.TIMEOUT)

      // Convert Buffer to Uint8Array for send
      const data = new Uint8Array(request.buffer, request.byteOffset, request.length)

      client.send(data, port, host, (err) => {
        if (err) {
          clearTimeout(timeoutId)
          client.close()
          reject(err)
        }
      })
    })
  }
}

/**
 * TCP transport implementation for DNS queries.
 * Used for larger DNS messages and when reliability is crucial.
 *
 * Features:
 * - Length-prefixed messages (RFC 1035)
 * - Automatic message reassembly
 * - Connection timeout handling
 */
class TCPTransport implements Transport {
  private static readonly DEFAULT_PORT = 53
  private static readonly TIMEOUT = 5000

  async query(nameserver: string, request: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket()
      let timeoutId: ReturnType<typeof setTimeout>
      // Initialize data as Uint8Array instead of Buffer
      let data = new Uint8Array(0)
      let expectedLength = -1

      socket.on('error', (err) => {
        clearTimeout(timeoutId)
        socket.destroy()
        reject(err)
      })

      socket.on('data', (chunk: Buffer) => {
        // Convert incoming chunks to Uint8Array and concatenate
        const newData = new Uint8Array(data.length + chunk.length)
        newData.set(data)
        newData.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length), data.length)
        data = newData

        // First two bytes are the length in TCP DNS messages
        if (expectedLength === -1 && data.length >= 2) {
          // Use DataView for reading uint16
          const view = new DataView(data.buffer, data.byteOffset)
          expectedLength = view.getUint16(0) + 2 // +2 for length field itself
        }

        // Check if we have the complete message
        if (expectedLength !== -1 && data.length >= expectedLength) {
          clearTimeout(timeoutId)
          socket.destroy()
          // Convert back to Buffer for response, excluding first 2 bytes
          resolve(Buffer.from(data.slice(2, expectedLength)))
        }
      })

      // Handle timeouts with proper type
      timeoutId = setTimeout(() => {
        socket.destroy()
        reject(new Error('TCP query timed out'))
      }, TCPTransport.TIMEOUT)

      // Extract host and port
      const [host, port = TCPTransport.DEFAULT_PORT] = nameserver.split(':')

      socket.connect(Number(port), host, () => {
        // Prepare length prefix and message
        const lengthPrefix = new Uint8Array(2)
        const view = new DataView(lengthPrefix.buffer)
        view.setUint16(0, request.length)

        // Convert request to Uint8Array
        const requestData = new Uint8Array(
          request.buffer,
          request.byteOffset,
          request.length,
        )

        // Combine length prefix and request data
        const message = new Uint8Array(lengthPrefix.length + requestData.length)
        message.set(lengthPrefix)
        message.set(requestData, lengthPrefix.length)

        // Write the combined message
        socket.write(message, (err) => {
          if (err) {
            clearTimeout(timeoutId)
            socket.destroy()
            reject(err)
          }
        })
      })
    })
  }
}

/**
 * TLS transport implementation for DNS queries (DNS-over-TLS).
 * Provides encrypted DNS communication for enhanced privacy.
 *
 * Features:
 * - TLS 1.2+ encryption
 * - SNI support
 * - Certificate validation
 * - Length-prefixed messages
 */
class TLSTransport implements Transport {
  private static readonly DEFAULT_PORT = 853
  private static readonly TIMEOUT = 5000

  async query(nameserver: string, request: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const [host = '', rawPort] = nameserver.split(':')
      const port = Number(rawPort) || TLSTransport.DEFAULT_PORT
      const options = {
        host,
        port,
        ...(isIP(host) === 0 ? { servername: host } : {}),
      }

      let timeoutId: ReturnType<typeof setTimeout>

      const socket = tls.connect(options, () => {
        if (!socket.authorized) {
          socket.destroy()
          reject(new Error('TLS authorization failed'))
          return
        }

        // Prepare length prefix using DataView
        const lengthPrefix = new Uint8Array(2)
        const view = new DataView(lengthPrefix.buffer)
        view.setUint16(0, request.length)

        // Convert request to Uint8Array
        const requestData = new Uint8Array(
          request.buffer,
          request.byteOffset,
          request.length,
        )

        // Combine length prefix and request data
        const message = new Uint8Array(lengthPrefix.length + requestData.length)
        message.set(lengthPrefix)
        message.set(requestData, lengthPrefix.length)

        // Write the combined message
        socket.write(message, (err) => {
          if (err) {
            clearTimeout(timeoutId)
            socket.destroy()
            reject(err)
          }
        })
      })

      // Initialize data as Uint8Array
      let data = new Uint8Array(0)
      let expectedLength = -1

      socket.on('error', (err) => {
        clearTimeout(timeoutId)
        socket.destroy()
        reject(err)
      })

      socket.on('data', (chunk: Buffer) => {
        // Convert incoming chunks to Uint8Array and concatenate
        const newData = new Uint8Array(data.length + chunk.length)
        newData.set(data)
        newData.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length), data.length)
        data = newData

        // Check length if not yet determined
        if (expectedLength === -1 && data.length >= 2) {
          const view = new DataView(data.buffer, data.byteOffset)
          expectedLength = view.getUint16(0) + 2 // +2 for length field itself
        }

        // Check if we have the complete message
        if (expectedLength !== -1 && data.length >= expectedLength) {
          clearTimeout(timeoutId)
          socket.destroy()
          // Convert back to Buffer for response, excluding first 2 bytes
          resolve(Buffer.from(data.slice(2, expectedLength)))
        }
      })

      // Handle timeouts with proper type
      timeoutId = setTimeout(() => {
        socket.destroy()
        reject(new Error('TLS query timed out'))
      }, TLSTransport.TIMEOUT)
    })
  }
}

/**
 * HTTPS transport implementation for DNS queries (DNS-over-HTTPS).
 * Provides encrypted DNS communication over HTTPS for maximum compatibility.
 *
 * Features:
 * - HTTPS POST requests
 * - Binary DNS wire format
 * - Standard HTTPS port (443)
 * - Compatible with HTTP proxies
 */
class HTTPSTransport implements Transport {
  private static readonly TIMEOUT = 5000
  private static readonly CONTENT_TYPE = 'application/dns-message'

  async query(nameserver: string, request: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      let url: URL
      try {
        url = new URL(nameserver)
      }
      catch {
        url = new URL(`https://${nameserver}/dns-query`)
      }

      const options = {
        method: 'POST',
        headers: {
          'Content-Type': HTTPSTransport.CONTENT_TYPE,
          'Content-Length': request.length.toString(),
          'Accept': HTTPSTransport.CONTENT_TYPE,
        },
        timeout: HTTPSTransport.TIMEOUT,
      }

      const req = https.request(url, options, (res) => {
        // Use Uint8Array for accumulating chunks
        const chunks: Uint8Array[] = []

        res.on('data', (chunk: Buffer) => {
          // Convert each chunk to Uint8Array and store
          chunks.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length))
        })

        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTPS query failed with status ${res.statusCode}`))
            return
          }

          const contentType = res.headers['content-type']
          if (contentType !== HTTPSTransport.CONTENT_TYPE) {
            reject(new Error(`Invalid content type: ${contentType}`))
            return
          }

          // Combine all chunks into one Uint8Array
          const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
          const combined = new Uint8Array(totalLength)
          let offset = 0
          for (const chunk of chunks) {
            combined.set(chunk, offset)
            offset += chunk.length
          }

          // Convert final result back to Buffer
          resolve(Buffer.from(combined))
        })
      })

      req.on('error', reject)
      req.on('timeout', () => {
        req.destroy()
        reject(new Error('HTTPS query timed out'))
      })

      // Write request data
      req.write(new Uint8Array(request.buffer, request.byteOffset, request.length))
      req.end()
    })
  }
}

/**
 * Creates a transport instance based on the specified type.
 * Factory function to get the appropriate transport implementation.
 *
 * @param type - The type of transport to create
 * @returns A transport instance implementing the Transport interface
 * @throws {Error} If the transport type is not supported
 *
 * @example
 * ```ts
 * const transport = createTransport(TransportType.UDP)
 * const response = await transport.query('1.1.1.1', dnsPacket)
 * ```
 */
export function createTransport(type: TransportType): Transport {
  switch (type) {
    case TransportType.UDP:
      return new UDPTransport()
    case TransportType.TCP:
      return new TCPTransport()
    case TransportType.TLS:
      return new TLSTransport()
    case TransportType.HTTPS:
      return new HTTPSTransport()
  }
}
