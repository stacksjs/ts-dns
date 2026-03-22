# Custom Resolvers

dnsx supports various DNS resolvers for different use cases. This guide covers setting up and using custom DNS resolvers.

## Resolver Types

### Standard UDP/TCP Resolvers

Traditional DNS servers on port 53:

```typescript
import { DnsClient } from '@stacksjs/dnsx'

// UDP (default)
const udpClient = new DnsClient({
  domains: ['example.com'],
  nameserver: '1.1.1.1',
  udp: true,
})

// TCP
const tcpClient = new DnsClient({
  domains: ['example.com'],
  nameserver: '1.1.1.1',
  tcp: true,
})
```

### DNS-over-TLS (DoT) Resolvers

Encrypted DNS on port 853:

```typescript
const dotClient = new DnsClient({
  domains: ['example.com'],
  tls: true,
})
```

### DNS-over-HTTPS (DoH) Resolvers

DNS over HTTPS for maximum privacy:

```typescript
const dohClient = new DnsClient({
  domains: ['example.com'],
  https: true,
  nameserver: 'https://cloudflare-dns.com/dns-query',
})
```

## Public DNS Providers

### Cloudflare

```typescript
// Standard DNS
const cloudflare = new DnsClient({
  domains: ['example.com'],
  nameserver: '1.1.1.1',
})

// DoH
const cloudflareDoH = new DnsClient({
  domains: ['example.com'],
  https: true,
  nameserver: 'https://cloudflare-dns.com/dns-query',
})

// Malware blocking
const cloudflareSecurity = new DnsClient({
  domains: ['example.com'],
  nameserver: '1.1.1.2',
})

// Family filter
const cloudflareFamily = new DnsClient({
  domains: ['example.com'],
  nameserver: '1.1.1.3',
})
```

### Google

```typescript
// Standard DNS
const google = new DnsClient({
  domains: ['example.com'],
  nameserver: '8.8.8.8',
})

// DoH
const googleDoH = new DnsClient({
  domains: ['example.com'],
  https: true,
  nameserver: 'https://dns.google/dns-query',
})
```

### Quad9

```typescript
// Standard DNS (with security)
const quad9 = new DnsClient({
  domains: ['example.com'],
  nameserver: '9.9.9.9',
})

// Unsecured (no blocking)
const quad9Unsecured = new DnsClient({
  domains: ['example.com'],
  nameserver: '9.9.9.10',
})

// DoH
const quad9DoH = new DnsClient({
  domains: ['example.com'],
  https: true,
  nameserver: 'https://dns.quad9.net/dns-query',
})
```

### OpenDNS

```typescript
const opendns = new DnsClient({
  domains: ['example.com'],
  nameserver: '208.67.222.222',
})

// Family Shield
const opendnsFamily = new DnsClient({
  domains: ['example.com'],
  nameserver: '208.67.222.123',
})
```

## Corporate/Private Resolvers

### Internal DNS

```typescript
const internal = new DnsClient({
  domains: ['server.internal.corp'],
  nameserver: '10.0.0.1',
  tcp: true,  // Often more reliable for internal
})
```

### Split Horizon DNS

Query different resolvers based on domain:

```typescript
function getResolver(domain: string): string {
  if (domain.endsWith('.internal.corp')) {
    return '10.0.0.1'
  }
  if (domain.endsWith('.test')) {
    return '127.0.0.1'
  }
  return '1.1.1.1'
}

async function query(domain: string) {
  const client = new DnsClient({
    domains: [domain],
    nameserver: getResolver(domain),
  })
  return client.query()
}
```

## Resolver Selection Strategy

### By Use Case

```typescript
interface ResolverConfig {
  nameserver: string
  https?: boolean
  tls?: boolean
}

const resolvers: Record<string, ResolverConfig> = {
  default: { nameserver: '1.1.1.1' },
  privacy: { nameserver: 'https://cloudflare-dns.com/dns-query', https: true },
  security: { nameserver: '9.9.9.9' },
  internal: { nameserver: '10.0.0.1' },
  development: { nameserver: '127.0.0.1' },
}

function createClient(domain: string, profile: keyof typeof resolvers) {
  const config = resolvers[profile]
  return new DnsClient({
    domains: [domain],
    ...config,
  })
}
```

### With Fallback

```typescript
async function queryWithFallback(domain: string) {
  const resolvers = ['1.1.1.1', '8.8.8.8', '9.9.9.9']

  for (const nameserver of resolvers) {
    try {
      const client = new DnsClient({
        domains: [domain],
        nameserver,
        timeout: 3000,
        retries: 1,
      })
      return await client.query()
    }
    catch (error) {
      console.warn(`Resolver ${nameserver} failed, trying next...`)
    }
  }

  throw new Error('All resolvers failed')
}
```

## Performance Optimization

### Parallel Queries

Query multiple resolvers simultaneously:

```typescript
async function queryParallel(domain: string) {
  const resolvers = ['1.1.1.1', '8.8.8.8']

  const results = await Promise.race(
    resolvers.map(nameserver =>
      new DnsClient({
        domains: [domain],
        nameserver,
      }).query()
    )
  )

  return results
}
```

### Caching Layer

Implement a simple cache:

```typescript
const cache = new Map<string, { data: any; expires: number }>()

async function cachedQuery(domain: string, type: string = 'A') {
  const key = `${domain}:${type}`
  const cached = cache.get(key)

  if (cached && cached.expires > Date.now()) {
    return cached.data
  }

  const client = new DnsClient({
    domains: [domain],
    type,
  })

  const responses = await client.query()

  // Cache for minimum TTL
  const minTtl = Math.min(
    ...responses.flatMap(r => r.answers.map(a => a.ttl))
  )

  cache.set(key, {
    data: responses,
    expires: Date.now() + minTtl * 1000,
  })

  return responses
}
```

## Resolver Health Checks

### Monitor Resolver Availability

```typescript
async function checkResolver(nameserver: string): Promise<boolean> {
  try {
    const client = new DnsClient({
      domains: ['cloudflare.com'],
      nameserver,
      type: 'A',
      timeout: 2000,
    })

    await client.query()
    return true
  }
  catch {
    return false
  }
}

async function getHealthyResolver(resolvers: string[]): Promise<string> {
  for (const resolver of resolvers) {
    if (await checkResolver(resolver)) {
      return resolver
    }
  }
  throw new Error('No healthy resolvers found')
}
```

## Next Steps

- [Performance](/advanced/performance) - Optimize query performance
- [CI/CD Integration](/advanced/ci-cd-integration) - Automate DNS testing
- [Configuration](/advanced/configuration) - Full configuration reference
