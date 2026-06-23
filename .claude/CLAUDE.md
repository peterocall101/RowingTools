# RowingTools Dashboard - Claude Instructions

## Database Schema Management

**Critical rule:** Any database migration (new tables, functions, RLS policies) MUST be added to `dashboard/supabase/schema.sql` immediately after writing the SQL code.

**Why:** schema.sql is the source of truth for a clean database setup. If you provide raw SQL for the user to run, also update schema.sql so it stays in sync. This prevents the two from diverging.

**How to apply:**
- When creating new tables/functions/policies: write the SQL, test it, then add it to schema.sql in the appropriate section
- When fixing SQL bugs: update both the SQL provided to the user AND the corresponding function/table definition in schema.sql
- Before finishing a database task: verify schema.sql reflects all changes

## Project Structure

- `dashboard/` - HTML/JS frontend (Supabase-backed SaaS)
- `dashboard/supabase/schema.sql` - authoritative database schema
- `dashboard/js/` - modules (auth, ui, time, benchmarks, programme, results, etc.)
- `data/` - static data (all_results.json, benchmarks_v3.json)
- `gmt_processor/` - Python backend for GMT calculations

## Key Modules

- **benchmarks.js** - load/manage benchmark sets (WBT, Met, custom), convert times, calculate GMT%
- **programme.js/programme-doc.js** - training programme builder (weekly grid) + PDF export
- **results.js** - log/import results, tag athletes, show splits/GMT%
- **clubdata.js** - fetch public regatta results from `/data/all_results.json`
- **weather.js** - fetch conditions via Open-Meteo, cache on results

## Testing

- Server: `python -m http.server 8000 --bind 127.0.0.1` from `RowingTools/` root
- Dashboard: http://localhost:8000/dashboard/login.html
- Supabase project: configured in `dashboard/js/config.js`
