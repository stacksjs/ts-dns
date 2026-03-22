# Performance

This guide covers performance optimization strategies for dnsx, including batch queries, caching, and efficient transport selection.

## Transport Selection

### UDP vs TCP

| Transport | Latency | Reliability | Use Case |
|-----------|---------|-------------|----------|
| UDP | Low | Medium | Default, small queries |
| TCP | Medium | High | Large responses, reliability |
| DoT | Medium | High | Privacy |
| DoH | High | High | Maximum privacy |

```typescript
// Fastest (UDP)
const fast = new DnsClient({
  domains: ['example.com'],
  udp: true,
  timeout: 3000,
})

// Most reliable (TCP)
const reliable = new DnsClient({
  domains: ['example.com'],
  tcp: true,
  timeout: 10000,
})
```

### Automatic Fallback

UDP with automatic TCP fallback for truncated responses:

```typescript
const client = new DnsClient({
  domains: ['example.com'],
  udp: true,  // Start with UDP
})

const responses = await client.query()
// If truncated, automatically retries with TCP
```

## Timeout Optimization

### Aggressive Timeouts

For low-latency requirements:

```typescript
const client = new DnsClient({
  domains: ['example.com'],
  timeout: 1000,   // 1 second
  retries: 1,      // Single retry
})
```

### Reliable Timeouts

For maximum reliability:

```typescript
const client = new DnsClient({
  domains: ['example.com'],
  timeout: 10000,  // 10 seconds
  retries: 5,      // More retries
})
```

### Exponential Backoff

dnsx uses exponential backoff between retries:

```
Attempt 1: immediate
Attempt 2: 1 second delay
Attempt 3: 2 seconds delay
Attempt 4: 4 seconds delay
...
```

## Batch Queries

### Multiple Domains

```typescript
// Query multiple domains efficiently
const client = new DnsClient({
  domains: ['example.com', 'google.com', 'github.com'],
  type: 'A',
})

const responses = await client.query()
// Queries are built for all domains
```

### Multiple Types

```typescript
// Query multiple record types
const client = new DnsClient({
  domains: ['example.com'],
  type: ['A', 'AAAA', 'MX', 'TXT'],
})

const responses = await client.query()
```

### Parallel Queries

Query multiple servers in parallel:

```typescript
async function parallelQuery(domain: string) {
  const resolvers = [
    { nameserver: '1.1.1.1' },
    { nameserver: '8.8.8.8' },
    { nameserver: '9.9.9.9' },
  ]

  const queries = resolvers.map(config =>
    new DnsClient({
      domains: [domain],
      ...config,
      timeout: 2000,
    }).query().catch(() => null)
  )

  const results = await Promise.all(queries)
  return results.filter(Boolean)[0]
}
```

## Caching Strategies

### TTL-Based Caching

```typescript
class DnsCache {
  private cache = new Map<string, {
    responses: DnsResponse[]
    expires: number
  }>()

  private getKey(domains: string[], type: string): string {
    return `${domains.sort().join(',')}:${type}`
  }

  async query(options: DnsOptions): Promise<DnsResponse[]> {
    const key = this.getKey(
      options.domains || [],
      options.type as string || 'A'
    )

    const cached = this.cache.get(key)
    if (cached && cached.expires > Date.now()) {
      return cached.responses
    }

    const client = new DnsClient(options)
    const responses = await client.query()

    // Calculate minimum TTL
    const minTtl = Math.min(
      300, // Maximum cache time
      ...responses.flatMap(r =>
        r.answers.map(a => a.ttl)
      ).filter(ttl => ttl > 0)
    )

    this.cache.set(key, {
      responses,
      expires: Date.now() + minTtl * 1000,
    })

    return responses
  }

  clear(): void {
    this.cache.clear()
  }

  prune(): void {
    const now = Date.now()
    for (const [key, value] of this.cache.entries()) {
      if (value.expires <= now) {
        this.cache.delete(key)
      }
    }
  }
}

// Usage
const cache = new DnsCache()
const responses = await cache.query({
  domains: ['example.com'],
  type: 'A',
})
```

### Negative Caching

Cache NXDOMAIN responses:

```typescript
class DnsCacheWithNegative extends DnsCache {
  private negativeCache = new Map<string, number>()
  private negativeTtl = 60000 // 1 minute

  async query(options: DnsOptions): Promise<DnsResponse[]> {
    const key = this.getKey(options.domains || [], options.type as string)

    // Check negative cache
    const negativeExpires = this.negativeCache.get(key)
    if (negativeExpires && negativeExpires > Date.now()) {
      throw new Error('NXDOMAIN (cached)')
    }

    try {
      return await super.query(options)
    }
    catch (error) {
      if (error.message.includes('NXDOMAIN')) {
        this.negativeCache.set(key, Date.now() + this.negativeTtl)
      }
      throw error
    }
  }
}
```

## Connection Pooling

### TCP Connection Reuse

For multiple TCP queries:

```typescript
// dnsx handles connection management internally
// but you can optimize by batching queries

const domains = ['example.com', 'google.com', 'github.com']

// Better: single client with multiple domains
const client = new DnsClient({
  domains,
  tcp: true,
})
const responses = await client.query()

// Worse: multiple clients (multiple connections)
// const responses = await Promise.all(
//   domains.map(d => new DnsClient({ domains: [d], tcp: true }).query())
// )
```

## Memory Optimization

### Stream Processing

For high-volume queries:

```typescript
async function* queryStream(domains: string[]) {
  const batchSize = 10

  for (let i = 0; i < domains.length; i += batchSize) {
    const batch = domains.slice(i, i + batchSize)
    const client = new DnsClient({
      domains: batch,
      type: 'A',
    })

    const responses = await client.query()
    yield responses
  }
}

// Usage
for await (const batch of queryStream(largeDomainList)) {
  processBatch(batch)
}
```

## Benchmarking

### Measure Query Time

```typescript
async function benchmark(domain: string, iterations = 100) {
  const times: number[] = []

  for (let i = 0; i < iterations; i++) {
    const start = performance.now()

    const client = new DnsClient({
      domains: [domain],
      type: 'A',
    })
    await client.query()

    times.push(performance.now() - start)
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length
  const min = Math.min(...times)
  const max = Math.max(...times)

  console.log(`Benchmarking ${domain}:`)
  console.log(`  Avg: ${avg.toFixed(2)}ms`)
  console.log(`  Min: ${min.toFixed(2)}ms`)
  console.log(`  Max: ${max.toFixed(2)}ms`)
}
```

## Best Practices

1. **Use UDP for speed**: Default to UDP unless you need reliability
2. **Batch queries**: Query multiple domains/types together
3. **Cache responses**: Respect TTL values
4. **Set appropriate timeouts**: Balance speed and reliability
5. **Use parallel queries**: Query multiple resolvers for failover
6. **Monitor performance**: Track query times in production

## Next Steps

- [CI/CD Integration](/advanced/ci-cd-integration) - Automate DNS testing
- [Custom Resolvers](/advanced/custom-resolvers) - Optimize resolver selection
- [Configuration](/advanced/configuration) - Fine-tune settings
