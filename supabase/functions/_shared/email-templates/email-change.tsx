/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface EmailChangeEmailProps {
  siteName: string
  email: string
  newEmail: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({
  siteName,
  email,
  newEmail,
  confirmationUrl,
}: EmailChangeEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email change for Xettle</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img
          src="https://cegwclxbqvitkqxikpss.supabase.co/storage/v1/object/public/email-assets/xettle-logo.png"
          alt="Xettle"
          width="120"
          height="40"
          style={{ marginBottom: '24px' }}
        />
        <Heading style={h1}>Confirm your email change</Heading>
        <Text style={text}>
          You requested to change your email address from{' '}
          <Link href={`mailto:${email}`} style={link}>
            {email}
          </Link>{' '}
          to{' '}
          <Link href={`mailto:${newEmail}`} style={link}>
            {newEmail}
          </Link>
          .
        </Text>
        <Text style={text}>
          Click the button below to confirm this change:
        </Text>
        <Button style={button} href={confirmationUrl}>
          Confirm Email Change
        </Button>
        <Text style={footer}>
          If you didn't request this change, please secure your account
          immediately.
        </Text>
      </Container>
    </Body>
  </Html>
)

export default EmailChangeEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'Inter', 'Space Grotesk', Arial, sans-serif" }
const container = { padding: '32px 28px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: 'hsl(210, 40%, 6%)',
  margin: '0 0 20px',
}
const text = {
  fontSize: '14px',
  color: 'hsl(210, 9%, 46%)',
  lineHeight: '1.6',
  margin: '0 0 25px',
}
const link = { color: 'inherit', textDecoration: 'underline' }
const button = {
  backgroundColor: 'hsl(197, 74%, 52%)',
  color: '#ffffff',
  fontSize: '14px',
  fontWeight: '600' as const,
  borderRadius: '0.75rem',
  padding: '12px 24px',
  textDecoration: 'none',
}
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0' }
