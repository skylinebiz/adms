import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { classifyDbError } from "../src/adms/dbErrors";

function knownRequestError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("simulated", { code, clientVersion: "test" });
}

describe("classifyDbError", () => {
  it("classifies connection-error codes as connection", () => {
    expect(classifyDbError(knownRequestError("P1001"))).toBe("connection");
    expect(classifyDbError(knownRequestError("P1002"))).toBe("connection");
    expect(classifyDbError(knownRequestError("P1008"))).toBe("connection");
    expect(classifyDbError(knownRequestError("P1017"))).toBe("connection");
    expect(classifyDbError(knownRequestError("P2024"))).toBe("connection");
  });

  it("classifies known data-error codes as data", () => {
    expect(classifyDbError(knownRequestError("P2000"))).toBe("data");
    expect(classifyDbError(knownRequestError("P2003"))).toBe("data");
    expect(classifyDbError(knownRequestError("P2011"))).toBe("data");
    expect(classifyDbError(knownRequestError("P2020"))).toBe("data");
  });

  it("classifies an unrecognized known-request code as unknown", () => {
    expect(classifyDbError(knownRequestError("P9999"))).toBe("unknown");
  });

  it("classifies PrismaClientInitializationError as connection (DB unreachable)", () => {
    const err = new Prisma.PrismaClientInitializationError("can't reach database server", "test");
    expect(classifyDbError(err)).toBe("connection");
  });

  it("classifies PrismaClientRustPanicError as unknown", () => {
    const err = new Prisma.PrismaClientRustPanicError("simulated panic", "test");
    expect(classifyDbError(err)).toBe("unknown");
  });

  it("sniffs an encoding-error message on an otherwise unclassified error as data", () => {
    expect(classifyDbError(new Error("invalid byte sequence for encoding \"UTF8\": 0x00"))).toBe("data");
    expect(classifyDbError(new Error("invalid input syntax for type timestamp"))).toBe("data");
  });

  it("defaults a plain unrecognized error to unknown (withhold-ack policy)", () => {
    expect(classifyDbError(new Error("something completely unexpected"))).toBe("unknown");
    expect(classifyDbError("not even an Error instance")).toBe("unknown");
  });
});
