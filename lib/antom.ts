import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { HttpError, requiredEnv } from "./errors";

type AntomPaymentInput = {
  userId: string;
  email: string;
  name?: string;
  redirectUrl: string;
  notifyUrl: string;
};

type AntomPaymentResult = {
  paymentRequestId: string;
  amountMinor: number;
  currency: string;
  requestBody: Record<string, unknown>;
  responseBody: Record<string, unknown>;
  checkoutUrl: string;
};

type AntomConfig = {
  gatewayUrl: string;
  clientId: string;
  merchantId: string;
  privateKey: string;
  publicKey: string;
  currency: string;
  amountMinor: number;
  paymentMethodType: string;
  payPath: string;
};

export type AntomPriceConfig = {
  currency: string;
  amountMinor: number;
  priceLabel: string;
  periodLabel: string;
};

function normalizePem(value: string) {
  return value.replace(/\\n/g, "\n").trim();
}

function wrapPemBody(value: string, label: "PRIVATE KEY" | "PUBLIC KEY") {
  const normalized = normalizePem(value);
  const compact = normalized
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const lines = compact.match(/.{1,64}/g)?.join("\n") || compact;
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}

async function loadPrivateKey() {
  const inline = process.env.ANTOM_PRIVATE_KEY;
  if (inline) return wrapPemBody(inline, "PRIVATE KEY");

  const file = process.env.ANTOM_PRIVATE_KEY_FILE;
  if (file) return wrapPemBody(await readFile(file, "utf8"), "PRIVATE KEY");

  throw new HttpError(503, "Missing Antom private key");
}

function currencyDecimals(currency: string) {
  return currency.toUpperCase() === "JPY" ? 0 : 2;
}

function decimalToMinor(value: string, currency: string) {
  const decimals = currencyDecimals(currency);
  const numeric = Number(value || "9.9");
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new HttpError(503, "Invalid Antom price");
  }
  return Math.round(numeric * 10 ** decimals);
}

function formatPriceLabel(currency: string, amountMinor: number) {
  const normalizedCurrency = currency.toUpperCase();
  const decimals = currencyDecimals(normalizedCurrency);
  const major = amountMinor / 10 ** decimals;
  const trimmed = major.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals
  });
  const prefix = normalizedCurrency === "CNY" ? "¥" : normalizedCurrency === "USD" ? "$" : `${normalizedCurrency} `;
  return `${prefix}${trimmed}`;
}

export function getAntomPriceConfig(): AntomPriceConfig {
  const currency = (process.env.ANTOM_DEFAULT_CURRENCY || "CNY").toUpperCase();
  const amountMinor = Number(process.env.ANTOM_MONTHLY_PRICE_MINOR || "") ||
    decimalToMinor(process.env.ANTOM_MONTHLY_PRICE || "9.9", currency);

  return {
    currency,
    amountMinor,
    priceLabel: formatPriceLabel(currency, amountMinor),
    periodLabel: "/ 月，每天无限页、记忆与来信"
  };
}

async function getAntomConfig(): Promise<AntomConfig> {
  const env = (process.env.ANTOM_ENV || "sandbox").toLowerCase();
  const price = getAntomPriceConfig();
  const paymentMethodType = (process.env.ANTOM_PAYMENT_METHODS || "ALIPAY_CN")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)[0] || "ALIPAY";
  const sandboxSegment = env === "production" ? "" : "/sandbox";

  return {
    gatewayUrl: requiredEnv("ANTOM_GATEWAY_URL").replace(/\/+$/, ""),
    clientId: requiredEnv("ANTOM_CLIENT_ID"),
    merchantId: process.env.ANTOM_MERCHANT_ID || "",
    privateKey: await loadPrivateKey(),
    publicKey: wrapPemBody(requiredEnv("ANTOM_PUBLIC_KEY"), "PUBLIC KEY"),
    currency: price.currency,
    amountMinor: price.amountMinor,
    paymentMethodType,
    payPath: process.env.ANTOM_PAY_PATH || `/ams${sandboxSegment}/api/v1/payments/pay`
  };
}

function canonicalContent(method: string, path: string, clientId: string, requestTime: string, body: string) {
  return `${method.toUpperCase()} ${path}\n${clientId}.${requestTime}.${body}`;
}

function signAntomRequest(config: AntomConfig, requestTime: string, body: string) {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(canonicalContent("POST", config.payPath, config.clientId, requestTime, body));
  signer.end();
  const signature = signer.sign(config.privateKey).toString("base64url");
  return `algorithm=RSA256,keyVersion=1,signature=${signature}`;
}

function parseSignature(signatureHeader: string) {
  const match = signatureHeader.match(/signature="?([^",]+)"?/);
  return match?.[1] || signatureHeader;
}

export async function verifyAntomNotificationSignature(input: {
  path: string;
  clientId: string;
  requestTime: string;
  body: string;
  signature: string;
}) {
  const config = await getAntomConfig();
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(canonicalContent("POST", input.path, input.clientId || config.clientId, input.requestTime, input.body));
  verifier.end();
  return verifier.verify(config.publicKey, Buffer.from(parseSignature(input.signature), "base64url"));
}

function findCheckoutUrl(response: Record<string, unknown>) {
  const candidates = [
    response.normalUrl,
    response.paymentUrl,
    response.checkoutUrl,
    response.applinkUrl,
    response.schemeUrl,
    (response.paymentActionForm as Record<string, unknown> | undefined)?.redirectUrl,
    (response.paymentActionForm as Record<string, unknown> | undefined)?.normalUrl
  ];

  return candidates.find((value): value is string => typeof value === "string" && /^https?:\/\//.test(value));
}

export async function createAntomPayment(input: AntomPaymentInput): Promise<AntomPaymentResult> {
  const config = await getAntomConfig();
  const paymentRequestId = `OM_${Date.now()}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const amount = {
    currency: config.currency,
    value: String(config.amountMinor)
  };

  const requestBody = {
    productCode: "CASHIER_PAYMENT",
    paymentRequestId,
    paymentAmount: amount,
    order: {
      referenceOrderId: paymentRequestId,
      orderDescription: "从前有座山 · 练剑册会员",
      orderAmount: amount
    },
    paymentMethod: {
      paymentMethodType: config.paymentMethodType
    },
    env: {
      terminalType: "WEB"
    },
    paymentRedirectUrl: input.redirectUrl,
    paymentNotifyUrl: input.notifyUrl
  };

  const body = JSON.stringify(requestBody);
  const requestTime = new Date().toISOString();
  const response = await fetch(`${config.gatewayUrl}${config.payPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      "client-id": config.clientId,
      "request-time": requestTime,
      signature: signAntomRequest(config, requestTime, body)
    },
    body
  });
  const responseText = await response.text();
  let responseBody: Record<string, unknown>;

  try {
    responseBody = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    throw new HttpError(response.status || 502, `Antom returned non-JSON response: ${responseText.slice(0, 200)}`);
  }

  if (!response.ok) {
    throw new HttpError(response.status, `Antom payment request failed: ${JSON.stringify(responseBody)}`);
  }

  const checkoutUrl = findCheckoutUrl(responseBody);
  if (!checkoutUrl) {
    throw new HttpError(502, `Antom response did not include a checkout URL: ${JSON.stringify(responseBody)}`);
  }

  return {
    paymentRequestId,
    amountMinor: config.amountMinor,
    currency: config.currency,
    requestBody,
    responseBody,
    checkoutUrl
  };
}
