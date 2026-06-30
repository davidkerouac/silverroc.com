import { NextRequest, NextResponse } from "next/server";
import { verifyAntomNotificationSignature } from "../../../../../lib/antom";
import { HttpError, jsonError } from "../../../../../lib/errors";
import { grantMembership } from "../../../../../lib/membership";
import { getSupabaseAdmin } from "../../../../../lib/supabase";

function notificationSuccess() {
  return NextResponse.json({
    result: {
      resultCode: "SUCCESS",
      resultMessage: "success",
      resultStatus: "S"
    }
  });
}

function extractStatus(payload: Record<string, any>) {
  return payload.result?.resultCode || payload.paymentResult?.resultCode || payload.paymentStatus || "UNKNOWN";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const requestTime = request.headers.get("request-time") || "";
    const clientId = request.headers.get("client-id") || process.env.ANTOM_CLIENT_ID || "";
    const signature = request.headers.get("signature") || "";

    if (!requestTime || !clientId || !signature) {
      throw new HttpError(401, "Missing Antom signature headers");
    }

    const verified = await verifyAntomNotificationSignature({
      path: request.nextUrl.pathname,
      clientId,
      requestTime,
      body,
      signature
    });

    if (!verified && process.env.ANTOM_SKIP_NOTIFY_SIGNATURE !== "true") {
      throw new HttpError(401, "Invalid Antom notification signature");
    }

    const payload = JSON.parse(body) as Record<string, any>;
    const paymentRequestId = payload.paymentRequestId || payload.paymentRequestID;
    if (!paymentRequestId) throw new HttpError(400, "Missing paymentRequestId");

    const { data: payment, error: loadError } = await getSupabaseAdmin()
      .from("payments")
      .select("id,user_id,status")
      .eq("payment_request_id", paymentRequestId)
      .maybeSingle();

    if (loadError) throw new HttpError(500, `查询订单失败：${loadError.message}`);
    if (!payment) throw new HttpError(404, "Payment not found");

    const status = extractStatus(payload);
    const paid = status === "SUCCESS";
    const now = new Date().toISOString();

    const { error: updateError } = await getSupabaseAdmin()
      .from("payments")
      .update({
        status: paid ? "paid" : String(status).toLowerCase(),
        provider_payment_id: payload.paymentId || payload.paymentID || null,
        raw_notify: payload,
        paid_at: paid ? now : null,
        updated_at: now
      })
      .eq("id", payment.id);

    if (updateError) throw new HttpError(500, `更新订单失败：${updateError.message}`);

    if (paid && payment.status !== "paid") {
      await grantMembership(payment.user_id, `antom:${paymentRequestId}`);
    }

    return notificationSuccess();
  } catch (error) {
    return jsonError(error);
  }
}
