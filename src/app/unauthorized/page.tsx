'use client';

import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';

export default function UnauthorizedPage() {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center">
      <div className="max-w-md space-y-6">
        <div className="flex justify-center">
          <ShieldAlert className="w-16 h-16 text-orange-500" />
        </div>
        <h1 className="text-3xl font-bold">Access Restricted</h1>
        <p className="text-gray-600">
          The page you're trying to access is not available in this application.
          Please use the navigation menu to access available pages.
        </p>
        <Button
          onClick={() => router.push('/')}
          className="w-full"
        >
          Return to Home
        </Button>
      </div>
    </div>
  );
} 