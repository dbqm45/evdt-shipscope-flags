import type { INestApplication } from "@nestjs/common";
import type { Role } from "@shipscope/shared/types";
import { randomBytes } from "node:crypto";
import request from "supertest";
import type { App } from "supertest/types.js";
import { CSRF_VALUE } from "../src/auth/auth.guard.js";
import { SESSION_COOKIE } from "../src/auth/sessions.js";
import { hashToken } from "../src/flags/sdk-auth.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";

/** A session for `username` with `role`, as a sign-in through the provider would leave it; returns the Cookie header. */
export async function signIn(prisma: PrismaClient, role: Role, username = `e2e-${role}`): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await prisma.session.create({
    data: { id: hashToken(token), username, name: username, role, createdAt: now, expiresAt: new Date(now.getTime() + 60 * 60_000) },
  });
  return `${SESSION_COOKIE}=${token}`;
}

/** Requests to the management API as the user of `cookie`, with the header every change must carry. */
export function as(app: INestApplication<App>, cookie: string) {
  const server = app.getHttpServer();
  const signed = (req: request.Test) => req.set("Cookie", cookie).set("X-Requested-With", CSRF_VALUE);
  return {
    get: (path: string) => signed(request(server).get(path)),
    post: (path: string) => signed(request(server).post(path)),
    put: (path: string) => signed(request(server).put(path)),
    patch: (path: string) => signed(request(server).patch(path)),
    delete: (path: string) => signed(request(server).delete(path)),
  };
}
