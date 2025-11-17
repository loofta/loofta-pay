'use server';

import db from '@/firebase/firebase';

export async function triggerWelcomeEmail(userId: string, email: string, name: string) {
  try {
    console.log('Attempting to send welcome email to:', email);
    
    const mailDoc = {
      to: email,
      message: {
        subject: 'Welcome to Loofta!',
        html: `
          <h1>Welcome to Loofta, ${name}!</h1>
          <p>Thank you for completing your profile. We're excited to have you on board!</p>
          <p>You can now start exploring and connecting with other creators.</p>
          <p>Best regards,<br>The Loofta Team</p>
        `,
      },
      template: {
        name: 'welcome',
        data: {
          name,
          email,
          year: new Date().getFullYear(),
        },
      },
      from: 'no-reply@loofta.xyz',
      replyTo: 'no-reply@loofta.xyz',
      delivery: {
        startTime: new Date().toISOString(),
      }
    };

    console.log('Creating mail document with data:', mailDoc);
    
    await db.collection('mail').doc().set(mailDoc);
    console.log('Mail document created successfully');

    return { success: true };
  } catch (error) {
    console.error('Error triggering welcome email:', error);
    return { success: false, error: 'Failed to trigger welcome email' };
  }
} 