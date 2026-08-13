import { describe, expect, it } from "vitest";
import { normalizeKey, pathsMatch, toRepoRelativeKey } from "../../src/path-match.js";

const ROOT = "/abs/repo";

describe("normalizeKey", () => {
  it("strips leading ./ and trailing slashes", () => {
    expect(normalizeKey("./src/db/client.ts")).toBe("src/db/client.ts");
    expect(normalizeKey("src/db/client.ts/")).toBe("src/db/client.ts");
  });

  it("converts backslashes to forward slashes", () => {
    expect(normalizeKey("src\\db\\client.ts")).toBe("src/db/client.ts");
  });

  it("collapses redundant separators", () => {
    expect(normalizeKey("src//db//client.ts")).toBe("src/db/client.ts");
  });

  it("does not alter already-normal keys", () => {
    expect(normalizeKey("src/db/client.ts")).toBe("src/db/client.ts");
  });
});

describe("toRepoRelativeKey", () => {
  it("returns a relative query unchanged, normalized", () => {
    expect(toRepoRelativeKey(ROOT, "./src/db/client.ts")).toBe("src/db/client.ts");
  });

  it("strips an absolute query proven to be inside the root", () => {
    expect(toRepoRelativeKey(ROOT, "/abs/repo/src/db/client.ts")).toBe("src/db/client.ts");
  });

  it("refuses an absolute query that escapes the root", () => {
    expect(toRepoRelativeKey(ROOT, "/elsewhere/src/db/client.ts")).toBeUndefined();
    expect(toRepoRelativeKey(ROOT, "/abs/repo-sibling/src/db/client.ts")).toBeUndefined();
  });
});

describe("pathsMatch", () => {
  it("matches exact repo-relative paths", () => {
    expect(pathsMatch("src/db/client.ts", "src/db/client.ts", ROOT)).toBe(true);
  });

  it("matches after leading ./ normalization", () => {
    expect(pathsMatch("./src/db/client.ts", "src/db/client.ts", ROOT)).toBe(true);
    expect(pathsMatch("src/db/client.ts", "./src/db/client.ts", ROOT)).toBe(true);
  });

  it("matches an absolute query proven to be inside the root", () => {
    expect(pathsMatch("/abs/repo/src/db/client.ts", "src/db/client.ts", ROOT)).toBe(true);
  });

  it("does not match partial relative paths", () => {
    expect(pathsMatch("db/client.ts", "src/db/client.ts", ROOT)).toBe(false);
    expect(pathsMatch("client.ts", "src/db/client.ts", ROOT)).toBe(false);
  });

  // Was: "does not let a bare single-segment stored key match an arbitrary
  // absolute path". That guard existed ONLY to bound the suffix fallback, by
  // excluding stored keys with no "/" in them. With containment proven there is
  // nothing left to bound, so a single-segment key resolves like any other:
  // inside the root it is a genuine exact match, outside it is refused. The
  // bound now comes from the root, not from counting segments.
  it("resolves a single-segment stored key by containment, not by a segment-count guard", () => {
    expect(pathsMatch("/abs/repo/client.ts", "client.ts", ROOT)).toBe(true);
    expect(pathsMatch("/elsewhere/client.ts", "client.ts", ROOT)).toBe(false);
  });

  // ADR-006 §8 / META-291. The removed fallback matched a stored key against any
  // absolute path that merely ENDED with it, so an assertion about this repo's
  // src/a.ts landed on a file in someone else's checkout. The multi-segment guard
  // it relied on never bounded this — it only excluded single-segment keys.
  it("does not suffix-match an absolute query in an unrelated repository", () => {
    expect(pathsMatch("/elsewhere/unrelated-repo/src/db/client.ts", "src/db/client.ts", ROOT)).toBe(false);
    expect(
      pathsMatch("/tmp/someone-elses-checkout/packages/contracts/src/auth.ts", "packages/contracts/src/auth.ts", ROOT),
    ).toBe(false);
  });

  it("does not suffix-match a relative query that merely ends with the stored key", () => {
    expect(pathsMatch("vendor/other/src/db/client.ts", "src/db/client.ts", ROOT)).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(pathsMatch("src/DB/client.ts", "src/db/client.ts", ROOT)).toBe(false);
  });
});
