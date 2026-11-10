/**
 * Line framing for the CP750 ASCII protocol: replies are split on CR, LF or CRLF, and NUL bytes
 * are stripped (docs/ARCHITECTURE.md, "Device protocol").
 */

// biome-ignore lint/suspicious/noControlCharactersInRegex: the unit pads replies with NULs
const NUL = /\u0000/g;

/**
 * Splits a byte stream into lines. A CR, an LF, or a CRLF ends a line, including a CRLF split
 * across two chunks. NULs are dropped. Lines are returned without their terminator and are not
 * trimmed; an empty string is a blank line.
 */
export class LineSplitter {
  private buffer = "";
  private lastWasCr = false;

  push(chunk: string): string[] {
    const lines: string[] = [];
    for (const char of chunk.replace(NUL, "")) {
      if (char === "\n" && this.lastWasCr) {
        this.lastWasCr = false;
        continue;
      }
      this.lastWasCr = char === "\r";
      if (char === "\r" || char === "\n") {
        lines.push(this.buffer);
        this.buffer = "";
      } else {
        this.buffer += char;
      }
    }
    return lines;
  }

  /** Returns the unterminated tail (if any) and resets. */
  flush(): string | null {
    const rest = this.buffer;
    this.buffer = "";
    this.lastWasCr = false;
    return rest === "" ? null : rest;
  }
}

export interface ReplyLine {
  /** The first token, lowercased, with a trailing `:` removed. */
  key: string;
  /** Everything after the key (and an optional `:` separator), trimmed. */
  value: string;
}

/**
 * Parses `<param> <value>` (and the `<param> : <value>` form `status` uses). Returns `null` for
 * a blank line.
 */
export function parseReplyLine(line: string): ReplyLine | null {
  const text = line.trim();
  if (text === "") return null;
  const match = /^(\S+?):?(?:\s+|$)(.*)$/s.exec(text);
  if (!match) return null;
  const key = (match[1] ?? "").toLowerCase();
  const value = (match[2] ?? "").replace(/^:\s*/, "").trim();
  return { key, value };
}
