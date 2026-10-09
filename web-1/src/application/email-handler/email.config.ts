/**
 * Email Templates Configuration
 * SSOT for email template constants.
 */

export const CRITICAL_ALERT_EMAIL_CONFIG = {
  // Admin alerts go to the owner, so they are Polish (language contract:
  // what a human reads is Polish). Stripe identifiers stay in the details.
  subjectPrefix: '[Nailfolio]',

  /**
   * Plain text template. {{lines}} is empty or a bullet list with a leading
   * and trailing newline.
   */
  textTemplate: `{{alertTitle}}

{{alertMessage}}
{{lines}}{{link}}
Szczegóły techniczne:
{{details}}

Automatyczny alert z Nailfolio.`,

  /** One entry of the readable list in the HTML version. */
  lineHtmlTemplate: `<li style="font-size:16px;line-height:24px;color:#7F1D1D;margin:0 0 4px;">{{line}}</li>`,

  /** The alert's single action link (escaped URL and label). */
  linkHtmlTemplate: `<p style="margin:0 0 24px;"><a href="{{url}}" style="font-size:16px;line-height:24px;font-weight:600;color:#991B1B;text-decoration:underline;">{{label}}</a></p>`,

  /** Wrapper of the readable list; empty lists render nothing. */
  linesHtmlTemplate: `<ul style="margin:0 0 24px;padding:0 0 0 20px;">{{items}}</ul>`,

  /**
   * HTML template for admin alerts
   * Email-safe HTML (table-based layout, inline styles)
   */
  htmlTemplate: `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Alert Nailfolio</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#FEF2F2;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FEF2F2;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;border:1px solid #DC2626;">
          <!-- Header -->
          <tr>
            <td style="padding:24px 40px;text-align:center;border-bottom:1px solid #FEE2E2;background-color:#FEF2F2;border-radius:12px 12px 0 0;">
              <span style="font-size:14px;font-weight:600;color:#DC2626;">Alert Nailfolio</span>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding:32px 40px;">
              <h1 style="font-size:20px;font-weight:600;color:#991B1B;margin:0 0 16px;">{{alertTitle}}</h1>
              <p style="font-size:16px;line-height:24px;color:#7F1D1D;margin:0 0 24px;">
                {{alertMessage}}
              </p>
              {{linesHtml}}
              {{linkHtml}}
              <!-- Technical details -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FEF2F2;border-radius:6px;border:1px solid #FEE2E2;">
                <tr>
                  <td style="padding:16px 20px;">
                    <p style="font-size:14px;font-weight:600;color:#991B1B;margin:0 0 8px;">Szczegóły techniczne</p>
                    <pre style="font-size:14px;line-height:21px;color:#7F1D1D;margin:0;white-space:pre-wrap;word-break:break-word;font-family:monospace;">{{details}}</pre>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #FEE2E2;text-align:center;background-color:#FEF2F2;border-radius:0 0 12px 12px;">
              <p style="font-size:14px;line-height:21px;color:#991B1B;margin:0;">
                Automatyczny alert z Nailfolio.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
} as const;
