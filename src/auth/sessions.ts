import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { hashToken } from "../flags/sdk-auth.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { SignedInUser } from "./auth-config.js";

export const SESSION_COOKIE = "ssf_session";
export const LOGIN_COOKIE = "ssf_login";

/** The value of one cookie from a Cookie header. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const eq = part.indexOf("=");
    if (eq <= 0 || part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return undefined; // malformed: as if not sent
    }
  }
  return undefined;
}

/** A Set-Cookie value: HttpOnly and SameSite=Lax always (Lax still sends it on the provider's redirect back), Secure on https. */
export function cookie(name: string, value: string, options: { path: string; maxAgeSeconds: number; secure: boolean }): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(options.secure ? ["Secure"] : []),
  ].join("; ");
}

/** Server-side sessions of signed-in users; the cookie carries a random token, the database only its SHA-256. */
@Injectable()
export class Sessions {
  constructor(private readonly prisma: PrismaService) {}

  /** Starts a session and returns its token. Also deletes expired sessions, so they do not pile up. */
  async create(user: SignedInUser, idToken: string | undefined, ttlMs: number, now = new Date()): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await this.prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
    await this.prisma.session.create({
      data: { id: hashToken(token), ...user, email: user.email ?? null, idToken: idToken ?? null, createdAt: now, expiresAt: new Date(now.getTime() + ttlMs) },
    });
    return token;
  }

  /** The user of a live session, or null for a missing, unknown or expired token. */
  async find(token: string | undefined, now = new Date()): Promise<SignedInUser | null> {
    if (!token) return null;
    const session = await this.prisma.session.findUnique({ where: { id: hashToken(token) } });
    if (!session || session.expiresAt <= now) return null;
    return { username: session.username, name: session.name, ...(session.email ? { email: session.email } : {}), role: session.role };
  }

  /** Ends the session; returns its ID token for the provider's sign-out. */
  async end(token: string | undefined): Promise<string | null> {
    if (!token) return null;
    const id = hashToken(token);
    const session = await this.prisma.session.findUnique({ where: { id }, select: { idToken: true } });
    await this.prisma.session.deleteMany({ where: { id } });
    return session?.idToken ?? null;
  }
}
