/* ============================================================
   PIPVANT — Supabase connection (public values only)
   ------------------------------------------------------------
   NOTE: config.js is the OROVANTA brand single-source-of-truth,
   so backend credentials live here instead of overwriting it.
   The anon key is public by design (it ships in the frontend);
   RLS policies — not this key — protect user data.
   NEVER put the service_role key or DB password in this file.
   ============================================================ */
window.PV_CONFIG = {
  url: 'https://bnsuiutodpbgvkupgwrk.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJuc3VpdXRvZHBiZ3ZrdXBnd3JrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4OTgwNzAsImV4cCI6MjEwNjQ3NDA3MH0.i6sYtDrf7SYpepwiH1S9L4pOu14z46dTGQPeZuo6HX8'
};
