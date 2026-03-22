# CI/CD Integration

This guide covers integrating dnsx into CI/CD pipelines for automated DNS testing, validation, and monitoring.

## GitHub Actions

### Basic DNS Check

```yaml
# .github/workflows/dns-check.yml
name: DNS Check

on:
  push:
    branches: [main]
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours

jobs:
  dns-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v1

      - name: Install dnsx
        run: bun add -g @stacksjs/dnsx

      - name: Check DNS records
        run: |
          dnsx example.com -t A -J > dns-results.json
          cat dns-results.json
```

### Verify DNS Configuration

```yaml
name: Verify DNS

on:
  pull_request:
    paths:
      - 'terraform/**'
      - 'dns/**'

jobs:
  verify-dns:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v1

      - name: Install dnsx
        run: bun add @stacksjs/dnsx

      - name: Verify A records
        run: |
          EXPECTED_IP="93.184.216.34"
          ACTUAL_IP=$(bunx dnsx example.com -t A -1 -J | jq -r '.answers[0].data')

          if [ "$ACTUAL_IP" != "$EXPECTED_IP" ]; then
            echo "DNS mismatch! Expected $EXPECTED_IP, got $ACTUAL_IP"
            exit 1
          fi

          echo "DNS verified: $ACTUAL_IP"

      - name: Verify MX records
        run: |
          bunx dnsx example.com -t MX -J | jq '.answers'
```

### DNS Migration Validation

```yaml
name: DNS Migration Check

on:
  workflow_dispatch:
    inputs:
      domain:
        description: 'Domain to check'
        required: true
      expected_ip:
        description: 'Expected IP address'
        required: true

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: oven-sh/setup-bun@v1

      - name: Install dnsx
        run: bun add -g @stacksjs/dnsx

      - name: Check propagation
        run: |
          RESOLVERS=("1.1.1.1" "8.8.8.8" "9.9.9.9")

          for resolver in "${RESOLVERS[@]}"; do
            echo "Checking $resolver..."
            IP=$(dnsx ${{ inputs.domain }} -t A @$resolver -1 -J | jq -r '.answers[0].data')

            if [ "$IP" == "${{ inputs.expected_ip }}" ]; then
              echo "  OK: $IP"
            else
              echo "  MISMATCH: expected ${{ inputs.expected_ip }}, got $IP"
            fi
          done
```

## GitLab CI

### Basic Check

```yaml
# .gitlab-ci.yml
dns-check:
  image: oven/bun:latest
  stage: test
  script:
    - bun add -g @stacksjs/dnsx
    - dnsx $DOMAIN -t A -J
  variables:
    DOMAIN: example.com
```

### Scheduled Monitoring

```yaml
dns-monitoring:
  image: oven/bun:latest
  stage: monitor
  only:
    - schedules
  script:
    - bun add -g @stacksjs/dnsx
    - |
      DOMAINS="example.com api.example.com cdn.example.com"
      for domain in $DOMAINS; do
        echo "Checking $domain..."
        dnsx $domain -t A -t AAAA -J
      done
```

## CircleCI

```yaml
# .circleci/config.yml
version: 2.1

jobs:
  dns-check:
    docker:
      - image: oven/bun:latest
    steps:
      - checkout
      - run:
          name: Install dnsx
          command: bun add -g @stacksjs/dnsx
      - run:
          name: Check DNS
          command: dnsx example.com -t A -J

workflows:
  dns-monitoring:
    triggers:
      - schedule:
          cron: "0 0 * * *"
          filters:
            branches:
              only: main
    jobs:
      - dns-check
```

## Jenkins

```groovy
// Jenkinsfile
pipeline {
    agent {
        docker {
            image 'oven/bun:latest'
        }
    }

    stages {
        stage('Setup') {
            steps {
                sh 'bun add -g @stacksjs/dnsx'
            }
        }

        stage('DNS Check') {
            steps {
                script {
                    def result = sh(
                        script: 'dnsx example.com -t A -J',
                        returnStdout: true
                    )
                    def json = readJSON text: result
                    def ip = json.answers[0].data
                    echo "Resolved IP: ${ip}"
                }
            }
        }
    }
}
```

## Programmatic Integration

### Node.js Test Suite

```typescript
// dns.test.ts
import { describe, it, expect } from 'bun:test'
import { DnsClient } from '@stacksjs/dnsx'

describe('DNS Configuration', () => {
  it('should resolve A record correctly', async () => {
    const client = new DnsClient({
      domains: ['example.com'],
      type: 'A',
    })

    const responses = await client.query()
    const ips = responses.flatMap(r => r.answers.map(a => a.data))

    expect(ips).toContain('93.184.216.34')
  })

  it('should have MX records', async () => {
    const client = new DnsClient({
      domains: ['example.com'],
      type: 'MX',
    })

    const responses = await client.query()
    expect(responses[0].answers.length).toBeGreaterThan(0)
  })

  it('should have SPF record', async () => {
    const client = new DnsClient({
      domains: ['example.com'],
      type: 'TXT',
    })

    const responses = await client.query()
    const txtRecords = responses.flatMap(r =>
      r.answers.map(a => a.data)
    )

    const hasSpf = txtRecords.some(txt =>
      txt.startsWith('v=spf1')
    )

    expect(hasSpf).toBe(true)
  })
})
```

### Health Check Script

```typescript
// scripts/dns-health.ts
import { DnsClient } from '@stacksjs/dnsx'

interface HealthCheck {
  domain: string
  type: string
  expected?: string
}

const checks: HealthCheck[] = [
  { domain: 'example.com', type: 'A', expected: '93.184.216.34' },
  { domain: 'example.com', type: 'MX' },
  { domain: 'example.com', type: 'TXT' },
]

async function runHealthChecks() {
  let allPassed = true

  for (const check of checks) {
    const client = new DnsClient({
      domains: [check.domain],
      type: check.type,
      timeout: 5000,
    })

    try {
      const responses = await client.query()
      const answers = responses.flatMap(r => r.answers)

      if (answers.length === 0) {
        console.error(`FAIL: ${check.domain} ${check.type} - No records`)
        allPassed = false
        continue
      }

      if (check.expected) {
        const found = answers.some(a => a.data === check.expected)
        if (!found) {
          console.error(`FAIL: ${check.domain} ${check.type} - Expected ${check.expected}`)
          allPassed = false
          continue
        }
      }

      console.log(`PASS: ${check.domain} ${check.type}`)
    }
    catch (error) {
      console.error(`FAIL: ${check.domain} ${check.type} - ${error.message}`)
      allPassed = false
    }
  }

  process.exit(allPassed ? 0 : 1)
}

runHealthChecks()
```

## Docker Integration

### Dockerfile

```dockerfile
FROM oven/bun:latest

RUN bun add -g @stacksjs/dnsx

ENTRYPOINT ["dnsx"]
```

### Usage

```bash
# Build
docker build -t dnsx .

# Run
docker run dnsx example.com -t A -J
```

## Kubernetes CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: dns-monitor
spec:
  schedule: "*/30 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: dnsx
              image: oven/bun:latest
              command:
                - /bin/sh
                - -c
                - |
                  bun add -g @stacksjs/dnsx
                  dnsx example.com -t A -J
          restartPolicy: OnFailure
```

## Monitoring Integration

### Prometheus Metrics

```typescript
import { DnsClient } from '@stacksjs/dnsx'
import { Counter, Histogram, register } from 'prom-client'

const dnsQueryDuration = new Histogram({
  name: 'dns_query_duration_seconds',
  help: 'DNS query duration',
  labelNames: ['domain', 'type', 'status'],
})

const dnsQueryErrors = new Counter({
  name: 'dns_query_errors_total',
  help: 'DNS query errors',
  labelNames: ['domain', 'type'],
})

async function monitoredQuery(domain: string, type: string) {
  const timer = dnsQueryDuration.startTimer({ domain, type })

  try {
    const client = new DnsClient({ domains: [domain], type })
    await client.query()
    timer({ status: 'success' })
  }
  catch {
    timer({ status: 'error' })
    dnsQueryErrors.inc({ domain, type })
  }
}
```

## Next Steps

- [Configuration](/advanced/configuration) - Configure for your environment
- [Performance](/advanced/performance) - Optimize query performance
- [Custom Resolvers](/advanced/custom-resolvers) - Set up resolvers
