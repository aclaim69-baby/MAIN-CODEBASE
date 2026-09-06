# Production readiness - current status

## Release decision

**NO-GO until the migration is applied to staging and the direct API tests below pass.** This repository previously relied on browser state and anonymous Supabase policies; source changes alone cannot secure an already-deployed database.

## Authoritative deployment path

Apply `supabase/migrations/202609060001_security_baseline.sql` through the Supabase migration workflow. Do not run any legacy `supabase/*.sql` repair/setup script in production; they contain contradictory, anonymous-access policies and hard-coded bootstrap data.

Before rollout, provision administrators in Supabase Auth and create their `public.profiles` rows through a service-role-only administrative workflow. There is deliberately no default credential or client-side password migration path.

## Required direct API checks

| Test | Expected |
| --- | --- |
| Anonymous select/update/delete records | Denied |
| Anonymous select/mutate admins and settings | Denied |
| Authenticated technician creates own record | Allowed |
| Technician updates/deletes a record | Denied |
| Junior/senior update record | Allowed; delete only senior/super-admin |
| Super-admin updates settings/profiles | Allowed |
| Anonymous evidence list/read/upload/delete | Denied |
| Authenticated non-owner evidence delete | Denied unless privileged |
| Client insert/update/delete activity log | Denied |

## Known release blockers

1. The current admin-management UI still calls the legacy `admins` table. It must be replaced with a protected server/Edge Function that uses the service role and writes audit events; do not deploy that UI path after the migration.
2. Existing client record writes must set `created_by` and `updated_by` from the authenticated session before rollout.
3. There are no automated RLS, unit, or E2E tests yet, and no CI pipeline.
4. The offline queue now preserves submissions rather than dropping them, but it remains localStorage-backed; migrate it to IndexedDB and add persistence/reconnect tests before a production GO.
