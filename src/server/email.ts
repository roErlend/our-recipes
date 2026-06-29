import { createServerOnlyFn } from '@tanstack/react-start'
import nodemailer from 'nodemailer'

/**
 * Send a transactional email through Gmail's SMTP via Nodemailer. Server-only —
 * never import from the client (Nodemailer pulls in Node's net/tls).
 *
 * Requires env: GMAIL_USER (the sending Gmail address) and GMAIL_APP_PASSWORD
 * (a 16-char Google App Password — NOT the account password; needs 2FA on).
 * Optionally GMAIL_SENDER_NAME for the display name.
 */
export const sendEmail = createServerOnlyFn(
  async ({
    to,
    subject,
    html,
  }: {
    to: string
    subject: string
    html: string
  }) => {
    const user = process.env.GMAIL_USER
    // App passwords are shown in 4-char groups; tolerate pasted spaces.
    const pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, '')
    const senderName = process.env.GMAIL_SENDER_NAME ?? 'Våre oppskrifter'
    if (!user || !pass) {
      throw new Error(
        'E-post er ikke konfigurert (mangler GMAIL_USER / GMAIL_APP_PASSWORD).',
      )
    }

    const transport = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    })

    await transport.sendMail({
      from: `"${senderName}" <${user}>`,
      to,
      subject,
      html,
    })
  },
)

/** The signup verification email body. Plain, single call-to-action. */
export function verificationEmailHtml(name: string, url: string): string {
  const greeting = name ? `Hei ${name}!` : 'Hei!'
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #1c1917;">
      <h2 style="color: #2f9e5e;">Våre oppskrifter</h2>
      <p>${greeting}</p>
      <p>Bekreft e-postadressen din for å ta i bruk kontoen din.</p>
      <p style="margin: 24px 0;">
        <a href="${url}"
           style="background: #2f9e5e; color: #fff; text-decoration: none; padding: 12px 20px; border-radius: 8px; display: inline-block; font-weight: 600;">
          Bekreft e-post
        </a>
      </p>
      <p style="color: #78716c; font-size: 13px;">
        Funker ikke knappen? Lim inn denne lenken i nettleseren:<br />
        <a href="${url}">${url}</a>
      </p>
      <p style="color: #78716c; font-size: 13px;">
        Hvis du ikke opprettet en konto, kan du se bort fra denne e-posten.
      </p>
    </div>
  `
}
