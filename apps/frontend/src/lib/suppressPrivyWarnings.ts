/**
 * Suppress hydration warnings from Privy (third-party library)
 * These warnings are from Privy's internal components and don't affect functionality
 */

if (typeof window !== 'undefined') {
  const originalError = console.error;
  const originalWarn = console.warn;
  
  // Suppress Privy hydration errors
  console.error = (...args: any[]) => {
    const errorMessage = args[0]?.toString() || '';
    // Suppress Privy hydration warnings about <div> inside <p>
    if (
      errorMessage.includes('cannot be a descendant of') ||
      errorMessage.includes('cannot contain a nested') ||
      errorMessage.includes('HelpTextContainer') ||
      errorMessage.includes('Privy') ||
      args.some((arg) => 
        typeof arg === 'string' && 
        (arg.includes('HelpTextContainer') || arg.includes('Privy') || arg.includes('cannot be a descendant'))
      )
    ) {
      // Suppress this specific warning
      return;
    }
    originalError.apply(console, args);
  };

  // Also suppress warnings
  console.warn = (...args: any[]) => {
    const warnMessage = args[0]?.toString() || '';
    if (
      warnMessage.includes('HelpTextContainer') ||
      warnMessage.includes('Privy') ||
      warnMessage.includes('hydration')
    ) {
      return;
    }
    originalWarn.apply(console, args);
  };
}
