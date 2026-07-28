import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  canonicalizePixelData,
  createSubmissionPreview,
  createTraitPreviewVariants,
  normalizeAccessoryName,
  normalizeSubmissionTitle,
  sourcePixelDataSchema,
} from "../src/submission-art.js";

process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/maskborn";
process.env.DATABASE_URL_UNPOOLED = process.env.DATABASE_URL;
process.env.NODE_ENV = "test";

let app: Awaited<typeof import("../src/app.js")>["app"];
let extractXPostId: Awaited<typeof import("../src/utils.js")>["extractXPostId"];
let retryOnWriteConflict: Awaited<typeof import("../src/utils.js")>["retryOnWriteConflict"];

beforeAll(async () => {
  ({ app } = await import("../src/app.js"));
  ({ extractXPostId, retryOnWriteConflict } = await import("../src/utils.js"));
});

describe("API shell", () => {
  it("returns health without touching the database", async () => {
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, service: "maskborn-api" });
    expect(response.headers["x-request-id"]).toBeTruthy();
  });

  it("uses the stable error envelope", async () => {
    const response = await request(app).get("/api/not-a-route");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
    expect(response.body.error.requestId).toBeTruthy();
  });

  it("keeps public viewing open but rejects unauthenticated actions", async () => {
    const response = await request(app)
      .put("/api/submissions/example/vote")
      .send({ value: "UP" });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTH_REQUIRED");
  });

  it("protects the renamed admin namespace and removes the old route", async () => {
    const protectedResponse = await request(app).get("/api/mboadmin/access");
    expect(protectedResponse.status).toBe(401);
    expect(protectedResponse.body.error.code).toBe("AUTH_REQUIRED");

    const oldRoute = await request(app).get("/api/admin/review-queue");
    expect(oldRoute.status).toBe(404);
    expect(oldRoute.body.error.code).toBe("ROUTE_NOT_FOUND");
  });
});

describe("X post URLs", () => {
  it("extracts IDs from supported X and Twitter status URLs", () => {
    expect(extractXPostId("https://x.com/maskborn/status/1234567890123456789")).toBe("1234567890123456789");
    expect(extractXPostId("https://twitter.com/maskborn/status/12345?ref_src=test")).toBe("12345");
  });

  it("rejects profile, lookalike, and non-status URLs", () => {
    expect(extractXPostId("https://x.com/maskborn")).toBeNull();
    expect(extractXPostId("https://x.com.example/status/12345")).toBeNull();
    expect(extractXPostId("https://example.com/maskborn/status/12345")).toBeNull();
  });
});

describe("submission title claims", () => {
  it("treats case, repeated whitespace, and Unicode presentation variants as the same title", () => {
    expect(normalizeSubmissionTitle("  Bone   Merchant  ")).toBe("bone merchant");
    expect(normalizeSubmissionTitle("BONE MERCHANT")).toBe("bone merchant");
    expect(normalizeSubmissionTitle("ＭＡＳＫ")).toBe("mask");
  });
});

describe("transaction retries", () => {
  it("retries Prisma P2034 write conflicts and returns the successful result", async () => {
    let attempts = 0;
    const result = await retryOnWriteConflict(async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("write conflict"), { code: "P2034" });
      return "saved";
    }, 3, 0);
    expect(result).toBe("saved");
    expect(attempts).toBe(3);
  });

  it("does not retry unrelated failures", async () => {
    let attempts = 0;
    await expect(retryOnWriteConflict(async () => {
      attempts += 1;
      throw Object.assign(new Error("bad query"), { code: "P2010" });
    }, 3, 0)).rejects.toMatchObject({ code: "P2010" });
    expect(attempts).toBe(1);
  });
});

describe("submission artwork canonicalization", () => {
  it("normalizes accessory names consistently across case, spacing, and Unicode forms", () => {
    expect(normalizeAccessoryName("  BONE   Crown ")).toBe("bone crown");
    expect(normalizeAccessoryName("Ａｍｂｅｒ")).toBe("amber");
  });

  it("keeps visible pixels, resolves later-layer overlaps, and sorts coordinates", () => {
    const source = sourcePixelDataSchema.parse({
      schemaVersion: 2,
      startBlank: false,
      layers: [
        { id: "background-1", name: "Amber Field", kind: "Background", visible: true, pixels: [{ x: 8, y: 4, color: "#f2b441" }] },
        { id: "eyes-1", name: "Bone Eyes", kind: "Eyes", visible: true, pixels: [{ x: 4, y: 9, color: "#ffffff" }, { x: 2, y: 1, color: "#1a1815" }] },
        { id: "eyes-2", name: "Red Eyes", kind: "Eyes", visible: true, pixels: [{ x: 4, y: 9, color: "#d85b45" }] },
        { id: "hidden", name: "Hidden Spark", kind: "Special", visible: false, pixels: [{ x: 0, y: 0, color: "#ffffff" }] },
      ],
    });
    const result = canonicalizePixelData(source);
    expect(result.traits).toEqual([
      { kind: "Background", stage: 0, pixels: [[8, 4, "#F2B441"]] },
      { kind: "Eyes", stage: 1, pixels: [[2, 1, "#1A1815"], [4, 9, "#D85B45"]] },
    ]);
  });

  it("builds individual, combined, and all-trait previews in generator order", () => {
    const source = sourcePixelDataSchema.parse({
      schemaVersion: 2,
      startBlank: false,
      layers: [
        { id: "background", name: "Amber Field", kind: "Background", visible: true, pixels: [{ x: 1, y: 1, color: "#F2B441" }] },
        { id: "eyes", name: "Night Eyes", kind: "Eyes", visible: true, pixels: [{ x: 4, y: 9, color: "#1A1815" }] },
      ],
    });
    const variants = createTraitPreviewVariants(source, '<g id="maskborn-base"/>');
    expect(variants.map((variant) => variant.label)).toEqual(["Amber Field", "Night Eyes", "All"]);
    const all = variants[2]!.svg;
    expect(all.indexOf('x="1"')).toBeLessThan(all.indexOf("maskborn-base"));
    expect(all.indexOf("maskborn-base")).toBeLessThan(all.indexOf('x="4"'));
  });

  it("builds the stored preview only from validated pixels and the trusted base", () => {
    const source = sourcePixelDataSchema.parse({
      schemaVersion: 2,
      startBlank: false,
      layers: [
        { id: "background", name: "Amber Field", kind: "Background", visible: true, pixels: [{ x: 1, y: 1, color: "#F2B441" }] },
        { id: "hidden", name: "Hidden Eye", kind: "Eyes", visible: false, pixels: [{ x: 3, y: 3, color: "#FFFFFF" }] },
        { id: "hat", name: "Bone Crown", kind: "Hats", visible: true, pixels: [{ x: 4, y: 2, color: "#EDEAE2" }] },
      ],
    });
    const preview = createSubmissionPreview(source, '<g id="trusted-base"/>', true);
    expect(preview).toContain('<g id="trusted-base"/>');
    expect(preview).toContain('x="1" y="1"');
    expect(preview).toContain('x="4" y="2"');
    expect(preview).not.toContain('x="3" y="3"');
  });
});
