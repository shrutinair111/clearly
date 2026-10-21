// Clearly's tiny server: it receives the user's question, asks Gemini,
// and streams Gemini's answer back to the app as plain text.
// The API key lives only here (on the server), never in the browser.

const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const BASE_URL =
  process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";

// The fixed shape we ask Gemini to answer in. Clearly reads it line by line,
// so it knows exactly when each section is finished.
const INSTRUCTIONS = `You are the answer engine for Clearly, an app that reads answers aloud to screen reader users.
Reply ONLY in this exact line format. No markdown, no bullet symbols, no blank lines, no other text.
TITLE: a short title for the answer, under 10 words
STEP: a short title for this step or part | one or two plain sentences explaining it
(write between 2 and 6 STEP lines, in a sensible order)
SUMMARY: one sentence that sums up the whole answer
Always write every STEP line before the SUMMARY line. Use plain, friendly language that is easy to listen to.`;

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response("Missing GEMINI_API_KEY", { status: 500 });
  }

  let question = "";
  try {
    const body = (await request.json()) as { question?: unknown };
    question = String(body?.question ?? "").slice(0, 2000);
  } catch {
    // Leave question empty; handled below.
  }
  if (!question.trim()) {
    return new Response("Missing question", { status: 400 });
  }

  const upstream = await fetch(
    `${BASE_URL}/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
        contents: [{ role: "user", parts: [{ text: question }] }],
      }),
      signal: request.signal,
    }
  );

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return new Response(`Gemini error ${upstream.status}: ${detail.slice(0, 300)}`, {
      status: 502,
    });
  }

  // Gemini sends "server-sent events": lines that start with "data: {json}".
  // We pull the text out of each one and pass just the text along.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // Keep reading until we have some text to pass along (or Gemini is done)
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        let sent = false;
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const data = JSON.parse(line.slice(5).trim());
            const parts: { text?: string }[] = data?.candidates?.[0]?.content?.parts ?? [];
            const text = parts.map((part) => part.text ?? "").join("");
            if (text) {
              controller.enqueue(encoder.encode(text));
              sent = true;
            }
          } catch {
            // Ignore anything that isn't a complete JSON chunk.
          }
        }
        if (sent) return;
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
