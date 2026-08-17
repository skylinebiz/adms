import { Prisma } from "@prisma/client";

// Three-way classification for a DB error hit while trying to store
// something a device sent, driving one policy decision: should we ack `OK`
// (the device clears its buffer and moves on) or withhold the ack (the
// device retries the identical payload)?
//
//   - "connection": Postgres unreachable, pool exhausted, connection
//     dropped mid-query - transient, likely to succeed on retry. Withhold
//     the ack.
//   - "data": the payload itself is unstorable as-is (e.g. a value too
//     long for its column, or a raw encoding error like a NUL byte
//     Postgres refuses in a text column) - retrying the identical payload
//     will fail identically forever. Ack `OK` so the device doesn't wedge
//     on it permanently, and log loudly so it's not silently lost.
//   - "unknown": anything not confidently identified as one of the above.
//     Defaults to the same treatment as "connection" (withhold the ack) -
//     a device that retries a few extra times is a much smaller cost than
//     silently discarding data that might have been perfectly storable.
export type DbErrorKind = "connection" | "data" | "unknown";

// P1xxx codes below live on PrismaClientInitializationError.errorCode, not
// on PrismaClientKnownRequestError.code - handled as a separate branch.
const CONNECTION_ERROR_CODES = new Set([
  "P1001", // can't reach database server
  "P1002", // database server reached but timed out
  "P1008", // operation timed out
  "P1017", // server closed the connection
  "P2024", // timed out fetching a connection from the pool
]);

// Known, deterministic-per-record data problems - retrying won't help.
const DATA_ERROR_CODES = new Set([
  "P2000", // value too long for the column
  "P2001",
  "P2003", // foreign key constraint failed
  "P2004",
  "P2005",
  "P2006", // invalid value provided for a field
  "P2007", // data validation error
  "P2011", // null constraint violation
  "P2012",
  "P2019", // input error
  "P2020", // value out of range for the column type
  "P2033", // number too large to fit a 64-bit integer
]);

// Postgres error messages for encoding-level problems (e.g. a NUL byte
// embedded in an ATTLOG line) that surface as PrismaClientUnknownRequestError
// rather than a known Prisma error code, so they need a message match.
const DATA_ERROR_MESSAGE_PATTERN = /invalid byte sequence|character.*not in repertoire|invalid input syntax/i;

export function classifyDbError(err: unknown): DbErrorKind {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (CONNECTION_ERROR_CODES.has(err.code)) return "connection";
    if (DATA_ERROR_CODES.has(err.code)) return "data";
    return "unknown";
  }
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return "connection";
  }
  if (err instanceof Prisma.PrismaClientRustPanicError) {
    return "unknown";
  }
  const message = err instanceof Error ? err.message : String(err);
  if (DATA_ERROR_MESSAGE_PATTERN.test(message)) {
    return "data";
  }
  return "unknown";
}
