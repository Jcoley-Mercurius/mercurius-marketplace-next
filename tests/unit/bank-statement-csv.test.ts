import { describe, expect, it } from "vitest";

import {
  fileFingerprint,
  guessMapping,
  mappingError,
  parseAmount,
  parseCsv,
  parseDate,
  periodDays,
  periodError,
  readRows,
  type ColumnMapping,
} from "../../src/lib/bankStatementCsv";

// TRACE-081: the bank CSV is read in the browser. Only date, direction, cents and reference leave it.

describe("bank statement CSV", () => {
  it("reads quoted fields, escaped quotes, CRLF and a byte order mark, and drops blank rows", () => {
    const rows = parseCsv('﻿Date,Description,Amount\r\n09/15/2026,"ACH PAYEE, ""SYNTHETIC""",-95.00\r\n\r\n09/16/2026,Deposit,12\n');
    expect(rows).toEqual([
      ["Date", "Description", "Amount"],
      ["09/15/2026", 'ACH PAYEE, "SYNTHETIC"', "-95.00"],
      ["09/16/2026", "Deposit", "12"],
    ]);
  });

  it("reads money as signed integer cents and refuses anything else", () => {
    expect(parseAmount("$1,234.56")).toBe(123456);
    expect(parseAmount("-95.00")).toBe(-9500);
    expect(parseAmount("(95.5)")).toBe(-9550);
    expect(parseAmount("+12")).toBe(1200);
    expect(parseAmount("USD 7.05")).toBe(705);
    expect(parseAmount("0.1")).toBe(10);
    expect(parseAmount("1.234")).toBeNull();
    expect(parseAmount("12,34")).toBeNull();
    expect(parseAmount("1e3")).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("ninety")).toBeNull();
  });

  it("reads real calendar dates only", () => {
    expect(parseDate("2026-09-15")).toBe("2026-09-15");
    expect(parseDate("9/5/2026")).toBe("2026-09-05");
    expect(parseDate("09-05-26")).toBe("2026-09-05");
    expect(parseDate("02/29/2028")).toBe("2028-02-29");
    expect(parseDate("02/30/2026")).toBeNull();
    expect(parseDate("2026-13-01")).toBeNull();
    expect(parseDate("15/09/2026")).toBeNull();
    expect(parseDate("Sep 15")).toBeNull();
  });

  it("guesses the three shapes banks export", () => {
    expect(guessMapping(["Posting Date", "Description", "Amount", "Trace Number"])).toMatchObject({ date: 0, reference: 3, mode: "signed", amount: 2 });
    expect(guessMapping(["Date", "Reference", "Description", "Debit", "Credit"])).toMatchObject({ date: 0, reference: 1, mode: "split", debit: 3, credit: 4 });
    expect(guessMapping(["Transaction Date", "Transaction ID", "Amount", "Type"])).toMatchObject({ date: 0, reference: 1, mode: "typed", amount: 2, type: 3 });
  });

  it("names the missing column before reading rows", () => {
    const base: ColumnMapping = { date: 0, reference: 1, mode: "signed", amount: 2, debit: null, credit: null, type: null };
    expect(mappingError(base)).toBeNull();
    expect(mappingError({ ...base, date: null })).toBe("Choose the date column.");
    expect(mappingError({ ...base, reference: null })).toBe("Choose the reference column.");
    expect(mappingError({ ...base, amount: null })).toBe("Choose the amount column.");
    expect(mappingError({ ...base, mode: "split" })).toBe("Choose both the debit and the credit column.");
    expect(mappingError({ ...base, mode: "typed" })).toBe("Choose the debit/credit type column.");
  });

  it("turns a signed amount into a direction, and keeps descriptions out of the line", () => {
    const rows = parseCsv("Date,Reference,Description,Amount\n09/15/2026,091000010000001,ACH SYNTHETIC PAYEE ACCT 000123456789,-95.00\n09/16/2026,RET-1,ACH RETURN,95.00\n");
    const read = readRows(rows, guessMapping(rows[0]), true);
    expect(read.map((row) => row.line)).toEqual([
      { posted_on: "2026-09-15", direction: "debit", amount: 9500, reference: "091000010000001" },
      { posted_on: "2026-09-16", direction: "credit", amount: 9500, reference: "RET-1" },
    ]);
    expect(JSON.stringify(read.map((row) => row.line))).not.toContain("000123456789");
    expect(read[0].row).toBe(2);
  });

  it("reads separate debit and credit columns and a typed amount", () => {
    const split = parseCsv("Date,Reference,Debit,Credit\n2026-09-15,T1,95.00,\n2026-09-15,T2,,5.00\n2026-09-15,T3,1.00,2.00\n2026-09-15,T4,,\n");
    expect(readRows(split, guessMapping(split[0]), true).map((row) => row.line?.direction ?? row.error)).toEqual([
      "debit", "credit", "The row has both a debit and a credit.", "The row has no amount.",
    ]);
    const typed = parseCsv("Date,Transaction ID,Amount,Type\n2026-09-15,T1,95.00,DR\n2026-09-15,T2,5.00,Credit\n2026-09-15,T3,5.00,Memo\n");
    expect(readRows(typed, guessMapping(typed[0]), true).map((row) => row.line?.direction ?? row.error)).toEqual([
      "debit", "credit", "The debit/credit type could not be read.",
    ]);
  });

  it("marks rows that cannot become a line instead of guessing", () => {
    const rows = parseCsv(`Date,Reference,Amount\nnot a date,T1,-1\n2026-09-15,,-1\n2026-09-15,T3,0\n2026-09-15,T4,abc\n2026-09-15,${"R".repeat(201)},-1\n`);
    expect(readRows(rows, guessMapping(rows[0]), true).map((row) => row.error)).toEqual([
      "The date could not be read.",
      "The row has no bank reference.",
      "The amount is zero.",
      "The amount could not be read.",
      "The bank reference is longer than 200 characters.",
    ]);
  });

  it("reads a file without a header from its first row", () => {
    const rows = parseCsv("2026-09-15,T1,-95.00\n");
    const read = readRows(rows, { date: 0, reference: 1, mode: "signed", amount: 2, debit: null, credit: null, type: null }, false);
    expect(read).toHaveLength(1);
    expect(read[0].row).toBe(1);
    expect(read[0].line?.amount).toBe(9500);
  });

  it("checks lines against the statement period and bounds the period", () => {
    const line = { posted_on: "2026-09-15", direction: "debit" as const, amount: 1, reference: "T" };
    expect(periodError(line, "2026-09-01", "2026-09-30")).toBeNull();
    expect(periodError(line, "2026-09-16", "2026-09-30")).toBe("Dated outside the statement period.");
    expect(periodDays("2026-09-01", "2026-09-30")).toBe(30);
    expect(periodDays("2026-09-01", "2026-09-01")).toBe(1);
    expect(periodDays("2026-09-30", "2026-09-01")).toBeNull();
    expect(periodDays("", "2026-09-01")).toBeNull();
  });

  it("fingerprints the file bytes with SHA-256", async () => {
    expect(await fileFingerprint(new TextEncoder().encode("abc").buffer as ArrayBuffer)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
