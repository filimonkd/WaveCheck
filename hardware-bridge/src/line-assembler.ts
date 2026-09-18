/**
 * Turns a stream of serial chunks into clean, whole credential lines.
 *
 * A reader does not hand you tidy messages. A single UID can arrive split
 * across several `data` events, two taps can arrive in one event, and an
 * unpowered or mis-wired reader emits pure line noise. This class is the one
 * place that deals with all of it, and it is pure so it can be tested without
 * any hardware attached.
 */

export type LineAssemblerOptions = {
  /** Discard the working buffer once it passes this, in characters. */
  maxLineLength?: number;
  /** Ignore anything shorter than this once cleaned. */
  minTokenLength?: number;
};

const DEFAULT_MAX_LINE_LENGTH = 512;
const DEFAULT_MIN_TOKEN_LENGTH = 4;

/** Keep printable ASCII: drops CR, NUL padding and control-character noise. */
function clean(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[^\x20-\x7E]/g, "").trim();
}

export class LineAssembler {
  private buffer = "";

  private readonly maxLineLength: number;
  private readonly minTokenLength: number;

  /** Counters for the caller to surface; the assembler itself never logs. */
  readonly stats = { overflows: 0, discarded: 0 };

  constructor(options: LineAssemblerOptions = {}) {
    this.maxLineLength = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
    this.minTokenLength = options.minTokenLength ?? DEFAULT_MIN_TOKEN_LENGTH;
  }

  /** Feed one chunk; returns every complete, plausible token it completed. */
  push(chunk: Buffer | string): string[] {
    this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");

    const tokens: string[] = [];

    // Split on \n and let `clean` strip the \r of a \r\n pair.
    for (;;) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex === -1) break;

      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      const token = clean(line);

      if (token.length >= this.minTokenLength) {
        tokens.push(token);
      } else if (token.length > 0) {
        // Short fragments are noise, not credentials.
        this.stats.discarded += 1;
      }
    }

    // A reader that never sends a delimiter must not grow this without bound.
    // The partial data is unusable, so drop it rather than splice garbage onto
    // whatever arrives next.
    if (this.buffer.length > this.maxLineLength) {
      this.buffer = "";
      this.stats.overflows += 1;
    }

    return tokens;
  }

  /** Characters held while waiting for a delimiter. Exposed for diagnostics. */
  get pending(): number {
    return this.buffer.length;
  }
}
