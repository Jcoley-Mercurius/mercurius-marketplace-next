-- CFG-010: one business day is eight support hours, M-F 09:00-17:00 Eastern.
ALTER TABLE public.support_tickets ADD COLUMN response_due_at timestamptz;
CREATE FUNCTION private.support_response_deadline(_at timestamptz) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=public,pg_temp AS $$
DECLARE local_at timestamp := _at AT TIME ZONE 'America/New_York'; remaining interval:=interval '8 hours'; available interval;
BEGIN
  LOOP
    IF extract(isodow FROM local_at)>5 OR local_at::time>=time '17:00' THEN
      local_at:=date_trunc('day',local_at)+interval '1 day 9 hours'; CONTINUE;
    END IF;
    IF local_at::time<time '09:00' THEN local_at:=date_trunc('day',local_at)+interval '9 hours'; END IF;
    available:=date_trunc('day',local_at)+interval '17 hours'-local_at;
    IF remaining<=available THEN RETURN (local_at+remaining) AT TIME ZONE 'America/New_York'; END IF;
    remaining:=remaining-available;
    local_at:=date_trunc('day',local_at)+interval '1 day 9 hours';
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.support_response_deadline(timestamptz) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION private.route_support_ticket() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE local_now timestamp:=now() AT TIME ZONE 'America/New_York'; appointment date;
BEGIN
  NEW.queue_owner:='project_owner';
  NEW.next_action:=CASE WHEN NULLIF(btrim(NEW.next_action),'') IS NOT NULL THEN NEW.next_action ELSE
    CASE NEW.issue_type
      WHEN 'dispute' THEN 'Review completion evidence and contact both parties'
      WHEN 'dispute_appeal' THEN 'Review the prior resolution and homeowner appeal'
      WHEN 'review_appeal' THEN 'Review original content and moderation reason'
      WHEN 'schedule_exception' THEN 'Review service exception, replacement options and policy consequences'
      ELSE 'Review and respond to the customer' END
    END;
  NEW.priority:='standard';
  NEW.response_due_at:=private.support_response_deadline(now());
  SELECT COALESCE((scheduled_start_at AT TIME ZONE 'America/New_York')::date,preferred_date)
    INTO appointment FROM public.service_requests WHERE id::text=NEW.job_id AND customer_id=NEW.user_id;
  IF appointment=local_now::date AND extract(isodow FROM local_now)<=5 AND local_now::time>=time '09:00' AND local_now::time<time '17:00' THEN
    NEW.priority:='same_day'; NEW.response_due_at:=(local_now::date+time '17:00') AT TIME ZONE 'America/New_York';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.route_support_ticket() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER route_support_ticket BEFORE INSERT ON public.support_tickets FOR EACH ROW EXECUTE FUNCTION private.route_support_ticket();
CREATE OR REPLACE FUNCTION private.protect_ticket_queue_fields() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF current_user='authenticated' AND (NEW.queue_owner,NEW.next_action,NEW.priority,NEW.response_due_at) IS DISTINCT FROM (OLD.queue_owner,OLD.next_action,OLD.priority,OLD.response_due_at) THEN
    RAISE EXCEPTION 'Queue ownership and routing require an authorized workflow' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
