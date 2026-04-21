-- Revert script for migration 20260421001043_scope_raw_imports_bucket.sql
--
-- USE WITH CAUTION: this restores the public bucket + open SELECT policy
-- documented in audit F-2-02. Only run if a downstream consumer breaks
-- specifically due to the new path-prefix discipline.

update storage.buckets set public = true where id = 'raw-imports';

drop policy if exists "raw-imports org-member select" on storage.objects;
drop policy if exists "raw-imports org-member insert" on storage.objects;
drop policy if exists "raw-imports org-member delete" on storage.objects;

create policy "Public Access"
  on storage.objects for select
  using ( bucket_id = 'raw-imports' );

create policy "Authenticated Upload"
  on storage.objects for insert
  with check ( bucket_id = 'raw-imports' and auth.role() = 'authenticated' );
