import { z } from 'zod'
const nodemailer = require('nodemailer')
// import dotenv from 'dotenv'

export const sendEmailTool = {
  name: 'sendEmail',
  description:
    'Sends an email to a specified recipient with a subject and body. You can specify both a plain text body and an HTML body.',
  parameters: z
    .object({
      to: z
        .string()
        .describe('The email address of the recipient.'),
      subject: z
        .string()
        .min(1, { message: 'Subject cannot be empty.' })
        .describe('The subject line of the email.'),
      textBody: z
        .string()
        .optional()
        .describe(
          'The plain text content of the email. Recommended to provide at least textBody or htmlBody.'
        ),
      htmlBody: z
        .string()
        .optional()
        .describe(
          'The HTML content of the email. You can use HTML tags for rich formatting.'
        )
    })
    .refine((data) => data.textBody || data.htmlBody, {
      message: 'Either textBody or htmlBody must be provided.',
      path: ['textBody'] // Path to report the error on, can be any of the fields
    }),
  execute: async ({ to, subject, textBody, htmlBody }) => {
    // Basic validation that refine should catch, but good for direct calls too
    if (!textBody && !htmlBody) {
      return {
        success: false,
        message: 'Email content is empty. Provide either textBody or htmlBody.'
      }
    }

    // Configure Nodemailer transporter
    // IMPORTANT: User must configure these in their .env file
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10), // Default to 587 if not set
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
      // For testing with services like Ethereal, you might enable this:
      // tls: {
      //   rejectUnauthorized: false // do not fail on invalid certs
      // }
    })
    const mailOptions = {
      from: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER, // Sender address (must be authorized by your SMTP provider)
      to: to, // List of receivers
      subject: subject, // Subject line
      text: textBody, // Plain text body
      html: htmlBody // HTML body content
    }

    try {
      // Verify connection configuration (optional, but good for debugging)
      // await transporter.verify();
      // console.log("SMTP Server connection verified.");

      const info = await transporter.sendMail(mailOptions)
      // For services like Ethereal, you can get a preview URL
      // console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
      return {
        success: true,
        messageId: info.messageId,
        message: `Email successfully sent to ${to}.`
      }
    } catch (error) {
      // Provide a more specific error message if possible
      let errorMessage = 'Failed to send email.'
      if (error.code === 'EENVELOPE') {
        errorMessage = `Failed to send email. Invalid 'from' or 'to' address. Please check SMTP_FROM_EMAIL and the recipient's email. Error: ${error.message}`
      } else if (error.code === 'EAUTH') {
        errorMessage = `Failed to send email. SMTP authentication error. Please check SMTP_USER and SMTP_PASS. Error: ${error.message}`
      } else if (error.code === 'ECONNREFUSED') {
        errorMessage = `Failed to send email. SMTP connection refused. Please check SMTP_HOST and SMTP_PORT. Error: ${error.message}`
      } else if (error.message) {
        errorMessage = `Failed to send email. Error: ${error.message}`
      }
      return { success: false, message: errorMessage, error: error.toString() }
    }
  }
}

// sendEmailTool.execute({
//   to: ['1511370892@qq.com', 'hardyhe@xwfintech.com'],
//   subject: 'Test Email',
//   textBody: 'Hello, this is a test email from your AI assistant.',
// })
