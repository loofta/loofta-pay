import * as functions from 'firebase-functions';
import * as nodemailer from 'nodemailer';
import * as path from 'path';
import * as fs from 'fs';
import * as handlebars from 'handlebars';
import { Request, Response } from 'express';
import { QueryDocumentSnapshot } from 'firebase-admin/firestore';

// Email configuration
const defaultEmailConfig = {
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: 'lisa.bechina@gmail.com',
    pass: 'ejdj zikh abzp ttgb'
  },
  tls: {
    ciphers: 'HIGH',
    rejectUnauthorized: true
  }
};

// Get email configuration from Firebase config or use defaults
const getEmailConfig = () => {
  try {
    const config = functions.config().email;
    if (!config) {
      console.warn('Email configuration not found in Firebase config. Using default values.');
      return defaultEmailConfig;
    }

    // Ensure numeric port and boolean secure
    const port = config.port ? parseInt(config.port, 10) : defaultEmailConfig.port;
    const secure = config.secure === 'true' ? true : (config.secure === 'false' ? false : defaultEmailConfig.secure);

    return {
      host: config.host || defaultEmailConfig.host,
      port,
      secure,
      auth: {
        user: config.user || defaultEmailConfig.auth.user,
        pass: config.password || defaultEmailConfig.auth.pass
      },
      tls: {
        ciphers: 'HIGH',
        rejectUnauthorized: true
      }
    };
  } catch (error) {
    console.warn('Error getting email configuration:', error);
    return defaultEmailConfig;
  }
};

// Create email transporter
const transporter = nodemailer.createTransport(getEmailConfig());

// Verify transporter connection
transporter.verify((error, success) => {
  if (error) {
    console.error('SMTP Connection Error:', error);
  } else {
    console.log('SMTP Server is ready to send emails');
  }
});

// Load email templates
const templates = {
  welcome: loadTemplate('welcome.html'),
  purchase: loadTemplate('purchase.html'),
  purchaseAdmin: loadTemplate('purchase-admin.html'),
};

// Register custom helpers
handlebars.registerHelper('eq', function(a: any, b: any) {
  return a === b;
});

function loadTemplate(templateName: string): handlebars.TemplateDelegate {
  try {
    // First try the compiled directory
    const compiledPath = path.join(__dirname, 'templates', templateName);
    if (fs.existsSync(compiledPath)) {
      const template = fs.readFileSync(compiledPath, 'utf8');
      return handlebars.compile(template);
    }

    // Fallback to source directory
    const sourcePath = path.join(__dirname, '..', '..', 'src', 'emails', 'templates', templateName);
    if (fs.existsSync(sourcePath)) {
      const template = fs.readFileSync(sourcePath, 'utf8');
      return handlebars.compile(template);
    }

    throw new Error(`Template ${templateName} not found in either compiled or source directory`);
  } catch (error) {
    console.error('Error loading template:', error);
    throw error;
  }
}

interface EmailData {
  to: string;
  from: string;
  subject: string;
  template: 'welcome' | 'purchase';
  data: {
    name: string;
    email: string;
    logoUrl: string;
    dashboardUrl: string;
    year: number;
    [key: string]: any;
  };
}

interface EmailError extends Error {
  code?: string;
  response?: any;
  command?: string;
}

interface PurchaseData {
  userId: string;
  email: string;
  name: string;
  serviceType: 'boost' | 'giveaway' | 'creators';
  amount: string;
  currency: string;
  network: string;
  postLink?: string;
  tasks?: string[];
  transactionHash?: string;
  date?: string;
}

export async function sendEmail(emailData: EmailData): Promise<void> {
  try {
    console.log('Starting to send email with data:', JSON.stringify(emailData, null, 2));
    
    const template = templates[emailData.template];
    if (!template) {
      throw new Error(`Template ${emailData.template} not found`);
    }

    console.log('Template loaded successfully');
    
    const html = template({
      ...emailData.data,
      year: new Date().getFullYear(),
    });

    console.log('Template rendered successfully');

    const config = getEmailConfig();
    console.log('Using email config:', {
      ...config,
      auth: { ...config.auth, pass: '***' } // Hide password in logs
    });

    const mailOptions = {
      from: `Loofta <noreply@loofta.xyz>`,
      to: emailData.to,
      subject: emailData.subject,
      html,
    };

    console.log('Sending email with options:', {
      ...mailOptions,
      html: '***' // Hide HTML content in logs
    });

    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info);
  } catch (error) {
    const emailError = error as EmailError;
    console.error('Detailed error sending email:', {
      message: emailError.message,
      stack: emailError.stack,
      code: emailError.code,
      response: emailError.response,
      command: emailError.command
    });
    throw error;
  }
}

export const sendPurchaseEmail = async (
  to: string | PurchaseData,
  data?: {
    itemName: string;
    amount: string;
    transactionId?: string;
    date?: string;
  }
) => {
  try {
    // Handle both direct calls and endpoint calls
    const emailTo = typeof to === 'string' ? to : to.email;
    const purchaseData = typeof to === 'string' ? null : to;

    if (!purchaseData) {
      throw new Error('Missing purchase data');
    }

    console.log('Sending purchase email to:', emailTo);
    console.log('Purchase data:', purchaseData);

    // Ensure we have valid templates
    if (!templates.purchase || !templates.purchaseAdmin) {
      throw new Error('Email templates not found');
    }

    // Prepare email data for client
    const clientEmailData = {
      name: purchaseData.name,
      serviceType: purchaseData.serviceType,
      amount: purchaseData.amount,
      currency: purchaseData.currency,
      network: purchaseData.network,
      transactionHash: purchaseData.transactionHash,
      postLink: purchaseData.postLink,
      tasks: purchaseData.tasks,
      logoUrl: 'https://loofta.xyz/images/logo.svg',
      year: new Date().getFullYear()
    };

    // Prepare email data for admin
    const adminEmailData = {
      userId: purchaseData.userId,
      name: purchaseData.name,
      email: purchaseData.email,
      serviceType: purchaseData.serviceType,
      amount: purchaseData.amount,
      currency: purchaseData.currency,
      network: purchaseData.network,
      transactionHash: purchaseData.transactionHash,
      postLink: purchaseData.postLink,
      logoUrl: 'https://loofta.xyz/images/logo.svg',
      year: new Date().getFullYear()
    };

    console.log('Prepared client email data:', clientEmailData);
    console.log('Prepared admin email data:', adminEmailData);

    // Send client email
    const clientHtml = templates.purchase(clientEmailData);
    const clientInfo = await transporter.sendMail({
      from: `"Loofta" <${getEmailConfig().auth.user}>`,
      to: emailTo,
      subject: 'Purchase Confirmation',
      html: clientHtml
    });

    console.log('Client email sent successfully:', clientInfo.messageId);

    // Send admin email
    const adminHtml = templates.purchaseAdmin(adminEmailData);
    const adminInfo = await transporter.sendMail({
      from: `"Loofta" <${getEmailConfig().auth.user}>`,
      to: 'lisa.bechina@gmail.com',
      subject: 'New Purchase Notification',
      html: adminHtml
    });

    console.log('Admin email sent successfully:', adminInfo.messageId);

    return { clientInfo, adminInfo };
  } catch (error: unknown) {
    console.error('Error sending purchase emails:', error);
    throw error;
  }
};

// Add CORS middleware
const cors = (req: Request, res: Response, next: () => void) => {
  console.log('CORS middleware - Request method:', req.method);
  console.log('CORS middleware - Request headers:', req.headers);
  console.log('CORS middleware - Request query:', req.query);
  
  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Access-Control-Allow-Origin');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    console.log('CORS middleware - Handling OPTIONS request');
    res.status(204).send('');
    return;
  }
  
  console.log('CORS middleware - Proceeding to main handler');
  next();
};

// HTTP Functions (v1 syntax)
export const sendWelcomeEmail = functions.https.onRequest(async (req: Request, res: Response) => {
  console.log('sendWelcomeEmail - Starting function execution');
  
  // Apply CORS middleware
  cors(req, res, async () => {
    try {
      console.log('sendWelcomeEmail - Processing request with query:', req.query);
      
      const { userId, email, name } = req.query;

      if (!userId || !email) {
        console.log('sendWelcomeEmail - Missing required parameters:', { userId, email });
        res.status(400).json({ error: 'Missing required parameters' });
        return;
      }

      console.log('sendWelcomeEmail - Calling sendEmail function');
      await sendEmail({
        to: email as string,
        from: `Loofta <noreply@loofta.xyz>`,
        subject: 'Welcome to Loofta!',
        template: 'welcome',
        data: {
          name: (name as string) || 'there',
          email: email as string,
          logoUrl: 'https://loofta.xyz/images/logo.svg',
          dashboardUrl: 'https://app.loofta.xyz',
          year: new Date().getFullYear()
        },
      });

      console.log('sendWelcomeEmail - Email sent successfully');
      res.status(200).json({ success: true });
    } catch (error) {
      const emailError = error as EmailError;
      console.error('sendWelcomeEmail - Detailed error:', {
        message: emailError.message,
        stack: emailError.stack,
        code: emailError.code,
        response: emailError.response,
        command: emailError.command
      });
      res.status(500).json({ 
        error: 'Failed to send welcome email',
        details: emailError.message,
        code: emailError.code
      });
    }
  });
});

export const sendPurchaseEmailEndpoint = functions.https.onRequest(async (req: Request, res: Response) => {
  console.log('sendPurchaseEmail - Starting function execution');
  
  // Apply CORS middleware
  cors(req, res, async () => {
    try {
      console.log('sendPurchaseEmail - Processing request with query:', req.query);
      
      const {
        userId,
        email,
        name,
        serviceType,
        amount,
        currency,
        network,
        postLink,
        tasks,
        transactionHash
      } = req.query;

      if (!userId || !email || !name || !serviceType || !amount || !currency || !network) {
        console.log('sendPurchaseEmail - Missing required parameters:', { userId, email, name, serviceType, amount, currency, network });
        res.status(400).json({ error: 'Missing required parameters' });
        return;
      }

      // Parse tasks if they exist
      const parsedTasks = tasks ? JSON.parse(tasks as string) : undefined;

      await sendPurchaseEmail({
        userId: userId as string,
        email: email as string,
        name: name as string,
        serviceType: serviceType as 'boost' | 'giveaway' | 'creators',
        amount: amount as string,
        currency: currency as string,
        network: network as string,
        postLink: postLink as string,
        tasks: parsedTasks,
        transactionHash: transactionHash as string
      });

      console.log('sendPurchaseEmail - Email sent successfully');
      res.status(200).json({ success: true });
    } catch (error) {
      const emailError = error as EmailError;
      console.error('sendPurchaseEmail - Detailed error:', {
        message: emailError.message,
        stack: emailError.stack,
        code: emailError.code,
        response: emailError.response,
        command: emailError.command
      });
      res.status(500).json({ 
        error: 'Failed to send purchase email',
        details: emailError.message,
        code: emailError.code
      });
    }
  });
});

// Firestore Triggers (v1 syntax)
export const onUserCreated = functions.firestore
  .document('users/{userId}')
  .onCreate(async (snap: QueryDocumentSnapshot) => {
    const userData = snap.data();
    if (!userData?.email) return;

    await sendEmail({
      to: userData.email,
      from: `Loofta <noreply@loofta.xyz>`,
      subject: 'Welcome to Loofta!',
      template: 'welcome',
      data: {
        name: userData.name || 'there',
        email: userData.email,
        logoUrl: 'https://loofta.xyz/images/logo.svg',
        dashboardUrl: 'https://app.loofta.xyz',
        year: new Date().getFullYear()
      },
    });
  });

export const onTransactionCreated = functions.firestore
  .document('transactions/{transactionId}')
  .onCreate(async (snap: QueryDocumentSnapshot, context) => {
    const transactionData = snap.data();
    if (!transactionData?.userEmail) return;

    await sendEmail({
      to: transactionData.userEmail,
      from: `Loofta <noreply@loofta.xyz>`,
      subject: `Purchase Confirmation - ${transactionData.serviceType}`,
      template: 'purchase',
      data: {
        name: transactionData.userName || 'there',
        email: transactionData.userEmail,
        logoUrl: 'https://loofta.xyz/images/logo.svg',
        dashboardUrl: 'https://app.loofta.xyz',
        serviceType: transactionData.serviceType,
        transactionId: context.params.transactionId,
        amount: transactionData.amount,
        currency: transactionData.currency,
        network: transactionData.network,
        date: new Date().toLocaleDateString(),
        postLink: transactionData.postLink,
        year: new Date().getFullYear()
      },
    });
  }); 