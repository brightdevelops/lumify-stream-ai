import * as React from 'react'
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  userEmail?: string
  subject?: string
  message?: string
  submittedAt?: string
}

const Email = ({ userEmail, subject, message, submittedAt }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`New support message from ${userEmail ?? 'a user'}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>New Support Message</Heading>
        <Text style={muted}>
          A user just submitted a message through the Lumify Contact Support form.
        </Text>

        <Section style={card}>
          <Text style={label}>From</Text>
          <Text style={value}>{userEmail ?? 'Unknown'}</Text>

          <Hr style={hr} />

          <Text style={label}>Subject</Text>
          <Text style={value}>{subject ?? '(no subject)'}</Text>

          <Hr style={hr} />

          <Text style={label}>Message</Text>
          <Text style={{ ...value, whiteSpace: 'pre-wrap' }}>
            {message ?? ''}
          </Text>

          {submittedAt ? (
            <>
              <Hr style={hr} />
              <Text style={label}>Submitted</Text>
              <Text style={value}>{submittedAt}</Text>
            </>
          ) : null}
        </Section>

        <Text style={muted}>
          Reply directly to <strong>{userEmail ?? 'the user'}</strong> from your inbox,
          or open the Inventor → Support panel in Lumify to respond in-app.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (data: Record<string, any>) =>
    `[Lumify Support] ${data.subject || 'New message'} — from ${data.userEmail || 'user'}`,
  displayName: 'Support Notification (Admin)',
  to: 'lumifysupport@gmail.com',
  previewData: {
    userEmail: 'user@example.com',
    subject: 'Cannot start stream',
    message: 'Hi, I keep getting an error when I click Start Stream…',
    submittedAt: new Date().toISOString(),
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
}
const container = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '22px', fontWeight: 600, color: '#111827', margin: '0 0 8px' }
const muted = { fontSize: '14px', color: '#6b7280', lineHeight: '20px' }
const card = {
  backgroundColor: '#f9fafb',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  padding: '20px',
  margin: '20px 0',
}
const label = {
  fontSize: '11px',
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  margin: '0 0 4px',
}
const value = { fontSize: '14px', color: '#111827', margin: '0 0 4px', lineHeight: '22px' }
const hr = { borderColor: '#e5e7eb', margin: '14px 0' }
