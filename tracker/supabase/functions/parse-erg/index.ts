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
//
// FOUR THINGS STAND BETWEEN A STRANGER AND THE OWNER'S ANTHROPIC BILL, and all
// four are enforced here rather than in the app, because the app is a static
// file anyone can skip:
//   1. verify_jwt - no account, no call.
//   2. tracker_plan read with the SERVICE ROLE - the plan is never taken from
//      the request. It sets the daily allowance (2 on trial, 20 on paid),
//      not whether the reader works at all. NOTE: this is only as good as the
//      column grants. If `authenticated` still holds a blanket UPDATE on
//      public.profiles, any signed-in user can set tracker_plan='paid' on
//      themselves and take the larger allowance. Run PART 4 of
//      tracker_schema.sql.
//   3. Per-user quotas, counted from tracker_erg_parses, which the user cannot
//      write or clear.
//   4. A GLOBAL daily ceiling, plus PARSE_ERG_ENABLED=0 as a kill switch.
//      Per-user limits bound one account; only these two bound the bill.

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

// Quota per signed-in user. Vision calls are billed to the site owner's
// Anthropic key, so these are the ceiling on what one account can spend.
// A real athlete logs one or two pieces a day; anything near these numbers is
// either testing or abuse. Override without redeploying via secrets.
// Two kinds of member, and the daily allowance is the only difference
// between them. A trial is not a countdown - it is the smaller allowance,
// indefinitely - so nobody is ever refused the reader outright.
const TRIAL_DAILY_LIMIT = Number(Deno.env.get("PARSE_ERG_TRIAL_DAILY_LIMIT") || 2);
const PAID_DAILY_LIMIT = Number(Deno.env.get("PARSE_ERG_DAILY_LIMIT") || 20);
// Only ever binds a paid account: 2 a day cannot reach it.
const MONTHLY_LIMIT = Number(Deno.env.get("PARSE_ERG_MONTHLY_LIMIT") || 150);

// Ceiling across EVERYONE, not per user. Per-user limits bound what one
// account can spend; they do nothing about how many accounts there are. Twenty
// paid athletes at the per-user daily limit is 400 photos, and at roughly 5p a
// photo that is £20 in a day off one key. This is the number that decides the
// owner's worst case, so it is the one to set deliberately: at the default of
// 100 the most this function can cost in 24 hours is about £5.
const GLOBAL_DAILY_LIMIT = Number(Deno.env.get("PARSE_ERG_GLOBAL_DAILY_LIMIT") || 100);

// Kill switch. Something looking wrong at 11pm should be stoppable in one
// command, without a redeploy and without revoking the key the function needs:
//   supabase secrets set PARSE_ERG_ENABLED=0 --project-ref <ref>
// Anything other than 0/off/false leaves the feature on, so an unset secret,
// a typo or an empty string can never silently disable it.
const OFF = ["0", "off", "false", "no"]
  .includes((Deno.env.get("PARSE_ERG_ENABLED") || "on").trim().toLowerCase());

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

  // First, and before reading the body: an off switch that has to do any work
  // to take effect is not an off switch.
  if (OFF) {
    return json({
      error: "Photo reading is switched off at the moment. Enter this one by hand - " +
        "everything else in the tracker is unaffected.",
    }, 503);
  }

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

  // How many photos a day this account gets. Read with the SERVICE ROLE,
  // never from anything the client sent us.
  const { data: prof } = await admin
    .from("profiles")
    .select("tracker_plan")
    .eq("id", user.id)
    .single();

  const paid = prof?.tracker_plan === "paid";
  const DAILY_LIMIT = paid ? PAID_DAILY_LIMIT : TRIAL_DAILY_LIMIT;

  const since = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();
  // One helper, two questions: without a uid it is the whole site's usage,
  // with one it is that account's. No reassignment, so the builder's types
  // stay simple.
  const countSince = async (iso: string, uid?: string) => {
    const q = admin
      .from("tracker_erg_parses")
      .select("id", { count: "exact", head: true })
      .gte("created_at", iso);
    const { count } = await (uid ? q.eq("profile_id", uid) : q);
    return count ?? 0;
  };

  // The whole site's spend in the last 24 hours, checked before the caller's
  // own. A per-user limit cannot bound the owner's bill, because the number of
  // users is not fixed; this can.
  const globalToday = await countSince(since(60 * 24));
  if (globalToday >= GLOBAL_DAILY_LIMIT) {
    return json({
      error: "The site has hit its daily limit for reading erg photos. It resets on a rolling " +
        "24 hours - enter this one by hand for now.",
      reason: "site_limit",
    }, 429);
  }

  const [today, month] = await Promise.all([
    countSince(since(60 * 24), user.id),
    countSince(since(60 * 24 * 30), user.id),
  ]);
  if (today >= DAILY_LIMIT) {
    return json({
      error: paid
        ? `Daily limit reached (${DAILY_LIMIT} photos). It resets on a rolling 24 hours - ` +
          `enter this one by hand for now.`
        : `That is your ${DAILY_LIMIT} photo${DAILY_LIMIT === 1 ? "" : "s"} for today. It resets ` +
          `on a rolling 24 hours, and £5 a month lifts it to ${PAID_DAILY_LIMIT} a day. Typing ` +
          `sessions in by hand is free and unlimited either way.`,
      reason: paid ? "daily_limit" : "upgrade_available",
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
      // 401/403 from Anthropic means the key is wrong, revoked or out of
      // credit. That is an operator problem and there is nothing the athlete
      // can do about it, so it is reported as "switched off" - the state the
      // app already knows how to present calmly - rather than as a raw upstream
      // error. It also stops "api key is invalid" being echoed to end users.
      // The detail goes to the function logs, which is where it is fixed:
      //   supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref <ref>
      if (e.status === 401 || e.status === 403) {
        console.error("parse-erg: Anthropic rejected the key", e.status, e.message);
        return json({
          error: "The photo reader is not available at the moment. Enter this one by hand - " +
            "everything else in the tracker is unaffected.",
        }, 503);
      }
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
