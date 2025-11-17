"use server"
import db from '@/firebase/firebase';
import { sendWelcomeEmail } from '@/services/notificationService';
import { v4 as uuidv4 } from 'uuid';

interface CreateUserData {
  privyId: string;
  email?: string | null;
  walletAddress?: string | null;
  termsAccepted?: boolean;
  interests?: string[];
  organizationId?: string | null;
  socialInfo?: SocialInfo;
}

interface SocialInfo {
  name?: string;
  email?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  github?: string;
  bio?: string;
}

export async function createUser(data: CreateUserData) {
  try {
    const userId = uuidv4();
    
    const user = {
      id: userId,
      privyId: data.privyId,
      email: data.email || null,
      walletAddress: data.walletAddress || null,
      termsAccepted: data.termsAccepted || false,
      interests: data.interests || [],
      organizationId: data.organizationId || null,
      dateCreated: Date.now(),
      lastUpdated: Date.now(),
      status: 'active'
    };

    await db.collection('users').doc(userId).set(user);

    return { success: true, userId };
  } catch (error) {
    console.error('Error creating user:', error);
    return { success: false, error: 'Failed to create user' };
  }
}

export async function getUserByPrivyId(privyId: string) {
  try {
    const userSnapshot = await db.collection('users')
      .where('privyId', '==', privyId)
      .limit(1)
      .get();

    if (userSnapshot.empty) {
      return { success: false, error: 'User not found' };
    }

    const userDoc = userSnapshot.docs[0];
    return { 
      success: true, 
      user: {
        id: userDoc.id,
        ...userDoc.data() 
      }
    };
  } catch (error) {
    console.error('Error fetching user:', error);
    return { success: false, error: 'Failed to fetch user' };
  }
}

export async function updateUserInterests(userId: string, interests: string[], socialInfo?: SocialInfo) {
  try {
    // First check if the user exists
    const userSnapshot = await db.collection('users').where('privyId', '==', userId).limit(1).get();
    
    if (userSnapshot.empty) {
      // Create user if they don't exist
      const result = await createUser({
        privyId: userId,
        interests: interests,
        termsAccepted: true
      });
      
      if (!result.success) {
        return { success: false, error: 'Failed to create user' };
      }
      
      return { success: true };
    }

    const updateData: any = {
      interests,
      lastUpdated: Date.now()
    };

    if (socialInfo) {
      updateData.socialInfo = socialInfo;
    }

    await db.collection('users').doc(userSnapshot.docs[0].id).update(updateData);

    return { success: true };
  } catch (error) {
    console.error('Error updating user interests:', error);
    return { success: false, error: 'Failed to update interests' };
  }
}

export async function acceptTerms(privyId: string) {
  try {
    if (!privyId) {
      console.error('No privyId provided');
      return { success: false, error: 'User ID is required' };
    }

    console.log('Attempting to accept terms for user:', privyId);
    
    const userSnapshot = await db.collection('users')
      .where('privyId', '==', privyId)
      .limit(1)
      .get();

    if (userSnapshot.empty) {
      console.log('User not found, creating new user');
      // Create user if they don't exist
      const result = await createUser({
        privyId,
        termsAccepted: true
      });
      
      if (!result.success) {
        console.error('Failed to create user:', result.error);
        return { success: false, error: 'Failed to create user account' };
      }
      
      console.log('Successfully created new user with terms accepted');
      return { success: true };
    }

    console.log('Updating existing user terms acceptance');
    const userDoc = userSnapshot.docs[0];
    await userDoc.ref.update({
      termsAccepted: true,
      lastUpdated: Date.now()
    });

    console.log('Successfully updated user terms acceptance');
    return { success: true };
  } catch (error) {
    console.error('Detailed error accepting terms:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to accept terms. Please try again.' 
    };
  }
}

export async function updateUserProfile(privyId: string, socialInfo: SocialInfo) {
  try {
    // First check if the user exists using privyId
    const userSnapshot = await db.collection('users')
      .where('privyId', '==', privyId)
      .limit(1)
      .get();
    
    if (userSnapshot.empty) {
      // Create user if they don't exist
      const result = await createUser({
        privyId,
        socialInfo,
        termsAccepted: true
      });
      
      if (!result.success) {
        return { success: false, error: 'Failed to create user' };
      }
      
      return { success: true };
    }

    // Get the user document
    const userDoc = userSnapshot.docs[0];
    const existingData = userDoc.data();
    
    // Prepare the update data
    const updateData: any = {
      lastUpdated: Date.now()
    };

    // Only update socialInfo if it's provided
    if (!existingData.welcomeEmailSent) {
      console.log('Sending welcome email to:', socialInfo.email || '', socialInfo.name || '');
      sendWelcomeEmail(privyId, socialInfo.email || '', socialInfo.name || '');
      updateData.welcomeEmailSent = true;
    }

 
    if (socialInfo) {
      updateData.socialInfo = {
        ...(existingData.socialInfo || {}), // Keep existing social info
        ...socialInfo // Update with new social info
      };
    }

    // Update the user document using the document ID
    await db.collection('users').doc(userDoc.id).update(updateData);

    return { success: true };
  } catch (error) {
    console.error('Error updating user profile:', error);
    return { success: false, error: 'Failed to update profile' };
  }
} 