import { NextResponse } from "next/server";
import { createAntomPayment, inquireAntomPayment } from "../../../../../lib/antom";
import { HttpError, jsonError } from "../../../../../lib/errors";
import { getMembershipState, grantMembership } from "../../../../../lib/membership";
import { ensureProfile, getSupabaseAdmin, requireSupabaseUser } from "../../../../../lib/supabase";

function siteOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(request.url).origin;
}

async function reconcilePendingPayments(userId: string) {
  const { data: payments, error } = await getSupabaseAdmin()
    .from("payments")
    .select("id,payment_request_id,status")
    .eq("user_id", userId)
    .neq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) throw new HttpError(500, `查询订单失败：${error.message}`);
  if (!payments?.length) return null;

  let membership = null;
  for (const payment of payments) {
    const inquiry = await inquireAntomPayment(payment.payment_request_id);
    const now = new Date().toISOString();
    const nextStatus = inquiry.paid ? "paid" : inquiry.status.toLowerCase();
    const { error: updateError } = await getSupabaseAdmin()
      .from("payments")
      .update({
        status: nextStatus,
        provider_payment_id: inquiry.paymentId,
        raw_notify: inquiry.responseBody,
        paid_at: inquiry.paid ? inquiry.paidAt || now : null,
        updated_at: now
      })
      .eq("id", payment.id);

    if (updateError) throw new HttpError(500, `更新订单失败：${updateError.message}`);
    if (inquiry.paid) {
      membership = await grantMembership(userId, `antom:${payment.payment_request_id}`);
    }
  }

  return membership;
}

export async function POST(request: Request) {
  try {
    const { user } = await requireSupabaseUser(request);
    await ensureProfile(user);

    const existing = await getMembershipState(user.id);
    if (existing.isPaid) {
      return NextResponse.json({ ok: true, alreadyPaid: true, membership: existing });
    }

    const reconciled = await reconcilePendingPayments(user.id);
    if (reconciled?.isPaid) {
      return NextResponse.json({ ok: true, alreadyPaid: true, membership: reconciled });
    }

    const origin = siteOrigin(request);
    const returnUrl = new URL(`${origin}/`);
    const payment = await createAntomPayment({
      userId: user.id,
      email: user.email || "",
      name: (user.user_metadata?.name as string | undefined) || "",
      redirectUrl: returnUrl.toString(),
      notifyUrl: `${origin}/api/payments/antom/notify`
    });

    const redirectUrl = new URL(payment.checkoutUrl);
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
