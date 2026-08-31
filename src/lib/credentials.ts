// The app's public identity is now just "Phone Number" -- this file is
// the ONLY place that translates a phone number into what Supabase Auth
// actually needs (a fake but valid-looking email). The login screen and
// the admin provisioning flow both import this so they can never drift
// out of sync.
//
// Passwords are now set directly by admin when creating a teacher (or
// via the "Reset password" action) -- there is no derivation for
// passwords anymore. An earlier version derived the password from the
// phone number itself, which was barely a secret since phone numbers
// are already known around the school; a real admin-set password fixes
// that.

export function phoneToEmail(phoneNumber: string): string {
  return `${phoneNumber.trim().replace(/\s+/g, "")}@jssportal.internal`;
}
