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
import { createClient } from "npm:@supabase/supabase-js@2";

// Quota per signed-in user. Vision calls are billed to the site owner's
// Anthropic key, so these are the ceiling on what one account can spend.
// A real athlete logs one or two pieces a day; anything near these numbers is
// either testing or abuse. Override without redeploying via secrets.
const DAILY_LIMIT = Number(Deno.env.get("PARSE_ERG_DAILY_LIMIT") || 20);
const MONTHLY_LIMIT = Number(Deno.env.get("PARSE_ERG_MONTHLY_LIMIT") || 150);

// Reading a dense PM5 split table is a hard vision task, so this runs on a
// top-tier model - accuracy matters more than the couple of pence per photo,
// and a wrong split silently poisons the athlete's history. Set
// PARSE_ERG_MODEL to "claude-sonnet-5" to trade some accuracy for cost.
const MODEL = Deno.env.get("PARSE_ERG_MODEL") || "claude-opus-5";

// Scratchpad for trialling a new reading rule without a redeploy:
//   supabase secrets set PARSE_ERG_EXTRA_RULES="- On the RP3, ..." --project-ref <ref>
// Appended to PROMPT below. Once a rule proves out, move it into PROMPT so it
// lives in git, and clear the secret with `supabase secrets unset`.
const EXTRA_RULES = (Deno.env.get("PARSE_ERG_EXTRA_RULES") || "").trim();

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

// ===================================================================
// THE READING RULES. This is the file to edit when the parser misreads
// a screen: add a rule, then `supabase functions deploy parse-erg`.
// ===================================================================
const PROMPT = `You are reading a photograph of a rowing machine monitor, usually a Concept2 PM5
but sometimes a RowPerfect/RP3. Transcribe the workout exactly as displayed and record it with
the record_erg_session tool. Take your time and read the digits carefully - the text is small
and a misread split silently corrupts the athlete's training history.

THE TWO PARTS OF THE SCREEN - GET THIS RIGHT FIRST
Almost every erg screen has two distinct parts, and they map to two different places in your
answer. Identify both before you transcribe anything:

1. THE HEADLINE - the whole piece in one line: total time, total distance, average /500m,
   average rate, sometimes average heart rate. It is set apart visually: larger digits, its own
   band, above or below a dividing rule, and usually with no row number against it. On a PM5 it
   often sits at the very top; on some memory screens it is the last line instead.
   -> The headline populates ONLY the top-level fields: total_time_s, distance_m, avg_split_s,
      avg_rate, avg_hr.

2. THE BREAKDOWN - the table underneath, one row per interval or split, usually numbered or
   time-stamped down the left.
   -> The breakdown populates ONLY the \`intervals\` array.

Never let the two cross over. The headline is NOT an interval - putting it in \`intervals\` is
the most damaging mistake you can make here, because it double counts the entire piece. Equally,
never promote a single breakdown row into the top-level fields.

If there is a headline and no breakdown, return an empty \`intervals\` array - that is a correct
answer, not a failure. If there is a breakdown but no readable headline, leave the top-level
fields null; the app derives them from the intervals. Do not add up the rows yourself.

A live, in-progress workout: transcribe what is shown and warn that the piece was unfinished.

READING THE BREAKDOWN TABLE
Columns run left to right and are typically: an index or elapsed time, distance in metres,
pace written as /500m, stroke rate written as s/m or spm, and heart rate if a belt is paired.
- The /500m column is a PACE (time to cover 500 metres), not the row's own elapsed time. Never
  put a pace into time_s, and never put an elapsed time into split_s. Confusing these two is
  the single most common mistake - check each row against its neighbours for consistency.
- Some screens repeat the totals as a final row of the table, or label a row TOTAL / AVG /
  AVERAGE. That is the headline again, not an interval - use it for the top-level fields and
  leave it out of \`intervals\`.
- Rest rows - often prefixed "r:" or showing rest time/distance - are not work intervals.
  Leave them out of \`intervals\` and note in warnings that rest rows were present.
- Transcribe interval rows top to bottom, in the order shown, and include every one of them.
  If rows are cut off by the edge of the photo, transcribe those you can read and warn that
  the list was truncated.

SANITY CHECKS BEFORE YOU ANSWER
- Do the interval distances roughly sum to the total distance? If they sum to about DOUBLE it,
  you have put the headline into \`intervals\` - remove it. If they fall short, you have missed
  a row - look again.
- Does any single interval equal the headline (same time, same distance)? If so it is the
  headline, not an interval.
- Is each pace plausible for rowing (about 1:20 to 2:30 per 500m)? A "pace" of 7:12 is almost
  certainly an elapsed time you have put in the wrong field.
- Is the total time roughly the sum of the interval times?
If a check fails and you cannot resolve it from the image, say so in warnings.

CONVERSIONS
- Every clock value becomes seconds: 7:12.3 -> 432.3, 1:48.1 -> 108.1, 20:00 -> 1200.
- Splits and paces are seconds per 500 metres. Distances are whole metres.

WHEN YOU CANNOT READ SOMETHING
Omit the field rather than guessing, and add a warning naming exactly what was unreadable and
why (glare, cropped, blurred, obscured by a finger). Never invent a plausible number, and never
calculate a value that is not shown - a blank field is easy for the athlete to fill in, a
confidently wrong one is not. Ignore menus, battery icons, logos and anything else that is not
workout data.`;

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

  // ---- identify the caller and enforce their quota ----
  // verify_jwt already rejected anonymous callers; this resolves *which* user,
  // so one account can't burn the owner's key. Counting and logging go through
  // the service role, so the user cannot reset their own quota.
  const authHeader = req.headers.get("Authorization") || "";
  const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(SUPA_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "Sign in to read erg photos." }, 401);

  const admin = createClient(SUPA_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Reading erg photos is the one paid feature - everything else in the tracker
  // is free and unlimited. Read the plan with the service role, never from
  // anything the client sent us.
  const { data: prof } = await admin
    .from("profiles")
    .select("tracker_plan, tracker_trial_ends_at")
    .eq("id", user.id)
    .single();

  const plan = prof?.tracker_plan || "free";
  const trialLive = plan === "trial" && prof?.tracker_trial_ends_at
    && new Date(prof.tracker_trial_ends_at) > new Date();
  if (plan !== "paid" && !trialLive) {
    return json({
      error: plan === "trial"
        ? "Your free trial has ended. Reading erg photos is part of the £5/month plan - " +
          "logging weights and typing erg sessions in stays free and unlimited."
        : "Reading erg photos is part of the £5/month plan. Logging weights and typing " +
          "erg sessions in by hand is free and unlimited.",
      reason: "upgrade_required",
    }, 402);
  }

  const since = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();
  const countSince = async (iso: string) => {
    const { count } = await admin
      .from("tracker_erg_parses")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", user.id)
      .gte("created_at", iso);
    return count ?? 0;
  };

  const [today, month] = await Promise.all([
    countSince(since(60 * 24)),
    countSince(since(60 * 24 * 30)),
  ]);
  if (today >= DAILY_LIMIT) {
    return json({
      error: `Daily limit reached (${DAILY_LIMIT} photos). It resets on a rolling 24 hours - ` +
        `enter this one by hand for now.`,
    }, 429);
  }
  if (month >= MONTHLY_LIMIT) {
    return json({
      error: `Monthly limit reached (${MONTHLY_LIMIT} photos). Enter this one by hand, ` +
        `or get in touch if you genuinely need a higher cap.`,
    }, 429);
  }

  const logParse = (ok: boolean, usage?: { input_tokens?: number; output_tokens?: number }) =>
    admin.from("tracker_erg_parses").insert({
      profile_id: user.id, model: MODEL, ok,
      input_tokens: usage?.input_tokens ?? null,
      output_tokens: usage?.output_tokens ?? null,
    });

  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

  // The API is stateless - nothing persists between photos, so the standing
  // rules are re-sent on every request. PROMPT is their home; EXTRA_RULES lets
  // a rule be trialled via `supabase secrets set` without a redeploy.
  const system = EXTRA_RULES
    ? PROMPT + "\n\nADDITIONAL RULES FROM THE OPERATOR\n" + EXTRA_RULES
    : PROMPT;

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system,
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
            { type: "text", text: "Transcribe this rowing machine monitor." },
          ],
        },
      ],
    });
  } catch (e) {
    // A refused or errored call can still have been billed, and logging it also
    // stops a failing loop from retrying forever on the owner's key.
    await logParse(false);
    if (e instanceof Anthropic.RateLimitError) {
      return json({ error: "Rate limited - try again in a minute." }, 429);
    }
    if (e instanceof Anthropic.APIError) {
      return json({ error: `Vision API error (${e.status}): ${e.message}` }, 502);
    }
    throw e;
  }
  await logParse(true, response.usage);

  if (response.stop_reason === "refusal") {
    return json({ error: "The image could not be processed." }, 422);
  }

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return json({ error: "No structured data returned - try a clearer photo." }, 422);
  }

  return json({ session: toolUse.input, model: response.model });
});
