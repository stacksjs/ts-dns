import type { CLI } from "@stacksjs/clapp";
import type { DnsOptions } from "../src/types";
import process from "node:process";
import { Logger } from "@stacksjs/clarity";
import { cli } from "@stacksjs/clapp";
import pc from "picocolors";
import { version } from "../package.json";
import { DnsClient } from "../src/client";
import { formatOutput } from "../src/output";
import { parseProtocolTweaks } from "../src/utils";

interface Colors {
  error: (str: string) => string;
  warning: (str: string) => string;
  success: (str: string) => string;
  info: (str: string) => string;
  dim: (str: string) => string;
}

// Color helper
export const colors: Colors = {
  error: (str: string) => pc.red(str),
  warning: (str: string) => pc.yellow(str),
  success: (str: string) => pc.green(str),
  info: (str: string) => pc.blue(str),
  dim: (str: string) => pc.dim(str),
};

export interface CliOptions extends DnsOptions {
  json?: boolean;
  short?: boolean;
  color?: "always" | "auto" | "never";
  seconds?: boolean;
  time?: boolean;
  Z?: string | string[];
}

const app: CLI = cli("dnsx");
const logger = new Logger("dnsx:cli");

app
  .command("[...args]", "Perform DNS lookup for specified domains")
  .option("-q, --query <HOST>", "Host name or domain name to query")
  .option(
    "-t, --type <TYPE>",
    "Type of the DNS record being queried (A, MX, NS...)",
  )
  .option(
    "-n, --nameserver <ADDR>",
    "Address of the nameserver to send packets to",
  )
  .option("--class <CLASS>", "Network class of DNS record (IN, CH, HS)")
  .option("--edns <SETTING>", "Whether to OPT in to EDNS (disable, hide, show)")
  .option("--txid <NUMBER>", "Set transaction ID to specific value")
  .option("-Z <TWEAKS>", "Set uncommon protocol tweaks")
  .option("-U, --udp", "Use DNS over UDP", { default: false })
  .option("-T, --tcp", "Use DNS over TCP", { default: false })
  .option("-S, --tls", "Use DNS-over-TLS", { default: false })
  .option("-H, --https", "Use DNS-over-HTTPS", { default: false })
  .option("-1, --short", "Display nothing but first result", { default: false })
  .option("-J, --json", "Display output as JSON", { default: false })
  .option("--color <WHEN>", "When to colorize output (always, auto, never)")
  .option("--seconds", "Display durations in seconds", { default: false })
  .option("--time", "Print response time", { default: false })
  .option("--verbose", "Print additional debugging information", {
    default: false,
  })
  .example("dnsx example.com")
  .example("dnsx example.com MX")
  .example("dnsx example.com A AAAA NS MX")
  .example("dnsx example.com -t MX -n 1.1.1.1 -T")
  .action(async (args: string[], options: CliOptions) => {
    try {
      // Separate domains and record types from arguments
      const validRecordTypes = new Set([
        "A",
        "AAAA",
        "NS",
        "MX",
        "TXT",
        "SRV",
        "PTR",
        "CNAME",
        "SOA",
        "CAA",
      ]);
      const domains: string[] = [];
      const types: string[] = [];

      // First argument is always a domain
      if (args.length > 0) {
        domains.push(args[0]);
      }

      // Remaining arguments could be record types
      for (let i = 1; i < args.length; i++) {
        const arg = args[i].toUpperCase();
        if (validRecordTypes.has(arg)) {
          types.push(arg);
        } else {
          domains.push(arg);
        }
      }

      // Add any domains from --query option
      if (options.query) {
        domains.push(
          ...(Array.isArray(options.query) ? options.query : [options.query]),
        );
      }

      // Add any types from -t/--type option
      if (options.type) {
        types.push(
          ...(Array.isArray(options.type) ? options.type : [options.type]),
        );
      }

      // Check if we have any domains to query
      if (domains.length === 0) {
        logger.error(colors.error("Error: No domains specified"));
        process.exit(1);
      }

      // Create client with parsed options
      const client = new DnsClient({
        domains,
        nameserver: options.nameserver,
        type: types.length > 0 ? types : undefined, // Only set if we have types
        class: options.class,
        udp: options.udp,
        tcp: options.tcp,
        tls: options.tls,
        https: options.https,
        edns: options.edns,
        txid: options.txid,
        tweaks: parseProtocolTweaks(options.Z),
        verbose: options.verbose,
      });

      const startTime = Date.now();
      const responses = await client.query();
      const duration = Date.now() - startTime;

      const output = formatOutput(responses, {
        json: Boolean(options.json),
        short: Boolean(options.short),
        showDuration: options.time ? duration : undefined,
        colors: {
          enabled:
            options.color === "always" ||
            (options.color !== "never" && process.stdout.isTTY),
        },
        rawSeconds: Boolean(options.seconds),
      });

      await logger.info(output);

      // Exit with error if no responses
      if (responses.length === 0) {
        process.exit(1);
      }
    } catch (err: any) {
      await logger.error(colors.error(`Error: ${err.message}`));
      if (options.verbose && err.stack) {
        await logger.debug(
          colors.dim(
            `Stack trace:\n${err.stack
              .split("\n")
              .map((line: string) => `  ${line}`)
              .join("\n")}`,
          ),
        );
      }
      process.exit(1);
    }
  });

app.command("version", "Show the version of dtsx").action(async () => {
  await logger.info(version);
});

app.help();
app.version(version);
app.parse();

// Handle errors
app.on("error", async (err) => {
  await logger.error(colors.error(`Error: ${err.message}`));
  process.exit(1);
});
