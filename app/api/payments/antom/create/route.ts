import { NextResponse } from "next/server";
import { createAntomPayment } from "../../../../../lib/antom";
import { HttpError, jsonError } from "../../../../../lib/errors";
import { getMembershipState } from "../../../../../lib/membership";
import { ensureProfile, getSupabaseAdmin, requireSupabaseUser } from "../../../../../lib/supabase";

function siteOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(request.url).origin;
}

export async function POST(request: Request) {
  try {
    const { user } = await requireSupabaseUser(request);
    await ensureProfile(user);

    const existing = await getMembershipState(user.id);
    if (existing.isPaid) {
      return NextResponse.json({ ok: true, alreadyPaid: true, membership: existing });
    }

    const origin = siteOrigin(request);
    const payment = await createAntomPayment({
      userId: user.id,
      email: user.email || "",
      name: (user.user_metadata?.name as string | undefined) || "",
      redirectUrl: `${origin}/?payment=return`,
      notifyUrl: `${origin}/api/payments/antom/notify`
    });

    const redirectUrl = new URL(payment.checkoutUrl);
    const returnUrl = new URL(`${origin}/`);
    returnUrl.searchParams.set("payment", "return");
    returnUrl.searchParams.set("paymentRequestId", payment.paymentRequestId);

    const { error } = await getSupabaseAdmin().from("payments").insert({
      user_id: user.id,
      email: user.email || "",
      provider: "antom",
      payment_request_id: payment.paymentRequestId,
      amount_minor: payment.amountMinor,
      currency: payment.currency,
      status: "checkout_created",
      checkout_url: redirectUrl.toString(),
      return_url: returnUrl.toString(),
      raw_request: payment.requestBody,
      raw_response: payment.responseBody
    });

    if (error) throw new HttpError(500, `保存订单失败：${error.message}`);

    return NextResponse.json({
      ok: true,
      paymentRequestId: payment.paymentRequestId,
      redirectUrl: redirectUrl.toString()
    });
  } catch (error) {
    return jsonError(error);
  }
}
