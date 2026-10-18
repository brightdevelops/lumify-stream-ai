import { createEmailWebhookHandler } from '@lovable.dev/email-js'
import { createFileRoute } from '@tanstack/react-router'

type Reason = 'bounce' | 'complaint' | 'unsubscribe'
const STATUS: Record<Reason, string> = { bounce: 'bounced', complaint: 'complained', unsubscribe: 'suppressed' }
const MESSAGE: Record<Reason, string> = {
  bounce: 'Permanent bounce — email address is invalid or rejected',
  complaint: 'Spam complaint — recipient marked email as spam',
  unsubscribe: 'Recipient unsubscribed',
}

async function record(reason: Reason, event: any) {
  const email = String(event?.data?.recipient ?? '').toLowerCase()
  if (!email) return
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
  const { error: upErr } = await supabaseAdmin
    .from('suppressed_emails')
    .upsert({ email, reason, metadata: null } as any, { onConflict: 'email' })
  if (upErr) {
    console.error('suppressed_emails upsert failed', { code: upErr.code, message: upErr.message, event_id: event.event_id })
    throw new Error('Failed to write suppression')
  }
  const { error: logErr } = await supabaseAdmin.from('email_send_log').insert({
    message_id: null,
    template_name: 'system',
    recipient_email: email,
    status: STATUS[reason],
    error_message: MESSAGE[reason],
  } as any)
  if (logErr) {
    console.error('email_send_log insert failed', { code: logErr.code, message: logErr.message, event_id: event.event_id })
    throw new Error('Failed to write send log')
  }
}

export const Route = createFileRoute("/lovable/email/events")({
  server: {
    handlers: {
      POST: ({ request }) => {
        const apiKey = process.env['LOVABLE_API_KEY']
        if (!apiKey) {
          console.error('Missing required environment variables')
          return Response.json({ error: 'Server configuration error' }, { status: 500 })
        }
        const handler = createEmailWebhookHandler({
          apiKey,
          on: {
            'email.bounced': (event) => record('bounce', event),
            'email.complaint': (event) => record('complaint', event),
            'email.unsubscribed': (event) => record('unsubscribe', event),
          },
        })
        return handler(request)
      },
    },
  },
})
