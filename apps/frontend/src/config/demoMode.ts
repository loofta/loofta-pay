/**
 * Demo Mode Configuration
 * 
 * When NEXT_PUBLIC_DEMO_MODE=true, the app runs in demo mode:
 * - Payment buttons are disabled
 * - No actual transactions are submitted
 * - Services return mock/blocked responses
 */

export const DEMO_MODE = 
  typeof process !== "undefined" && 
  (process as any)?.env?.NEXT_PUBLIC_DEMO_MODE === "true";

export function isDemoMode(): boolean {
  return DEMO_MODE;
}

export class DemoModeError extends Error {
  constructor(message = "This feature is disabled in demo mode") {
    super(message);
    this.name = "DemoModeError";
  }
}

/**
 * Guard function to throw error if in demo mode
 */
export function assertNotDemoMode(operation?: string): void {
  if (DEMO_MODE) {
    throw new DemoModeError(
      operation 
        ? `${operation} is disabled in demo mode` 
        : "This feature is disabled in demo mode"
    );
  }
}

