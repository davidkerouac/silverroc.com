import { NextResponse } from "next/server";
import { HttpError, jsonError } from "../../../../../lib/errors";
import { getMembershipState } from "../../../../../lib/membership";
import { getSupabaseAdmin, requireSupabaseUser } from "../../../../../lib/supabase";

export async function GET(request: Request) {
  try {
    const { user } = await requireSupabaseUser(request);
    const { searchParams } = new URL(request.url);
    const paymentRequestId = searchParams.get("paymentRequestId");
    if (!paymentRequestId) throw new HttpError(400, "Missing paymentRequestId");

    const { data, error } = await getSupabaseAdmin()
      .from("payments")
      .select("payment_request_id,status,currency,amount_minor,created_at,paid_at")
      .eq("payment_request_id", paymentRequestId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw new HttpError(500, `查询订单失败：${error.message}`);
    if (!data) throw new HttpError(404, "订单不存在");

    return NextResponse.json({
      ok: true,
      payment: data,
      membership: await getMembershipState(user.id)
    });
  } catch (error) {
    return jsonError(error);
  }
}
