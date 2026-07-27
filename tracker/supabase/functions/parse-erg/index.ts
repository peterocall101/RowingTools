// parse-erg - Supabase Edge Function
//
// Accepts { image: <base64 jpeg/png>, media_type } from the tracker frontend,
// sends it to Claude vision with a forced structured-output tool, and returns
// { session: {...} } matching the tracker_erg_sessions shape. The Anthropic
// key lives only here (ANTHROPIC_API_KEY secret) - never in the static site.
//
// Deploy (from repo root):
//   supabase functions deploy parse-erg --project-ref tbhujqdflswhgxtioznb
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref tbhujqdflswhgxtioznb
//
// JWT verification is ON by default, so only signed-in tracker users can call it.

import Anthropic from "npm:@anthropic-ai/sdk";

// Haiku keeps per-photo cost negligible for free-trial users; override with
// PARSE_ERG_MODEL (e.g. "claude-opus-5") if extraction quality needs a bump.
const MODEL = Deno.env.get("PARSE_ERG_MODEL") || "claude-haiku-4-5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// Only `intervals` and `warnings` are required: every scalar is omitted when it
// isn't legible on screen, which the frontend renders as a blank field for the
// athlete to fill in. Forced tool_choice is what guarantees structured output -
// deliberately not using `strict`, whose schema subset excludes the nullable
// union types this shape would otherwise want.
const ERG_TOOL: Anthropic.Tool = {
  name: "record_erg_session",
  description:
    "Record the rowing machine session data read from the monitor photo.",
  input_schema: {
    type: "object",
    required: ["intervals", "warnings"],
    properties: {
      erg_type: {
        type: "string",
        enum: ["concept2", "rowperfect"],
        description: "Which machine the monitor belongs to, if identifiable.",
      },
      session_type: {
        type: "string",
        description:
          "Short label for the workout if evident, e.g. '2000m', '8x500m', '30:00'.",
      },
      total_time_s: {
        type: "number",
        description: "Total elapsed time in seconds, e.g. 7:12.3 -> 432.3.",
      },
      distance_m: { type: "integer", description: "Total distance in metres." },
      avg_split_s: {
        type: "number",
        description: "Average split in seconds per 500m, e.g. 1:48.1 -> 108.1.",
      },
      avg_rate: { type: "integer", description: "Average stroke rate (spm)." },
      avg_hr: { type: "integer", description: "Average heart rate (bpm), if shown." },
      intervals: {
        type: "array",
        description:
          "One entry per interval/split row shown on the monitor, top to bottom. Empty array if no per-interval rows are visible.",
        items: {
          type: "object",
          properties: {
            time_s: { type: "number", description: "Interval time in seconds." },
            distance_m: { type: "integer" },
            split_s: {
              type: "number",
              description: "Split for this interval in seconds per 500m.",
            },
            rate: { type: "integer" },
            hr: { type: "integer" },
          },
        },
      },
      warnings: {
        type: "array",
        items: { type: "string" },
        description:
          "Short notes about anything unreadable, ambiguous, or guessed - e.g. 'last split row partially cut off'. Empty array if the whole screen was clear.",
      },
    },
  },
};

const PROMPT = `This is a photo of a rowing machine monitor (a Concept2 PM5 or a RowPerfect screen).
Read the workout data off the screen and record it with the record_erg_session tool.

Rules:
- Convert all clock values to seconds (1:48.1 means 108.1 seconds; 7:12.3 means 432.3).
- Splits are always seconds per 500m.
- A Concept2 summary screen typically shows total time, total metres, average /500m and rate at
  the top, then one row per interval or split below - transcribe each row in order.
- Only record what you can actually read. Omit any field that is not shown or not legible, and
  add a warning describing what you could not read. Never invent plausible numbers.
- Ignore anything on screen that is not workout data (menus, battery, logos).`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const { image, media_type } = await req.json();
  if (typeof image !== "string" || image.length < 100) {
    return json({ error: "Missing image (base64 string expected)." }, 400);
  }
  if (image.length > 8_000_000) {
    return json({ error: "Image too large - resize before uploading." }, 413);
  }
  const mediaType = ["image/jpeg", "image/png", "image/webp"].includes(media_type)
    ? media_type
    : "image/jpeg";

  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      tools: [ERG_TOOL],
      tool_choice: { type: "tool", name: "record_erg_session" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: image },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      return json({ error: "Rate limited - try again in a minute." }, 429);
    }
    if (e instanceof Anthropic.APIError) {
      return json({ error: `Vision API error (${e.status}): ${e.message}` }, 502);
    }
    throw e;
  }

  if (response.stop_reason === "refusal") {
    return json({ error: "The image could not be processed." }, 422);
  }

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return json({ error: "No structured data returned - try a clearer photo." }, 422);
  }

  return json({ session: toolUse.input, model: response.model });
});
