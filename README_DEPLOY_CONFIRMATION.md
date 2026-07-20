# YourBabalawo Applicant Intake Confirmation Package

This package adds a secure applicant review-and-confirm step between the
divination intake and payment.

## Final workflow

```text
/intake.html
    ↓ submit to /api/intake
D1 status: submitted
    ↓
/confirmation.html?token=PRIVATE_RANDOM_TOKEN
    ↓ applicant reviews or corrects the information
/api/intake/confirm
    ↓
D1 status: confirmed
    ↓
/payment.html?intake=KOL-YYYY-XXXXXXXX
```

The private token is random, stored only as a SHA-256 hash in D1, valid for
48 hours, and invalidated after the applicant confirms the intake.

## Files included

```text
intake.html
confirmation.html
payment.html
functions/api/intake.js
functions/api/intake/confirmation.js
functions/api/intake/confirm.js
functions/api/intake/edit.js
migrations/0003_add_intake_confirmation.sql
VERIFY_INTAKE_CONFIRMATION.sql
ADMIN_STATUS_UPDATE.txt
```

`payment.html` is the current four-service page with Cash App above PayPal for
each service.

## 1. Back up the repository

Download or clone the repository connected to the YourBabalawo Cloudflare Pages
project before replacing files.

Do not delete unrelated public pages, images, the SGI application, admin APIs,
or the existing `SwamiG.gif` and `favicon.ico`.

## 2. Confirm the required D1 table

In Cloudflare:

```text
Workers & Pages
→ D1
→ yourbabalawo-db
→ Console
```

Run:

```sql
PRAGMA table_info(intake_submissions);
```

The existing table must already contain fields such as:

```text
id
created_at
updated_at
status
full_name
email
phone
primary_reason
question_1
raw_json
```

This package extends that existing table. It does not replace it.

## 3. Run the migration once

Paste and run the complete contents of:

```text
migrations/0003_add_intake_confirmation.sql
```

Do not run the migration a second time after the columns exist. SQLite will
report a duplicate-column error if an `ALTER TABLE ... ADD COLUMN` statement is
repeated.

Confirm the new fields:

```sql
PRAGMA table_info(intake_submissions);
```

Required new fields:

```text
public_reference
confirmation_token_hash
token_expires_at
confirmed_at
payment_status
payment_method
payment_reference
```

## 4. Upload the files

Merge the package into the repository root and preserve the folder structure:

```text
functions/
  api/
    intake.js
    intake/
      confirmation.js
      confirm.js
      edit.js
```

Allow these files to replace the current versions:

```text
intake.html
payment.html
functions/api/intake.js
```

Add these new files:

```text
confirmation.html
functions/api/intake/confirmation.js
functions/api/intake/confirm.js
functions/api/intake/edit.js
```

## 5. Confirm Cloudflare settings

In the same Pages project, confirm:

```text
D1 binding name: DB
D1 database: yourbabalawo-db
```

In **Settings → Variables and Secrets**, retain:

```text
TURNSTILE_SECRET_KEY          encrypted secret
TURNSTILE_EXPECTED_HOSTNAME   yourbabalawo.com
ADMIN_TOKEN                   encrypted secret
```

The public Turnstile site key remains in `intake.html`:

```text
0x4AAAAAAD0vcjPOTQq4vYsS
```

Never place the Turnstile secret key in HTML, GitHub, or a public ZIP.

## 6. Redeploy

Create a new production deployment after uploading the files and applying the
D1 migration.

## 7. Test the complete workflow

1. Open `https://yourbabalawo.com/intake.html`.
2. Submit a test intake.
3. Confirm that the browser opens `confirmation.html`.
4. Verify that all submitted information appears.
5. Select **Make Corrections**, change one field, and save.
6. Confirm that the corrected value appears on the review page.
7. Check the accuracy box and select **Confirm My Intake**.
8. Confirm that the browser opens the payment page with the public reference:
   `payment.html?intake=KOL-YYYY-XXXXXXXX`.
9. Confirm the payment page displays the same intake number.

## 8. Check D1

Run the complete contents of:

```text
VERIFY_INTAKE_CONFIRMATION.sql
```

A newly submitted but unconfirmed row should show:

```text
status = submitted
public_reference = KOL-YYYY-XXXXXXXX
confirmation_token_hash = a SHA-256 hexadecimal value
token_expires_at = a future UTC timestamp
confirmed_at = NULL
```

After applicant confirmation:

```text
status = confirmed
confirmed_at = a UTC timestamp
confirmation_token_hash = NULL
token_expires_at = NULL
payment_status = unpaid
```

The interaction log should contain:

```text
intake_submitted
intake_corrected     -- only when corrections were saved
intake_confirmed
```

## 9. Admin-page status options

Read `ADMIN_STATUS_UPDATE.txt`. Add `submitted` and `confirmed` to the status
options in the existing protected intake admin page.

## Privacy and security behavior

- The internal D1 row UUID is never exposed to the applicant.
- The applicant receives a separate `KOL-...` public reference.
- The private review token is stored in D1 only as a SHA-256 hash.
- The review and edit APIs use `Cache-Control: no-store`.
- The token is valid for 48 hours and is invalidated after confirmation.
- Applicant edits are blocked after confirmation.
- The correction URL must not be emailed, posted publicly, or placed in
  analytics logs.
- Confirmation details are rendered with `textContent`, not untrusted HTML.

## Existing records

Old intake rows remain intact, but they will not automatically receive a public
reference or confirmation token. The new workflow applies to submissions made
after deployment.
