import "dotenv/config";

import { SerialPort } from "serialport";

import { LineAssembler } from "./line-assembler.js";

// --- configuration ---------------------------------------------------------

type Config = {
  apiBaseUrl: string;
  deviceIdentifier: string;
  deviceApiKey: string;
  serialPath: string;
  baudRate: number;
};

function loadConfig(): Config {
  const missing: string[] = [];

  const required = (name: string): string => {
    const value = process.env[name]?.trim();
    if (!value) missing.push(name);
    return value ?? "";
  };

  const config: Config = {
    apiBaseUrl: required("API_BASE_URL").replace(/\/+$/, ""),
    deviceIdentifier: required("DEVICE_IDENTIFIER"),
    deviceApiKey: required("DEVICE_API_KEY"),
    serialPath: required("SERIAL_PORT"),
    baudRate: Number(process.env.SERIAL_BAUD_RATE ?? 9600),
  };

  if (missing.length > 0) {
    console.error(
      `Missing required environment variables: ${missing.join(", ")}\n` +
        "Copy .env.example to .env and fill it in.",
    );
    process.exit(1);
  }

  if (!Number.isFinite(config.baudRate) || config.baudRate <= 0) {
    console.error(`SERIAL_BAUD_RATE must be a positive number.`);
    process.exit(1);
  }

  return config;
}

// --- console output --------------------------------------------------------

// Colour only a real terminal; a log file or systemd journal wants plain text.
const useColour = process.stdout.isTTY === true;
const paint = (code: string, text: string) =>
  useColour ? `\x1b[${code}m${text}\x1b[0m` : text;

const green = (text: string) => paint("32", text);
const red = (text: string) => paint("31", text);
const yellow = (text: string) => paint("33", text);
const dim = (text: string) => paint("2", text);

function beep() {
  if (useColour) process.stdout.write("\x07");
}

function stamp(): string {
  return dim(new Date().toISOString().slice(11, 19));
}

// --- API -------------------------------------------------------------------

type CheckInResponse = {
  success?: boolean;
  attendeeName?: string;
  message?: string;
  checkedInAt?: string | null;
  error?: string;
};

const NETWORK_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function headers(config: Config): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-device-identifier": config.deviceIdentifier,
    "x-device-api-key": config.deviceApiKey,
  };
}

/**
 * POSTs one scan. Network failures are retried with backoff; an HTTP response
 * of any status is returned, because a 401 is an answer, not an outage.
 */
async function postCheckIn(
  config: Config,
  credentialToken: string,
): Promise<{ status: number; body: CheckInResponse } | { offline: true }> {
  for (let attempt = 1; attempt <= NETWORK_RETRIES; attempt += 1) {
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/hardware/check-in`, {
        method: "POST",
        headers: headers(config),
        body: JSON.stringify({ credentialToken }),
      });

      const body = (await response.json().catch(() => ({}))) as CheckInResponse;
      return { status: response.status, body };
    } catch {
      if (attempt === NETWORK_RETRIES) break;

      console.log(
        `${stamp()} ${yellow(`⚠ API Offline - Retrying... (${attempt}/${NETWORK_RETRIES - 1})`)}`,
      );
      await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }

  return { offline: true };
}

/** One scan, start to finish, including what the operator sees. */
async function handleToken(config: Config, credentialToken: string) {
  const result = await postCheckIn(config, credentialToken);

  if ("offline" in result) {
    console.log(
      `${stamp()} ${red("✖ API OFFLINE")} ${dim(`- could not reach ${config.apiBaseUrl}`)}`,
    );
    return;
  }

  const { status, body } = result;

  if (status === 401) {
    console.log(
      `${stamp()} ${red("✖ DEVICE REJECTED")} ${dim("- check DEVICE_IDENTIFIER and DEVICE_API_KEY")}`,
    );
    return;
  }

  if (status >= 400) {
    console.log(
      `${stamp()} ${red("✖ REQUEST REJECTED")} ${dim(body.error ?? `HTTP ${status}`)}`,
    );
    return;
  }

  if (body.success) {
    beep();
    console.log(`${stamp()} ${green(`✅ CHECKED IN: ${body.attendeeName || "guest"}`)}`);
    return;
  }

  // A business refusal: already checked in, unknown badge, cancelled booking.
  const detail = body.checkedInAt
    ? ` at ${new Date(body.checkedInAt).toISOString().slice(11, 16)}`
    : "";
  const label = (body.message ?? "DECLINED").toUpperCase();
  const who = body.attendeeName ? dim(` (${body.attendeeName})`) : "";

  console.log(`${stamp()} ${red(`❌ ${label}${detail}`)}${who}`);
}

/** Confirms the credentials before we start waiting on a reader. */
async function verifyCredentials(config: Config): Promise<void> {
  try {
    const response = await fetch(`${config.apiBaseUrl}/api/hardware/heartbeat`, {
      method: "POST",
      headers: headers(config),
      body: "{}",
    });

    if (response.status === 401) {
      console.error(
        red("✖ The API rejected these device credentials.\n") +
          "  Generate a new key under Kiosk Credentials on the organizer dashboard.",
      );
      process.exit(1);
    }

    if (!response.ok) {
      console.log(`${stamp()} ${yellow(`⚠ Heartbeat returned HTTP ${response.status}`)}`);
      return;
    }

    console.log(`${stamp()} ${green("✔ Credentials accepted")}`);
  } catch {
    // The venue network may come up after the kiosk does; not fatal.
    console.log(
      `${stamp()} ${yellow(`⚠ Could not reach ${config.apiBaseUrl} yet - continuing`)}`,
    );
  }
}

// --- scan queue ------------------------------------------------------------

/**
 * A held card makes many readers repeat the same UID several times a second.
 * Ignoring a repeat inside this window keeps one tap from becoming a burst of
 * "already checked in".
 */
const DUPLICATE_WINDOW_MS = 3000;

/** Scans run one at a time so the console reads in the order people tapped. */
class ScanQueue {
  private readonly pending: string[] = [];
  private draining = false;
  private lastToken = "";
  private lastAt = 0;

  constructor(private readonly config: Config) {}

  offer(token: string) {
    const now = Date.now();

    if (token === this.lastToken && now - this.lastAt < DUPLICATE_WINDOW_MS) {
      this.lastAt = now;
      return;
    }

    this.lastToken = token;
    this.lastAt = now;
    this.pending.push(token);
    void this.drain();
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;

    try {
      for (;;) {
        const token = this.pending.shift();
        if (token === undefined) break;

        await handleToken(this.config, token);
      }
    } finally {
      this.draining = false;
    }
  }
}

// --- serial ----------------------------------------------------------------

const RECONNECT_DELAY_MS = 5000;

function listen(config: Config, queue: ScanQueue) {
  const assembler = new LineAssembler();

  const port = new SerialPort({
    path: config.serialPath,
    baudRate: config.baudRate,
    autoOpen: false,
  });

  let reconnecting = false;

  const reconnect = () => {
    if (reconnecting) return;
    reconnecting = true;

    console.log(
      `${stamp()} ${yellow(`⚠ Reader disconnected - retrying in ${RECONNECT_DELAY_MS / 1000}s`)}`,
    );
    setTimeout(() => listen(config, queue), RECONNECT_DELAY_MS);
  };

  port.on("data", (chunk: Buffer) => {
    for (const token of assembler.push(chunk)) {
      console.log(`${stamp()} ${dim(`↳ scanned ${token}`)}`);
      queue.offer(token);
    }
  });

  // A pulled USB cable surfaces as an error, a close, or both.
  port.on("error", (error: Error) => {
    console.log(`${stamp()} ${red(`✖ Serial error: ${error.message}`)}`);
    reconnect();
  });

  port.on("close", reconnect);

  port.open((error) => {
    if (error) {
      console.log(
        `${stamp()} ${red(`✖ Could not open ${config.serialPath}: ${error.message}`)}`,
      );
      reconnect();
      return;
    }

    console.log(
      `${stamp()} ${green(`✔ Listening on ${config.serialPath}`)} ${dim(`@ ${config.baudRate} baud`)}`,
    );
    console.log(dim("   Waiting for badge scans. Ctrl-C to stop."));
  });

  const shutdown = () => {
    console.log(`\n${dim("Closing serial port…")}`);
    port.close(() => process.exit(0));
    // Do not hang if the port refuses to close.
    setTimeout(() => process.exit(0), 1000).unref();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

// --- entry point -----------------------------------------------------------

async function main() {
  const config = loadConfig();

  console.log(dim("WaveCheck hardware bridge"));
  console.log(dim(`  device ${config.deviceIdentifier} → ${config.apiBaseUrl}`));

  await verifyCredentials(config);
  listen(config, new ScanQueue(config));
}

void main();
