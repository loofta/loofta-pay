// Base URL for Firebase Functions
const FIREBASE_FUNCTIONS_URL = process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_URL || 'https://us-central1-loofta.cloudfunctions.net';

export async function notifyUserForPayment(senderTgId: string, dealId: string, amount: string) {
  const url = `${FIREBASE_FUNCTIONS_URL}/notifyUserForPayment`;
  
  const params = new URLSearchParams({
      senderTgId,
      dealId,
      amount,
  });

    try {
      
        console.log('`${url}?${params.toString()}`', `${url}?${params.toString()}`);
      const response = await fetch(`${url}?${params.toString()}`, {
          method: 'GET',
      });


      if (!response.ok) {
          const errorData = await response.json();
          console.error('Error in notifying user for payment:', errorData);
          throw new Error('Failed to notify user for payment.');
      }

      return await response.json();
  } catch (error) {
      console.error('Error:', error);
      throw error;
  }
}


export const notifyDealCreated = async (dealId: any, senderTgId: any) => {
    try {
      const response = await fetch(
        `${FIREBASE_FUNCTIONS_URL}/notifyDealCreated?senderTgId=${senderTgId}&dealId=${dealId}`
      );
      if (!response.ok) {
        throw new Error('Failed to send notification');
      }
      console.log('Notification sent successfully');
    } catch (error) {
      console.error('Error sending notification:', error);
    }
};

export const notifyCampaignCreated = async (campaignId: any, senderTgId: any) => {
  try {
    const response = await fetch(
      `${FIREBASE_FUNCTIONS_URL}/notifyCampaignCreated?senderTgId=${senderTgId}&campaignId=${campaignId}`
    );
    if (!response.ok) {
      throw new Error('Failed to send notification');
    }
    console.log('Notification sent successfully');
  } catch (error) {
    console.error('Error sending notification:', error);
  }
};
  
export const notifyDealReceived = async (dealId: any, senderTgId: any) => {
  try {
    const response = await fetch(
      `${FIREBASE_FUNCTIONS_URL}/notifyDealReceived?senderTgId=${senderTgId}&dealId=${dealId}`
    );
    if (!response.ok) {
      throw new Error('Failed to send notification');
    }
    console.log('Notification sent successfully');
  } catch (error) {
    console.error('Error sending notification:', error);
  }
};

export const notifyDealAccepted = async (dealId: any, senderTgId: any) => {
  try {
    const response = await fetch(
      `${FIREBASE_FUNCTIONS_URL}/notifyDealAccepted?senderTgId=${senderTgId}&dealId=${dealId}`
    );
    if (!response.ok) {
      throw new Error('Failed to send notification');
    }
    console.log('Notification sent successfully');
  } catch (error) {
    console.error('Error sending notification:', error);
  }
};

export const notifyDealDeclined = async (dealId: any, senderTgId: any) => {
  try {
    const response = await fetch(
      `${FIREBASE_FUNCTIONS_URL}/notifyDealDeclined?senderTgId=${senderTgId}&dealId=${dealId}`
    );
    if (!response.ok) {
      throw new Error('Failed to send notification');
    }
    console.log('Notification sent successfully');
  } catch (error) {
    console.error('Error sending notification:', error);
  }
};

export const notifyDealDelivered = async (dealId: any, senderTgId: any) => {
  try {
    const response = await fetch(
      `${FIREBASE_FUNCTIONS_URL}/notifyDealDelivered?senderTgId=${senderTgId}&dealId=${dealId}`
    );
    if (!response.ok) {
      throw new Error('Failed to send notification');
    }
    console.log('Notification sent successfully');
  } catch (error) {
    console.error('Error sending notification:', error);
  }
};


export const notifyPaymentReceived = async (dealId: any, senderTgId: any) => {
  try {
    const response = await fetch(
      `${FIREBASE_FUNCTIONS_URL}/notifyPaymentReceived?senderTgId=${senderTgId}&dealId=${dealId}`
    );
    if (!response.ok) {
      throw new Error('Failed to send notification');
    }
    console.log('Notification sent successfully');
  } catch (error) {
    console.error('Error sending notification:', error);
  }
};


export const messageNotification = async (message: any, senderTgId: any) => {
  try {
    const response = await fetch(
      `${FIREBASE_FUNCTIONS_URL}/sendNotificationMessage?senderTgId=${senderTgId}&message=${message}`
    );
    if (!response.ok) {
      throw new Error('Failed to send notification');
    }
    console.log('Notification sent successfully');
  } catch (error) {
    console.error('Error sending notification:', error);
  }
};

export const sendWelcomeEmail = async (userId: string, email: string, name?: string) => {
  try {
    const url = `${FIREBASE_FUNCTIONS_URL}/sendWelcomeEmail`;
    const params = new URLSearchParams({
      userId,
      email,
      name: name || ''
    });

    const fullUrl = `${url}?${params.toString()}`;
    console.log('Sending welcome email to:', fullUrl);
    
    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      mode: 'cors',
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Error response from welcome email:', errorData);
      throw new Error(`Failed to send welcome email: ${errorData.error || response.statusText}`);
    }

    const data = await response.json();
    console.log('Welcome email sent successfully:', data);
    return data;
  } catch (error) {
    console.error('Error sending welcome email:', error);
    throw error;
  }
};

interface PurchaseEmailData {
  userId: string;
  email: string;
  name: string;
  serviceType: string;
  amount: string;
  currency: string;
  network: string;
  tasks?: string[];
  postLink?: string;
  transactionHash?: string;
}

export const sendPurchaseEmail = async (data: PurchaseEmailData) => {
  try {
    const params = new URLSearchParams({
      userId: data.userId,
      email: data.email,
      name: data.name,
      serviceType: data.serviceType,
      amount: data.amount,
      currency: data.currency,
      network: data.network,
      ...(data.postLink && { postLink: data.postLink }),
      ...(data.transactionHash && { transactionHash: data.transactionHash })
    });

    const response = await fetch(
      `${FIREBASE_FUNCTIONS_URL}/sendPurchaseEmail?${params.toString()}`
    );
    
    if (!response.ok) {
      throw new Error('Failed to send purchase email');
    }
    console.log('Purchase email sent successfully');
  } catch (error) {
    console.error('Error sending purchase email:', error);
    throw error;
  }
};