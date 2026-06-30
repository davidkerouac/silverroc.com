import { NextResponse } from "next/server";
import { HttpError, jsonError } from "../../../lib/errors";
import { getMembershipState } from "../../../lib/membership";
import { requireSupabaseUser } from "../../../lib/supabase";

type ChatHistoryItem = {
  role?: string;
  text?: string;
};

type ChatRequestBody = {
  message?: string;
  history?: ChatHistoryItem[];
  memories?: string[];
  activity?: {
    title?: string;
    copy?: string;
    time?: string;
  };
  lesson?: {
    quote?: string;
    source?: string;
    note?: string;
  };
};

function geminiApiKey() {
  const key =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY;
  if (!key) throw new HttpError(503, "Missing Gemini API key");
  return key;
}

async function paidFromRequest(request: Request) {
  if (!request.headers.get("authorization")) return false;

  try {
    const { user } = await requireSupabaseUser(request);
    const membership = await getMembershipState(user.id);
    return membership.isPaid;
  } catch {
    return false;
  }
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function systemPrompt(isPaid: boolean, body: ChatRequestBody) {
  const activity = body.activity?.title
    ? `现在小和尚正在：${cleanText(body.activity.title, 40)}。${cleanText(body.activity.copy, 120)}`
    : "现在小和尚按山中作息做自己的功课。";
  const lesson = body.lesson?.quote
    ? `今日课本：${cleanText(body.lesson.quote, 120)}，出处：${cleanText(body.lesson.source, 80)}，笔记：${cleanText(body.lesson.note, 120)}。`
    : "";
  const memories =
    isPaid && Array.isArray(body.memories) && body.memories.length
      ? `可轻轻参考这些记忆，但不要直接复述：${body.memories.map((item) => cleanText(item, 90)).filter(Boolean).slice(0, 6).join("；")}`
      : "没有可用的长期记忆。";

  return [
    "你是《从前有座山》里的小和尚，不是客服、导师、算命先生或心理医生。",
    "你正在寺里正常生活。用户像普通来访者一样问一句，你淡淡回应一句。",
    "语气：安静、认真、克制、自然；不要热血鸡汤，不要说教，不要夸张承诺。",
    "内容：尽量把话落到一件小事、一个动作、一次呼吸或今天的功课上；不要只给隐喻，至少给一个可执行的小动作。",
    "引用：只在合适时引用道德经、金刚经、心经等经典；引用必须短，并写清楚出处。不要编造不存在的章句。",
    "边界：不要医疗诊断、法律/金融建议；遇到危险或自伤内容，温和建议立刻找身边可信的人或当地紧急服务。",
    "长度：中文 2 到 4 句即可。不要主动长篇追问。不要使用列表格式。",
    activity,
    lesson,
    memories
  ].filter(Boolean).join("\n");
}

function geminiContents(message: string, body: ChatRequestBody) {
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  const contents = history
    .map((item) => {
      const text = cleanText(item.text, 700);
      if (!text) return null;
      return {
        role: item.role === "model" ? "model" : "user",
        parts: [{ text }]
      };
    })
    .filter(Boolean) as Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;

  contents.push({
    role: "user",
    parts: [{ text: message }]
  });

  return contents;
}

function extractGeminiText(responseBody: Record<string, unknown>) {
  const candidates = responseBody.candidates as Array<Record<string, unknown>> | undefined;
  const parts = candidates?.[0]?.content && (candidates[0].content as Record<string, unknown>).parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("")
    .trim();
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequestBody;
    const message = cleanText(body.message, 1000);
    if (!message) throw new HttpError(400, "请输入一句话");

    const isPaid = await paidFromRequest(request);
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": geminiApiKey()
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt(isPaid, body) }]
          },
          contents: geminiContents(message, body),
          generationConfig: {
            temperature: 0.72,
            topP: 0.88,
            maxOutputTokens: 1024,
            thinkingConfig: {
              thinkingBudget: 0
            }
          }
        })
      }
    );

    const responseBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new HttpError(response.status, "Gemini 暂时没有回音");
    }

    const reply = extractGeminiText(responseBody);
    if (!reply) throw new HttpError(502, "Gemini 没有返回文本");

    return NextResponse.json({ ok: true, reply, model });
  } catch (error) {
    return jsonError(error);
  }
}
