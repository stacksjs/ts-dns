# Advanced Configuration

This guide covers advanced configuration options for dnsx, including protocol tweaks, transport settings, and programmatic configuration.

## Protocol Tweaks

### DNS Flags

Control DNS protocol flags:

```bash
# Set Authoritative Answer flag
dnsx example.com -Z aa

# Set Authentic Data flag
dnsx example.com -Z ad

# Set Checking Disabled flag
dnsx example.com -Z cd
```

```typescript
import { DnsClient } from '@stacksjs/dnsx'

const client = new DnsClient({
  domains: ['example.com'],
  tweaks: {
    authoritative: true,
    authenticData: true,
    checkingDisabled: false,
  },
})
```

### EDNS Configuration

Extended DNS (EDNS) provides additional capabilities:

```bash
# Show EDNS records
dnsx example.com --edns show

# Hide EDNS records
dnsx example.com --edns hide

# Disable EDNS entirely
dnsx example.com --edns disable

# Set UDP payload size
dnsx example.com -Z bufsize=4096
```

```typescript
const client = new DnsClient({
  domains: ['example.com'],
  edns: 'show',
  tweaks: {
    udpPayloadSize: 4096,
  },
})
```

## Transport Configuration

### UDP Settings

```typescript
const client = new DnsClient({
  domains: ['example.com'],
  udp: true,
  transport: {
    type: TransportType.UDP,
    timeout: 5000,
    retries: 3,
  },
})
```

### TCP Settings

```typescript
const client = new DnsClient({
  domains: ['example.com'],
  tcp: true,
  transport: {
    type: TransportType.TCP,
    timeout: 10000,  // TCP can be slower
    retries: 2,
  },
})
```

### TLS Settings (DNS-over-TLS)

```typescript
const client = new DnsClient({
  domains: ['example.com'],
  tls: true,
  transport: {
    type: TransportType.TLS,
    timeout: 15000,
  },
})
```

### HTTPS Settings (DNS-over-HTTPS)

```typescript
const client = new DnsClient({
  domains: ['example.com'],
  https: true,
  nameserver: 'https://cloudflare-dns.com/dns-query',
  transport: {
    type: TransportType.HTTPS,
    timeout: 10000,
  },
})
```

## Configuration File

### Complete Configuration Example

```typescript
// dnsx.config.ts
import type { DnsOptions } from '@stacksjs/dnsx'

const config: DnsOptions = {
  // Query configuration
  domains: [],  // Set per query
  type: 'A',
  class: 'IN',

  // Default nameserver
  nameserver: '1.1.1.1',

  // Transport
  udp: true,
  tcp: false,
  tls: false,
  https: false,

  // Timeouts and retries
  timeout: 5000,
  retries: 3,

  // Protocol options
  edns: 'show',
  txid: undefined,  // Random if not set

  // Protocol tweaks
  tweaks: {
    authoritative: false,
    authenticData: false,
    checkingDisabled: false,
    udpPayloadSize: 1232,
  },

  // Output options
  short: false,
  json: false,
  color: 'auto',
  seconds: false,
  time: false,
  verbose: false,
}

export default config
```

### Environment-Specific Configuration

```typescript
// dnsx.config.ts
const isDev = process.env.NODE_ENV === 'development'

export default {
  nameserver: isDev ? '8.8.8.8' : '1.1.1.1',
  verbose: isDev,
  timeout: isDev ? 10000 : 5000,
}
```

## Programmatic Configuration

### Dynamic Configuration

```typescript
function createClient(domain: string, options: Partial<DnsOptions> = {}) {
  return new DnsClient({
    domains: [domain],
    type: 'A',
    nameserver: '1.1.1.1',
    ...options,
  })
}

// Use with different configurations
const publicClient = createClient('example.com')
const privateClient = createClient('internal.corp', {
  nameserver: '10.0.0.1',
  tcp: true,
})
```

### Configuration Builder

```typescript
class DnsClientBuilder {
  private options: Partial<DnsOptions> = {}

  domain(domain: string): this {
    this.options.domains = [...(this.options.domains || []), domain]
    return this
  }

  type(type: string | string[]): this {
    this.options.type = type
    return this
  }

  nameserver(ns: string): this {
    this.options.nameserver = ns
    return this
  }

  useTcp(): this {
    this.options.tcp = true
    return this
  }

  useHttps(endpoint: string): this {
    this.options.https = true
    this.options.nameserver = endpoint
    return this
  }

  verbose(): this {
    this.options.verbose = true
    return this
  }

  build(): DnsClient {
    return new DnsClient(this.options as DnsOptions)
  }
}

// Usage
const client = new DnsClientBuilder()
  .domain('example.com')
  .type(['A', 'AAAA'])
  .nameserver('1.1.1.1')
  .verbose()
  .build()
```

## Query Options

### Transaction ID

Set a specific transaction ID for debugging:

```typescript
const client = new DnsClient({
  domains: ['example.com'],
  txid: 12345,
})

const responses = await client.query()
console.log('Transaction ID:', responses[0].id) // 12345
```

### Query Class

```typescript
import { DnsClient, QClass } from '@stacksjs/dnsx'

// Standard Internet queries
const inClient = new DnsClient({
  domains: ['example.com'],
  class: QClass.IN,
})

// CHAOS class (for server info)
const chClient = new DnsClient({
  domains: ['version.bind'],
  class: QClass.CH,
  type: 'TXT',
})
```

## Validation Options

### Domain Validation

dnsx validates domain names automatically:

```typescript
// These will throw errors:
// - Consecutive dots
// - Starting/ending dots
// - Labels over 63 characters
// - Domain over 253 characters
// - Invalid characters

try {
  const client = new DnsClient({
    domains: ['invalid..domain'],
  })
}
catch (error) {
  console.error(error.message) // "Invalid domain name: consecutive dots"
}
```

### Record Type Validation

```typescript
try {
  const client = new DnsClient({
    domains: ['example.com'],
    type: 'INVALID',
  })
}
catch (error) {
  console.error(error.message) // "Invalid record type: INVALID"
}
```

## Logging and Debugging

### Verbose Mode

```typescript
const client = new DnsClient({
  domains: ['example.com'],
  verbose: true,
})

// Logs will include:
// - Transport selection
// - Nameserver resolution
// - Query building
// - Request/response hex data
// - Retry attempts
```

### Custom Debug Function

```typescript
import { debugLog } from '@stacksjs/dnsx'

// Enable debug logging
debugLog('client', 'Custom debug message', true)
```

## Next Steps

- [Custom Resolvers](/advanced/custom-resolvers) - Configure DNS resolvers
- [Performance](/advanced/performance) - Optimize queries
- [CI/CD Integration](/advanced/ci-cd-integration) - Automate DNS checks
