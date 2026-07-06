import { NextResponse } from "next/server";
import { inquireAntomPayment } from "../../../../../lib/antom";
import { HttpError, jsonError } from "../../../../../lib/errors";
import { getMembershipState, grantMembership } from "../../../../../lib/membership";
import { getSupabaseAdmin, requireSupabaseUser } from "../../../../../lib/supabase";

async function reconcilePayment(payment: {
  payment_request_id: string;
  status: string;
  user_id: string;
}) {
  if (payment.status === "paid") return;

  const inquiry = await inquireAntomPayment(payment.payment_request_id);
  const now = new Date().toISOString();
  const nextStatus = inquiry.paid ? "paid" : inquiry.status.toLowerCase();

  const { error } = await getSupabaseAdmin()
    .from("payments")
    .update({
      status: nextStatus,
      provider_payment_id: inquiry.paymentId,
      raw_notify: inquiry.responseBody,
      paid_at: inquiry.paid ? inquiry.paidAt || now : null,
      updated_at: now
    })
    .eq("payment_request_id", payment.payment_request_id);

  if (error) throw new HttpError(500, `更新订单失败：${error.message}`);
  if (inquiry.paid) await grantMembership(payment.user_id, `antom:${payment.payment_request_id}`);
}

export async function GET(request: Request) {
  try {
    const { user } = await requireSupabaseUser(request);
    const { searchParams } = new URL(request.url);
    const paymentRequestId = searchParams.get("paymentRequestId");
    if (!paymentRequestId) throw new HttpError(400, "Missing paymentRequestId");

    const { data, error } = await getSupabaseAdmin()
      .from("payments")
      .select("payment_request_id,status,currency,amount_minor,created_at,paid_at,user_id")
      .eq("payment_request_id", paymentRequestId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw new HttpError(500, `查询订单失败：${error.message}`);
    if (!data) throw new HttpError(404, "订单不存在");
    await reconcilePayment(data);

    const { data: refreshed, error: reloadError } = await getSupabaseAdmin()
      .from("payments")
      .select("payment_request_id,status,currency,amount_minor,created_at,paid_at")
      .eq("payment_request_id", paymentRequestId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (reloadError) throw new HttpError(500, `查询订单失败：${reloadError.message}`);

    return NextResponse.json({
      ok: true,
      payment: refreshed || data,
      membership: await getMembershipState(user.id)
    });
  } catch (error) {
    return jsonError(error);
  }
}
