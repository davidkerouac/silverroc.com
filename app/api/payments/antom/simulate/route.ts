import { NextResponse } from "next/server";
import { HttpError, jsonError } from "../../../../../lib/errors";
import { grantMembership } from "../../../../../lib/membership";
import { getSupabaseAdmin, requireSupabaseUser } from "../../../../../lib/supabase";

export async function POST(request: Request) {
  try {
    if (process.env.ANTOM_ENABLE_SIMULATE !== "true" || process.env.ANTOM_ENV === "production") {
      throw new HttpError(404, "Not found");
    }

    const { user } = await requireSupabaseUser(request);
    const body = await request.json();
    const paymentRequestId = String(body.paymentRequestId || "");
    if (!paymentRequestId) throw new HttpError(400, "Missing paymentRequestId");

    const now = new Date().toISOString();
    const { data: payment, error: loadError } = await getSupabaseAdmin()
      .from("payments")
      .select("id,user_id")
      .eq("payment_request_id", paymentRequestId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (loadError) throw new HttpError(500, `查询订单失败：${loadError.message}`);
    if (!payment) throw new HttpError(404, "Payment not found");

    const { error: updateError } = await getSupabaseAdmin()
      .from("payments")
      .update({
        status: "paid",
        paid_at: now,
        updated_at: now,
        raw_notify: { simulated: true, at: now }
      })
      .eq("id", payment.id);

    if (updateError) throw new HttpError(500, `更新订单失败：${updateError.message}`);

    return NextResponse.json({
      ok: true,
      membership: await grantMembership(user.id, `antom-simulated:${paymentRequestId}`)
    });
  } catch (error) {
    return jsonError(error);
  }
}
