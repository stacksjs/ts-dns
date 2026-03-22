# DNS Queries

dnsx provides a powerful and flexible interface for performing DNS queries. This guide covers the various ways to query DNS records.

## Basic Queries

### Single Domain Query

The simplest way to query DNS is with a single domain:

```bash
# CLI
dnsx example.com
```

```typescript
// Library
import { DnsClient } from '@stacksjs/dnsx'

const client = new DnsClient({
  domains: ['example.com'],
})

const responses = await client.query()
```

### Multiple Domain Queries

Query multiple domains in a single operation:

```bash
# CLI
dnsx example.com google.com github.com
```

```typescript
// Library
const client = new DnsClient({
  domains: ['example.com', 'google.com', 'github.com'],
})

const responses = await client.query()

// responses contains results for all domains
for (const response of responses) {
  console.log(`Results for query ${response.id}:`)
  for (const answer of response.answers) {
    console.log(`  ${answer.name}: ${answer.data}`)
  }
}
```

## Query Types

### Single Type Query

```bash
# CLI
dnsx example.com --type MX
dnsx example.com -t AAAA
```

```typescript
// Library
const client = new DnsClient({
  domains: ['example.com'],
  type: 'MX',
})
```

### Multiple Type Queries

```bash
# CLI
dnsx example.com A AAAA MX TXT
dnsx example.com -t A -t AAAA -t MX
```

```typescript
// Library
const client = new DnsClient({
  domains: ['example.com'],
  type: ['A', 'AAAA', 'MX', 'TXT'],
})
```

## Query Classes

DNS supports different query classes. The default is `IN` (Internet):

```bash
# CLI
dnsx example.com --class IN
dnsx example.com --class CH  # CHAOS
```

```typescript
// Library
import { DnsClient, QClass } from '@stacksjs/dnsx'

const client = new DnsClient({
  domains: ['example.com'],
  class: 'IN',
})

// Or use enum
const client = new DnsClient({
  domains: ['example.com'],
  class: QClass.IN,
})
```

## Response Structure

### Accessing Responses

```typescript
const responses = await client.query()

for (const response of responses) {
  // Transaction ID
  console.log('ID:', response.id)

  // Response flags
  console.log('Authoritative:', response.flags.authoritative)
  console.log('Truncated:', response.flags.truncated)
  console.log('Recursion Available:', response.flags.recursionAvailable)

  // Answer section
  for (const answer of response.answers) {
    console.log('Name:', answer.name)
    console.log('Type:', answer.type)
    console.log('Class:', answer.class)
    console.log('TTL:', answer.ttl)
    console.log('Data:', answer.data)
  }

  // Authority section
  for (const authority of response.authorities) {
    console.log('Authority:', authority.name)
  }

  // Additional section
  for (const additional of response.additionals) {
    console.log('Additional:', additional.name)
  }
}
```

### Response Codes

```typescript
import { DnsResponseCode } from '@stacksjs/dnsx'

const response = responses[0]

switch (response.flags.responseCode) {
  case DnsResponseCode.NoError:
    console.log('Query successful')
    break
  case DnsResponseCode.NXDomain:
    console.log('Domain does not exist')
    break
  case DnsResponseCode.ServFail:
    console.log('Server failure')
    break
  case DnsResponseCode.Refused:
    console.log('Query refused')
    break
}
```

## Query Options

### Recursion

```typescript
// Library
const client = new DnsClient({
  domains: ['example.com'],
  query: {
    recursive: true,
  },
})
```

### EDNS

EDNS (Extension Mechanisms for DNS) provides additional capabilities:

```bash
# CLI
dnsx example.com --edns show    # Show EDNS records
dnsx example.com --edns hide    # Process but hide EDNS
dnsx example.com --edns disable # Disable EDNS
```

```typescript
// Library
import { DnsClient, EDNSMode } from '@stacksjs/dnsx'

const client = new DnsClient({
  domains: ['example.com'],
  edns: EDNSMode.Show,
})
```

### Transaction ID

Set a specific transaction ID for the query:

```bash
# CLI
dnsx example.com --txid 12345
```

```typescript
// Library
const client = new DnsClient({
  domains: ['example.com'],
  txid: 12345,
})
```

## Retry and Timeout

Configure retry behavior for resilient queries:

```typescript
const client = new DnsClient({
  domains: ['example.com'],
  timeout: 5000,  // 5 seconds
  retries: 3,     // Retry up to 3 times
})
```

The client uses exponential backoff between retries.

## Error Handling

```typescript
try {
  const responses = await client.query()
}
catch (error) {
  if (error.message.includes('No domains specified')) {
    console.error('Please provide at least one domain')
  }
  else if (error.message.includes('Invalid domain name')) {
    console.error('Domain name is invalid')
  }
  else if (error.message.includes('DNS query failed')) {
    console.error('Query failed:', error.message)
  }
}
```

## Next Steps

- [Record Types](/features/record-types) - Learn about supported record types
- [Multiple Resolvers](/features/multiple-resolvers) - Use different DNS servers
- [JSON Output](/features/json-output) - Output formats
