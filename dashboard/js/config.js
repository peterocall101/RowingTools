// Supabase project credentials for the RowingTools dashboard.
// Get these from: supabase.com -> RowingTools project -> Settings -> API
//
// The anon (publishable) key is safe to ship publicly - Row Level Security
// is what actually protects the data. Do NOT put the service_role key here.
const SUPABASE_URL      = 'https://tbhujqdflswhgxtioznb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_w7S4zu5bigoSZx55fDHjyg_81VjU6lh';

// True once real credentials are filled in (guards the app on a fresh clone).
const SUPABASE_ENABLED = !SUPABASE_URL.includes('YOUR_PROJECT');

const sb = SUPABASE_ENABLED ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
