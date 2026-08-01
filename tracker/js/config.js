// Supabase project credentials for the RowingTools tracker. Same project as
// the coach dashboard (data isolation is per-user via RLS, not per-app).
//
// The anon (publishable) key is safe to ship publicly - Row Level Security
// is what actually protects the data. Do NOT put the service_role key here.
const SUPABASE_URL      = 'https://tbhujqdflswhgxtioznb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_w7S4zu5bigoSZx55fDHjyg_81VjU6lh';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Edge Function endpoint for erg-photo parsing.
const PARSE_ERG_URL = SUPABASE_URL + '/functions/v1/parse-erg';
