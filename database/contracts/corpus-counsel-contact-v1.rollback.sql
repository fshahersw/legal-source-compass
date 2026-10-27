-- Rollback for corpus-counsel-contact-v1.sql: the function did not exist before (checked 2026-10-27: no public function named like
-- %counsel% or %attorney%). Dropping it restores the 2026-10-03 state (counsel published as name, firm and role only).
drop function if exists public.corpus_counsel_contact_v1(text[], text, integer);
