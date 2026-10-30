import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { readFileSync } from "node:fs";
import request from "supertest";
import type { App } from "supertest/types.js";
import { AppModule } from "./../src/app.module.js";
import { configureApp } from "./../src/app.setup.js";
import type { PrismaClient } from "./../src/generated/prisma/client.js";
import { resetDatabase, testPrisma } from "./db.js";

// The consumer contract in docs/sdk-api.openapi.json, checked against what the API really answers. The checker below
// covers only the JSON Schema keywords the spec uses (it fails on any other), so no validator dependency is needed.

type Schema = {
  $ref?: string;
  type?: string;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: Schema;
  minimum?: number;
};
type Operation = { parameters: unknown[]; responses: Record<string, { $ref: string }> };

const spec = JSON.parse(readFileSync(new URL("../docs/sdk-api.openapi.json", import.meta.url), "utf8")) as {
  openapi: string;
  paths: Record<string, { get: Operation }>;
  components: Record<string, Record<string, unknown>>;
};
const KNOWN = new Set(["$ref", "type", "enum", "required", "properties", "additionalProperties", "minimum", "description"]);

function resolve<T>(node: T & { $ref?: string }): T {
  if (!node.$ref) return node;
  const [, , section, name] = node.$ref.split("/");
  return resolve(spec.components[section][name] as T & { $ref?: string });
}

/** The problems of `value` against `schema`, as "path: what" lines (empty when it matches). */
function check(value: unknown, schema: Schema, path = "$"): string[] {
  const s = resolve(schema);
  const unknown = Object.keys(s).filter((k) => !KNOWN.has(k));
  if (unknown.length) return [`${path}: the checker does not know ${unknown.join(", ")}`];
  if (s.enum && !s.enum.includes(value)) return [`${path}: ${JSON.stringify(value)} is not one of ${s.enum.join(", ")}`];
  const actual = Array.isArray(value) ? "array" : value === null ? "null" : Number.isInteger(value) ? "integer" : typeof value;
  if (s.type && actual !== s.type && !(s.type === "number" && actual === "integer")) return [`${path}: expected ${s.type}, got ${actual}`];
  if (s.minimum !== undefined && (value as number) < s.minimum) return [`${path}: below ${s.minimum}`];
  if (actual !== "object") return [];
  const object = value as Record<string, unknown>;
  return [
    ...(s.required ?? []).filter((k) => !(k in object)).map((k) => `${path}.${k}: missing`),
    ...Object.entries(object).flatMap(([k, v]) => {
      const property = s.properties?.[k] ?? s.additionalProperties;
      return property ? check(v, property, `${path}.${k}`) : [];
    }),
  ];
}

const operation = spec.paths["/v1/sdk/flags"].get;

/** Checks one real answer against the documented response for its status code. */
function conforms(res: request.Response) {
  const documented = operation.responses[String(res.status)] ?? (res.status >= 500 ? operation.responses.default : undefined);
  expect(documented, `status ${res.status} is not in the spec`).toBeDefined();
  const response = resolve(documented! as { $ref?: string } & { content?: Record<string, { schema: Schema }>; headers?: Record<string, { schema: Schema }> });
  expect(res.headers["content-type"]).toMatch(/^application\/json/);
  expect(check(res.body, response.content!["application/json"].schema)).toEqual([]);
  for (const [name, header] of Object.entries(response.headers ?? {})) expect(check(Number(res.headers[name.toLowerCase()]), header.schema, name)).toEqual([]);
}

describe("consumer API against its OpenAPI spec (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let token: string;
  const saved = { ...process.env };

  beforeAll(async () => {
    Object.assign(process.env, { RATE_LIMIT_SDK_PER_MINUTE: "20", TRUST_PROXY: "loopback", SDK_TOKEN: "openapi-shared" });
    prisma = testPrisma();
    await resetDatabase(prisma);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
    const server = app.getHttpServer();
    token = ((await request(server).post("/api/services").send({ key: "checkout" }).expect(201)).body as { token: string }).token;
    await request(server).post("/api/services").send({ key: "billing" }).expect(201);
    await request(server)
      .post("/api/flags")
      .send({ key: "newCheckout", type: "release", serviceIds: ["svc-checkout"] })
      .expect(201);
    await request(server).patch("/api/flags/newCheckout/environments/test").send({ enabled: true }).expect(200);
  });

  afterAll(async () => {
    await app.close();
    process.env = saved;
    await prisma.$disconnect();
  });

  const sdk = (query: string, credential?: string, ip = "203.0.113.10") => {
    const req = request(app.getHttpServer()).get(`/api/v1/sdk/flags${query}`).set("X-Forwarded-For", ip);
    return credential ? req.set("Authorization", `Bearer ${credential}`) : req;
  };

  it("is an OpenAPI 3.1 document whose references all resolve", () => {
    expect(spec.openapi).toMatch(/^3\.1\./);
    const refs = JSON.stringify(spec).match(/"#\/components\/[^"]+"/g) ?? [];
    for (const ref of refs) expect(resolve({ $ref: JSON.parse(ref) as string }), ref).toBeDefined();
  });

  it("answers 200 with the service's flags in the documented shape", async () => {
    const res = await sdk("?env=test", token).expect(200);
    conforms(res);
    expect(res.body).toEqual({ env: "test", flags: { newCheckout: true } });
    conforms(await sdk("?env=prod&service=checkout", token).expect(200));
  });

  it.each([
    ["400 for an unknown environment", "?env=staging", () => token, 400],
    ["400 without env", "", () => token, 400],
    ["401 without a credential", "?env=prod", () => undefined, 401],
    ["401 for an unknown credential", "?env=prod", () => "ssf_wrong", 401],
    ["403 for another service's flags", "?env=prod&service=billing", () => token, 403],
    ["404 for an unknown service with the shared token", "?env=prod&service=nope", () => "openapi-shared", 404],
  ])("answers %s in the documented shape", async (_name, query, credential, status) => {
    conforms(await sdk(query, credential()).expect(status));
  });

  it("answers 429 with Retry-After in the documented shape", async () => {
    let res: request.Response;
    do res = await sdk("?env=qa", token, "203.0.113.99");
    while (res.status === 200);
    expect(res.status).toBe(429);
    conforms(res);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });
});
