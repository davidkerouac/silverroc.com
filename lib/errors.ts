import { NextResponse } from "next/server";

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new HttpError(503, `Missing required environment variable: ${name}`);
  }
  return value;
}

export function jsonError(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }

  const message = error instanceof Error ? error.message : "Unknown server error";
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

export function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new HttpError(401, "Missing auth token");
  return match[1];
}
