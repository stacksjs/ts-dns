# Multiple Resolvers

dnsx supports various DNS resolvers and transport protocols. This guide covers how to configure and use different nameservers.

## Default Resolver

By default, dnsx uses the system's configured DNS resolver (from `/etc/resolv.conf` on Unix systems) or falls back to Cloudflare's `1.1.1.1`.

```typescript
// Uses system default
const client = new DnsClient({
  domains: ['example.com'],
})
```

## Public DNS Resolvers

### Cloudflare DNS

```bash
# CLI
dnsx example.com @1.1.1.1
dnsx example.com -n 1.0.0.1
```

```typescript
// Library
const client = new DnsClient({
  domains: ['example.com'],
  nameserver: '1.1.1.1',
})
```

### Google DNS

```bash
dnsx example.com @8.8.8.8
dnsx example.com @8.8.4.4
```

```typescript
const client = new DnsClient({
  domains: ['example.com'],
  nameserver: '8.8.8.8',
})
```

### Quad9

```bash
dnsx example.com @9.9.9.9
```

```typescript
const client = new DnsClient({
  domains: ['example.com'],
  nameserver: '9.9.9.9',
})
```

### OpenDNS

```bash
dnsx example.com @208.67.222.222
dnsx example.com @208.67.220.220
```

## Transport Protocols

### UDP (Default)

Standard DNS over UDP, port 53:

```bash
dnsx example.com -U
```

```typescript
const client = new DnsClient({
  domains: ['example.com'],
  udp: true,
})
```

### TCP

DNS over TCP, port 53. Useful for large responses:

```bash
dnsx example.com -T
```

```typescript
const client = new DnsClient({
  domains: ['example.com'],
  tcp: true,
})
```

### DNS-over-TLS (DoT)

Encrypted DNS over TLS, port 853:

```bash
dnsx example.com -S
```

```typescript
const client = new DnsClient({
  domains: ['example.com'],
  tls: true,
})
```

### DNS-over-HTTPS (DoH)

Encrypted DNS over HTTPS:

```bash
dnsx example.com -H -n https://cloudflare-dns.com/dns-query
```

```typescript
const client = new DnsClient({
  domains: ['example.com'],
  https: true,
  nameserver: 'https://cloudflare-dns.com/dns-query',
})
```

## DoH Endpoints

### Cloudflare DoH

```bash
dnsx example.com -H -n https://cloudflare-dns.com/dns-query
```

```typescript
const client = new DnsClient({
  domains: ['example.com'],
  https: true,
  nameserver: 'https://cloudflare-dns.com/dns-query',
})
```

### Google DoH

```bash
dnsx example.com -H -n https://dns.google/dns-query
```

```typescript
const client = new DnsClient({
  domains: ['example.com'],
  https: true,
  nameserver: 'https://dns.google/dns-query',
})
```

### Quad9 DoH

```bash
dnsx example.com -H -n https://dns.quad9.net/dns-query
```

## Private/Corporate DNS

### Internal Nameserver

```bash
dnsx internal.company.local @10.0.0.1
```

```typescript
const client = new DnsClient({
  domains: ['internal.company.local'],
  nameserver: '10.0.0.1',
})
```

### Multiple Queries with Different Resolvers

```typescript
// Query public DNS
const publicClient = new DnsClient({
  domains: ['example.com'],
  nameserver: '1.1.1.1',
})

// Query internal DNS
const internalClient = new DnsClient({
  domains: ['internal.corp'],
  nameserver: '10.0.0.1',
})

const [publicResults, internalResults] = await Promise.all([
  publicClient.query(),
  internalClient.query(),
])
```

## Transport Configuration

### Detailed Transport Options

```typescript
import { DnsClient, TransportType } from '@stacksjs/dnsx'

const client = new DnsClient({
  domains: ['example.com'],
  transport: {
    type: TransportType.TCP,
    timeout: 10000,  // 10 seconds
    retries: 5,
  },
})
```

### Automatic Fallback

When a UDP response is truncated, dnsx automatically retries with TCP:

```typescript
const client = new DnsClient({
  domains: ['example.com'],
  udp: true,  // Start with UDP
})

const responses = await client.query()
// If response.flags.truncated is true, automatically uses TCP
```

## Resolver Selection Guidelines

| Use Case | Recommended Resolver |
|----------|---------------------|
| General use | Cloudflare (1.1.1.1) |
| Privacy focus | Quad9 (9.9.9.9) |
| Compatibility | Google (8.8.8.8) |
| Corporate network | Internal DNS |
| Maximum privacy | DoH endpoints |
| Large responses | TCP transport |

## Error Handling

```typescript
try {
  const client = new DnsClient({
    domains: ['example.com'],
    nameserver: '10.0.0.1',
    timeout: 5000,
  })
  const responses = await client.query()
}
catch (error) {
  if (error.message.includes('HTTPS transport requires')) {
    console.error('Use HTTPS nameserver URL with -H flag')
  }
  else if (error.message.includes('Failed to resolve nameserver')) {
    console.error('Could not reach the nameserver')
  }
}
```

## Next Steps

- [JSON Output](/features/json-output) - Structured output formats
- [Custom Resolvers](/advanced/custom-resolvers) - Advanced resolver configuration
- [Performance](/advanced/performance) - Optimize query performance
