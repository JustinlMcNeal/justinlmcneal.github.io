-- CTA Label Prints: allow authenticated admins to read print history.
-- Phase 2F Labels tab reads cta_label_prints in the admin browser.
-- Inserts are handled by the track-cta-label-print Edge Function with service role.

alter table public.cta_label_prints enable row level security;

drop policy if exists "cta_label_prints_authenticated_insert"
  on public.cta_label_prints;

drop policy if exists "cta_label_prints_authenticated_select"
  on public.cta_label_prints;

create policy "cta_label_prints_authenticated_select"
  on public.cta_label_prints
  for select
  to authenticated
  using (true);

drop policy if exists "cta_label_prints_service_role_all"
  on public.cta_label_prints;

create policy "cta_label_prints_service_role_all"
  on public.cta_label_prints
  for all
  to service_role
  using (true)
  with check (true);
