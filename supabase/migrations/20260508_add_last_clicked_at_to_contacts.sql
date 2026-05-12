-- ================================================================
-- Add last_clicked_at to customer_contacts
-- Replaces the incorrect use of last_sms_sent_at on SMS link clicks.
-- last_sms_sent_at is the frequency-cap field and must not be written
-- on click. last_clicked_at is a dedicated click timestamp.
-- ================================================================

ALTER TABLE public.customer_contacts
  ADD COLUMN IF NOT EXISTS last_clicked_at TIMESTAMPTZ;

COMMENT ON COLUMN public.customer_contacts.last_clicked_at
  IS 'Timestamp of the most recent tracked SMS link click for this contact. Set by sms-redirect. Does not affect frequency cap logic (that uses last_sms_sent_at).';
