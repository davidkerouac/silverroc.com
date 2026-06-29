import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const envFiles = [];
const flags = new Set();

for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--dotenv-file") {
    envFiles.push(args[index + 1]);
    index += 1;
  } else {
    flags.add(args[index]);
  }
}

function parseEnvFile(file) {
  if (!file || !fs.existsSync(file)) return {};
  const result = {};
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals < 0) continue;
    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    value = value.replace(/^['"]|['"]$/g, "");
    result[key] = value;
  }
  return result;
}

const fileEnv = Object.assign({}, ...envFiles.map(parseEnvFile));
const env = { ...process.env, ...fileEnv };
const failures = [];
const warnings = [];

function required(name) {
  if (!env[name]) failures.push(`${name} is missing`);
  return env[name] || "";
}

function normalizePem(value) {
  return String(value || "").replace(/\\n/g, "\n").trim();
}

function wrapPemBody(value, label) {
  const normalized = normalizePem(value);
  if (normalized.includes("BEGIN ")) return normalized;
  const compact = normalized.replace(/\s+/g, "");
  const lines = compact.match(/.{1,64}/g)?.join("\n") || compact;
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}

function validUrl(name, value, requireHttps = false) {
  try {
    const url = new URL(value);
    if (requireHttps && url.protocol !== "https:") failures.push(`${name} must be https`);
  } catch {
    failures.push(`${name} must be a valid URL`);
  }
}

function currencyDecimals(currency) {
  return currency.toUpperCase() === "JPY" ? 0 : 2;
}

function parseAmountMinor() {
  const currency = (env.ANTOM_DEFAULT_CURRENCY || "CNY").toUpperCase();
  if (env.ANTOM_MONTHLY_PRICE_MINOR) return Number(env.ANTOM_MONTHLY_PRICE_MINOR);
  const major = Number(env.ANTOM_MONTHLY_PRICE || "9.9");
  return Math.round(major * 10 ** currencyDecimals(currency));
}

const siteUrl = required("NEXT_PUBLIC_SITE_URL");
const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
required("SUPABASE_SERVICE_ROLE_KEY");

const antomGateway = required("ANTOM_GATEWAY_URL");
required("ANTOM_CLIENT_ID");
required("ANTOM_PUBLIC_KEY");
required("ANTOM_DEFAULT_CURRENCY");
required("ANTOM_PAYMENT_METHODS");

if (siteUrl) validUrl("NEXT_PUBLIC_SITE_URL", siteUrl, !siteUrl.includes("localhost"));
if (supabaseUrl) validUrl("NEXT_PUBLIC_SUPABASE_URL", supabaseUrl, true);
if (antomGateway) validUrl("ANTOM_GATEWAY_URL", antomGateway, true);

const amountMinor = parseAmountMinor();
if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
  failures.push("Antom price must resolve to a positive integer minor-unit amount");
}

const privateKeySource = env.ANTOM_PRIVATE_KEY
  ? { label: "ANTOM_PRIVATE_KEY", value: env.ANTOM_PRIVATE_KEY }
  : env.ANTOM_PRIVATE_KEY_FILE
    ? {
        label: "ANTOM_PRIVATE_KEY_FILE",
        value: fs.existsSync(env.ANTOM_PRIVATE_KEY_FILE) ? fs.readFileSync(env.ANTOM_PRIVATE_KEY_FILE, "utf8") : ""
      }
    : null;

if (!privateKeySource) {
  failures.push("ANTOM_PRIVATE_KEY or ANTOM_PRIVATE_KEY_FILE is missing");
} else if (!privateKeySource.value) {
  failures.push(`${privateKeySource.label} cannot be read`);
} else {
  try {
    crypto.createPrivateKey(wrapPemBody(privateKeySource.value, "PRIVATE KEY"));
  } catch (error) {
    failures.push(`${privateKeySource.label} is not a Node/OpenSSL-readable RSA private key`);
  }
}

if (env.ANTOM_PUBLIC_KEY) {
  try {
    crypto.createPublicKey(wrapPemBody(env.ANTOM_PUBLIC_KEY, "PUBLIC KEY"));
  } catch {
    failures.push("ANTOM_PUBLIC_KEY is not a Node/OpenSSL-readable public key");
  }
}

const schema = fs.existsSync("supabase/schema.sql") ? fs.readFileSync("supabase/schema.sql", "utf8") : "";
for (const table of ["profiles", "memberships", "payments"]) {
  if (!schema.includes(`public.${table}`)) failures.push(`supabase/schema.sql is missing ${table}`);
}
if (!schema.includes("enable row level security")) warnings.push("schema does not appear to enable RLS");

if (flags.has("--check-vercel")) {
  const whoami = spawnSync("vercel", ["whoami"], { encoding: "utf8" });
  if (whoami.status !== 0) failures.push("Vercel CLI is not logged in");
}

if (warnings.length) {
  console.log("Warnings:");
  for (const warning of warnings) console.log(`- ${warning}`);
}

if (failures.length) {
  console.error("Launch verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Launch verification passed:");
console.log(`- Supabase env present`);
console.log(`- Antom ${env.ANTOM_ENV || "sandbox"} env present`);
console.log(`- Price amount minor: ${amountMinor} ${env.ANTOM_DEFAULT_CURRENCY || "CNY"}`);
console.log(`- Schema includes profiles, memberships, payments`);
if (flags.has("--check-vercel")) console.log("- Vercel CLI logged in");
