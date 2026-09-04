/**
 * Twilio SMS Gateway for Locksmith Operations
 * Handles:
 * 1. Dispatch alert SMS to technician
 * 2. Payment Link SMS to customer (Stripe)
 * 3. Payment Receipt SMS to customer (Cash / Interac)
 */

interface SendSmsParams {
  to: string;
  body: string;
}

interface SmsResult {
  success: boolean;
  messageId: string;
  to: string;
  body: string;
  isSimulated: boolean;
  error?: string;
}

export async function sendSMS({ to, body }: SendSmsParams): Promise<SmsResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER || '+16475550199';

  // Format phone number to E.164 if possible
  const cleanTo = to.replace(/[^0-9+]/g, '');
  const formattedTo = cleanTo.startsWith('+') ? cleanTo : `+1${cleanTo}`;

  if (accountSid && authToken && fromNumber) {
    try {
      const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const params = new URLSearchParams();
      params.append('To', formattedTo);
      params.append('From', fromNumber);
      params.append('Body', body);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Twilio API failed');
      }

      console.log(`[Twilio LIVE SMS] Sent to ${formattedTo}: ${body} (SID: ${data.sid})`);
      return {
        success: true,
        messageId: data.sid,
        to: formattedTo,
        body,
        isSimulated: false,
      };
    } catch (err: any) {
      console.error('[Twilio Error]', err);
      return {
        success: false,
        messageId: 'ERROR',
        to: formattedTo,
        body,
        isSimulated: false,
        error: err.message,
      };
    }
  }

  // Simulation mode for dev/demo testing without API keys
  const mockSid = `SM_SIM_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  console.log(`\n================== [TWILIO SIMULATED SMS] ==================`);
  console.log(`TO:   ${formattedTo}`);
  console.log(`FROM: ${fromNumber}`);
  console.log(`BODY:\n${body}`);
  console.log(`SID:  ${mockSid}`);
  console.log(`============================================================\n`);

  return {
    success: true,
    messageId: mockSid,
    to: formattedTo,
    body,
    isSimulated: true,
  };
}
