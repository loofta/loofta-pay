import { isCreatorAccessGranted } from "@/app/actions/creators/creators";

// Array of Privy IDs that have premium access
export const allowedUsers = ['privyId1', 'privyId2'];

// Helper function to check if a user is allowed
export const isUserAllowed = async (privyId: string | undefined): Promise<boolean> => {
  if (!privyId) return false;
  
  // First check if user is in allowedUsers array
  if (allowedUsers.includes(privyId)) {
    return true;
  }
  
  // Then check creatorAccess collection
  try {
    const hasAccess = await isCreatorAccessGranted(privyId);
    return hasAccess;
  } catch (error) {
    console.error("Error checking creator access:", error);
    return false;
  }
};