DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'notifications'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%severity%'
  LOOP
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_severity_check
  CHECK (severity IN ('info', 'warning', 'success', 'critical'));
