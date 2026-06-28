-- The pre-existing `notebook_store` table had a single `allow_all` policy
-- (USING true, WITH CHECK true) — anyone holding the public anon key could
-- read AND overwrite every row, including notebook_password. Replace it with
-- key-scoped policies: anon keeps read/write on every key EXCEPT
-- 'notebook_password', which only the service role (used by /api/auth) can
-- touch.

drop policy if exists allow_all on notebook_store;

create policy anon_select_notebook on notebook_store
  for select
  using (key <> 'notebook_password');

create policy anon_insert_notebook on notebook_store
  for insert
  with check (key <> 'notebook_password');

create policy anon_update_notebook on notebook_store
  for update
  using (key <> 'notebook_password')
  with check (key <> 'notebook_password');
