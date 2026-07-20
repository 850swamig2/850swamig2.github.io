-- Verify the applicant intake review-and-confirm workflow.

PRAGMA table_info(intake_submissions);

SELECT
  id,
  public_reference,
  status,
  created_at,
  updated_at,
  confirmed_at,
  token_expires_at,
  payment_status,
  full_name,
  email
FROM intake_submissions
ORDER BY created_at DESC
LIMIT 10;

SELECT
  status,
  COUNT(*) AS total
FROM intake_submissions
GROUP BY status
ORDER BY status;

SELECT
  event_type,
  COUNT(*) AS total
FROM interaction_log
WHERE event_type IN (
  'intake_submitted',
  'intake_corrected',
  'intake_confirmed'
)
GROUP BY event_type
ORDER BY event_type;
