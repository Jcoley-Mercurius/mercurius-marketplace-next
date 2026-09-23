// TRACE-081 bank statement import, in the operator's browser. The bank's CSV export is read here and
// never uploaded: only each chosen line's posting date, direction, amount in cents and bank reference
// are sent (owner decision 2026-09-22). Descriptions, payee names and account details stay on screen.

export type StatementLineInput = {
  posted_on: string;
  direction: "debit" | "credit";
  amount: number;
  reference: string;
};

/**
 * How the bank's columns map to a line. Banks export money out in one of three shapes:
 * a signed amount (negative is money out), separate debit and credit columns, or an amount with a
 * debit/credit type column.
 */
export type ColumnMapping = {
  date: number | null;
  reference: number | null;
  mode: "signed" | "split" | "typed";
  amount: number | null;
  debit: number | null;
  credit: number | null;
  type: number | null;
};

export type ParsedRow = {
  /** 1-based row in the file, counting the header. */
  row: number;
  cells: string[];
  line: StatementLineInput | null;
  error: string | null;
};

/** RFC 4180 CSV: commas, double-quoted fields with "" escapes, CRLF or LF. Blank rows are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim().length > 0));
}

/**
 * A money amount as the bank writes it, to signed integer cents: "$1,234.56", "-12.30",
 * "(12.30)" and "12.3" are read; anything else is null.
 */
export function parseAmount(text: string): number | null {
  let value = text.trim();
  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1).trim();
  }
  if (value.startsWith("-")) {
    negative = !negative;
    value = value.slice(1).trim();
  } else if (value.startsWith("+")) {
    value = value.slice(1).trim();
  }
  value = value.replace(/^\$/, "").replace(/^USD\s*/i, "");
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.replaceAll(",", "").split(".");
  if (whole.length > 13) return null;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return negative ? -cents : cents;
}

/** A posting date as YYYY-MM-DD, from YYYY-MM-DD, MM/DD/YYYY, M/D/YY or MM-DD-YYYY. Null if not a real day. */
export function parseDate(text: string): string | null {
  const value = text.trim();
  let year: number, month: number, day: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (match) {
    [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(value);
    if (!match) return null;
    [month, day, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (match[3].length === 2) year += 2000;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

const find = (header: string[], pattern: RegExp, taken: (number | null)[] = []) => {
  const index = header.findIndex((cell, position) => pattern.test(cell.trim()) && !taken.includes(position));
  return index < 0 ? null : index;
};

/** A first guess at the mapping from the header row. The operator confirms or changes it. */
export function guessMapping(header: string[]): ColumnMapping {
  const date = find(header, /^(posting |posted |transaction |effective )?date$|^date posted$/i) ?? find(header, /date/i);
  const reference = find(header, /trace|reference|ref\b|ref\.|transaction id|confirmation|check ?(number|no)/i, [date]);
  const debit = find(header, /^(debit|withdrawal)s?( amount)?$/i, [date, reference]);
  const credit = find(header, /^(credit|deposit)s?( amount)?$/i, [date, reference, debit]);
  const amount = find(header, /^amount$|^transaction amount$/i, [date, reference, debit, credit]);
  const type = find(header, /^(type|transaction type|dr\/cr|debit\/credit|credit\/debit)$/i, [date, reference, debit, credit, amount]);
  const mode = debit !== null && credit !== null ? "split" : amount !== null && type !== null ? "typed" : "signed";
  return { date, reference, mode, amount, debit, credit, type };
}

const cell = (cells: string[], index: number | null) => (index === null ? "" : (cells[index] ?? "").trim());

/** Why a mapping cannot read lines yet, or null. */
export function mappingError(mapping: ColumnMapping): string | null {
  if (mapping.date === null) return "Choose the date column.";
  if (mapping.reference === null) return "Choose the reference column.";
  if (mapping.mode === "split") {
    if (mapping.debit === null || mapping.credit === null) return "Choose both the debit and the credit column.";
  } else if (mapping.amount === null) {
    return "Choose the amount column.";
  }
  if (mapping.mode === "typed" && mapping.type === null) return "Choose the debit/credit type column.";
  return null;
}

function direction(cells: string[], mapping: ColumnMapping): { direction: "debit" | "credit"; amount: number } | string {
  if (mapping.mode === "split") {
    const debitText = cell(cells, mapping.debit);
    const creditText = cell(cells, mapping.credit);
    const debit = debitText ? parseAmount(debitText) : null;
    const credit = creditText ? parseAmount(creditText) : null;
    if (debitText && debit === null) return "The debit amount could not be read.";
    if (creditText && credit === null) return "The credit amount could not be read.";
    const out = debit ? Math.abs(debit) : 0;
    const into = credit ? Math.abs(credit) : 0;
    if (out > 0 && into > 0) return "The row has both a debit and a credit.";
    if (out > 0) return { direction: "debit", amount: out };
    if (into > 0) return { direction: "credit", amount: into };
    return "The row has no amount.";
  }
  const text = cell(cells, mapping.amount);
  const value = parseAmount(text);
  if (value === null) return "The amount could not be read.";
  if (value === 0) return "The amount is zero.";
  if (mapping.mode === "signed") return { direction: value < 0 ? "debit" : "credit", amount: Math.abs(value) };
  const type = cell(cells, mapping.type).toLowerCase();
  if (/^(d|dr|debit|withdrawal)/.test(type)) return { direction: "debit", amount: Math.abs(value) };
  if (/^(c|cr|credit|deposit)/.test(type)) return { direction: "credit", amount: Math.abs(value) };
  return "The debit/credit type could not be read.";
}

/** Each data row read with the mapping. Rows are 1-based and count the header when there is one. */
export function readRows(rows: string[][], mapping: ColumnMapping, hasHeader: boolean): ParsedRow[] {
  const problem = mappingError(mapping);
  return rows.slice(hasHeader ? 1 : 0).map((cells, index) => {
    const row = index + (hasHeader ? 2 : 1);
    if (problem) return { row, cells, line: null, error: problem };
    const posted = parseDate(cell(cells, mapping.date));
    if (!posted) return { row, cells, line: null, error: "The date could not be read." };
    const reference = cell(cells, mapping.reference);
    if (!reference) return { row, cells, line: null, error: "The row has no bank reference." };
    if (reference.length > 200) return { row, cells, line: null, error: "The bank reference is longer than 200 characters." };
    const money = direction(cells, mapping);
    if (typeof money === "string") return { row, cells, line: null, error: money };
    return { row, cells, line: { posted_on: posted, direction: money.direction, amount: money.amount, reference }, error: null };
  });
}

/** Why a read line cannot go on a statement for this period, or null. */
export function periodError(line: StatementLineInput, start: string, end: string): string | null {
  return line.posted_on < start || line.posted_on > end ? "Dated outside the statement period." : null;
}

/** The inclusive number of days in a period, or null when either date is missing or reversed. */
export function periodDays(start: string, end: string): number | null {
  if (!parseDate(start) || !parseDate(end) || end < start) return null;
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

/** SHA-256 of the file's bytes, hex. The file itself is never sent. */
export async function fileFingerprint(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
