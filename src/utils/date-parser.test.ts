import { describe, it, expect } from "vitest";
import { parseDate } from "./date-parser";

describe("parseDate", () => {
  it("parses DD/MM unambiguous — day 10 can't be month > 12 scenario", () => {
    // 10/02/2026: DD=10, MM=02 → 2026-02-10 (only DD/MM works since 10 as month with 02 as day also works, but DD/MM preferred and plausible)
    expect(parseDate("10/02/2026")).toBe("2026-02-10");
  });

  it("falls back to MM/DD when DD/MM produces implausible future date", () => {
    // 2/12/2026: DD/MM → 2 Dec 2026 (future, implausible at time of writing March 2026)
    // MM/DD → 12 Feb 2026 (plausible)
    expect(parseDate("2/12/2026")).toBe("2026-02-12");
  });

  it("stays DD/MM when ambiguous but both plausible", () => {
    // 04/03/2026: DD/MM → 4 Mar 2026 (plausible), MM/DD → 3 Apr 2026 (also plausible)
    // AU default: DD/MM wins
    expect(parseDate("04/03/2026")).toBe("2026-03-04");
  });

  it("parses ISO format", () => {
    expect(parseDate("2026-03-04")).toBe("2026-03-04");
  });

  it("parses named month format", () => {
    expect(parseDate("10 Feb 2026")).toBe("2026-02-10");
  });

  it("returns null for invalid input", () => {
    expect(parseDate("invalid")).toBeNull();
  });

  it("returns valid date for far-future unambiguous dates", () => {
    // 01/01/2099 is technically valid — plausibility only affects DD/MM vs MM/DD choice
    expect(parseDate("01/01/2099")).toBe("2099-01-01");
  });

  it("returns null for pre-2020 dates", () => {
    expect(parseDate("01/01/2019")).toBeNull();
  });

  it("parses DD.MM.YYYY (Amazon AU)", () => {
    expect(parseDate("28.02.2026")).toBe("2026-02-28");
  });

  it("parses MMM DD, YYYY", () => {
    expect(parseDate("Feb 10, 2026")).toBe("2026-02-10");
  });

  it("returns null for empty/null", () => {
    expect(parseDate("")).toBeNull();
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
  });

  it("parses DD-MM-YYYY", () => {
    expect(parseDate("15-03-2026")).toBe("2026-03-15");
  });

  it("returns null for invalid month 13", () => {
    expect(parseDate("31/13/2025")).toBeNull();
  });
});
