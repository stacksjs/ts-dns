# JSON Output

dnsx supports JSON output for easy parsing and integration with other tools. This guide covers output formats and options.

## Enabling JSON Output

### CLI

```bash
dnsx example.com --json
dnsx example.com -J
```

### Library

```typescript
const client = new DnsClient({
  domains: ['example.com'],
  json: true,
})
```

## JSON Response Structure

```json
{
  "id": 12345,
  "flags": {
    "response": true,
    "opcode": 0,
    "authoritative": false,
    "truncated": false,
    "recursionDesired": true,
    "recursionAvailable": true,
    "authenticData": false,
    "checkingDisabled": false,
    "responseCode": 0
  },
  "answers": [
    {
      "name": "example.com",
      "type": 1,
      "class": 1,
      "ttl": 300,
      "data": "93.184.216.34"
    }
  ],
  "authorities": [],
  "additionals": []
}
```

## Output Options

### Standard Output

Human-readable format with colors (default):

```bash
dnsx example.com
```

Output:
```
example.com.    300    IN    A    93.184.216.34
```

### Short Output

Display only the first result value:

```bash
dnsx example.com --short
dnsx example.com -1
```

Output:
```
93.184.216.34
```

### Show Query Time

Include timing information:

```bash
dnsx example.com --time
```

Output:
```
example.com.    300    IN    A    93.184.216.34
;; Query time: 23 msec
```

### Raw Seconds

Display TTL and timing in seconds:

```bash
dnsx example.com --seconds
```

### Color Control

```bash
# Always use colors
dnsx example.com --color always

# Auto-detect (default)
dnsx example.com --color auto

# Never use colors
dnsx example.com --color never
```

## Parsing JSON Output

### Shell Script

```bash
# Get IP address
dnsx example.com -J | jq -r '.answers[0].data'

# Get all A records
dnsx example.com -J -t A | jq -r '.answers[].data'

# Get MX records with priority
dnsx example.com -J -t MX | jq -r '.answers[] | "\(.data.preference) \(.data.exchange)"'
```

### Node.js/TypeScript

```typescript
import { DnsClient } from '@stacksjs/dnsx'

const client = new DnsClient({
  domains: ['example.com'],
  type: ['A', 'MX'],
})

const responses = await client.query()

// Convert to JSON
const jsonOutput = JSON.stringify(responses, null, 2)
console.log(jsonOutput)

// Or work with structured data
for (const response of responses) {
  const aRecords = response.answers
    .filter(a => a.type === 1)
    .map(a => a.data)

  console.log('IP addresses:', aRecords)
}
```

## Output Fields

### Answer Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Domain name |
| `type` | number | Record type (1=A, 28=AAAA, etc.) |
| `class` | number | Query class (1=IN) |
| `ttl` | number | Time to live in seconds |
| `data` | varies | Record data (format depends on type) |

### Record Data Formats

**A Record:**
```json
{ "data": "93.184.216.34" }
```

**AAAA Record:**
```json
{ "data": "2606:2800:220:1:248:1893:25c8:1946" }
```

**MX Record:**
```json
{
  "data": {
    "preference": 10,
    "exchange": "mail.example.com"
  }
}
```

**TXT Record:**
```json
{ "data": "v=spf1 include:_spf.example.com ~all" }
```

**SOA Record:**
```json
{
  "data": {
    "mname": "ns1.example.com",
    "rname": "admin.example.com",
    "serial": 2024010101,
    "refresh": 7200,
    "retry": 3600,
    "expire": 1209600,
    "minimum": 3600
  }
}
```

**SRV Record:**
```json
{
  "data": {
    "priority": 10,
    "weight": 5,
    "port": 5060,
    "target": "sip.example.com"
  }
}
```

## Combining Output Options

```bash
# JSON with timing
dnsx example.com -J --time

# Short JSON output
dnsx example.com -J --short
```

## Integration Examples

### With jq

```bash
# Pretty print
dnsx example.com -J | jq .

# Extract specific fields
dnsx example.com -J | jq '{domain: .answers[0].name, ip: .answers[0].data, ttl: .answers[0].ttl}'

# Filter by record type
dnsx example.com -J -t A -t AAAA | jq '.answers | group_by(.type)'
```

### With Scripts

```bash
#!/bin/bash
# Check if domain resolves
IP=$(dnsx example.com -J -1 | jq -r '.answers[0].data // empty')

if [ -n "$IP" ]; then
  echo "Domain resolves to: $IP"
else
  echo "Domain does not resolve"
  exit 1
fi
```

### With CI/CD

```yaml
# GitHub Actions example
- name: Check DNS
  run: |
    RESULT=$(dnsx ${{ env.DOMAIN }} -J -t A)
    IP=$(echo $RESULT | jq -r '.answers[0].data')
    echo "ip=$IP" >> $GITHUB_OUTPUT
```

## Next Steps

- [Configuration](/config) - Configure output defaults
- [CI/CD Integration](/advanced/ci-cd-integration) - Use in pipelines
- [Performance](/advanced/performance) - Optimize for batch queries
