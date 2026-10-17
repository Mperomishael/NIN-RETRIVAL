# Branded email setup

Supabase sends all authentication emails. Make them yours in three steps.

## 1. Templates
Supabase Dashboard > Authentication > Email Templates. For each template, paste the matching file and set the subject.

| Template | File | Subject |
|---|---|---|
| Confirm signup | `confirm-signup.html` | Confirm your TopVerify email |
| Reset password | `reset-password.html` | Reset your TopVerify password |
| Magic link | `magic-link.html` | Your TopVerify sign-in link |
| Change email | `change-email.html` | Confirm your new email address |
| Invite user | `invite.html` | You have been invited to TopVerify |

The links point to `/auth/verified` on your site, which shows the animated verified (or expired) page.

## 2. URL configuration
Authentication > URL Configuration:
- **Site URL**: your live domain, for example `https://app.yourdomain.com` (the templates and logo use it).
- Add the same domain to **Redirect URLs**.

## 3. Custom sender (this is what removes "Supabase")
Authentication > SMTP Settings > enable custom SMTP. Example with Resend:
- Host `smtp.resend.com`, port `465`, username `resend`, password = your Resend API key
- Sender email `no-reply@yourdomain.com`, sender name `TopVerify`

Verify your domain with the provider first (SPF and DKIM records) so mail reaches the inbox. Supabase's built-in sender is rate-limited to a few emails per hour, so custom SMTP is required for real signups.
