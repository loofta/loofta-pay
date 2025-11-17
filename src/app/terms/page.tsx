'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { acceptTerms } from '@/app/actions/users/users';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

export default function TermsPage() {
  const router = useRouter();
  const { user } = usePrivy();
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleAccept = async () => {
    if (!user?.id) {
      toast({
        title: "Error",
        description: "Please sign in first",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const result = await acceptTerms(user.id);
      if (result.success) {
        toast({
          title: "Success",
          description: "Terms and conditions accepted",
        });
        router.push('/interests');
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to accept terms. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        <Card className="w-full shadow-lg">
          <CardHeader className="space-y-4">
            <CardTitle className="text-3xl font-bold text-center">Terms and Conditions</CardTitle>
            <CardDescription className="text-center text-lg">
              Please read and accept our terms to continue
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[60vh] pr-4 rounded-md border p-4">
              <div className="space-y-8 text-gray-700">
                <section className="space-y-4">
                  <h2 className="text-xl font-semibold text-gray-900">1. Introduction</h2>
                  <p className="text-gray-600">
                    Welcome to Loofta. By accessing or using our platform, you agree to be bound by these Terms and Conditions.
                  </p>
                </section>

                <section className="space-y-4">
                  <h2 className="text-xl font-semibold text-gray-900">2. User Responsibilities</h2>
                  <ul className="list-disc pl-6 space-y-2 text-gray-600">
                    <li>You must provide accurate and complete information when creating an account</li>
                    <li>You are responsible for maintaining the confidentiality of your account</li>
                    <li>You agree to use the platform in compliance with all applicable laws</li>
                  </ul>
                </section>

                <section className="space-y-4">
                  <h2 className="text-xl font-semibold text-gray-900">3. Platform Usage</h2>
                  <p className="text-gray-600">
                    Loofta provides tools for marketing and community management. You agree to use these tools responsibly and in accordance with our guidelines.
                  </p>
                </section>

                <section className="space-y-4">
                  <h2 className="text-xl font-semibold text-gray-900">4. Privacy Policy</h2>
                  <p className="text-gray-600">
                    Your use of Loofta is also governed by our Privacy Policy. Please review it to understand how we collect and use your information.
                  </p>
                </section>

                <section className="space-y-4">
                  <h2 className="text-xl font-semibold text-gray-900">5. Intellectual Property</h2>
                  <p className="text-gray-600">
                    All content and materials available on Loofta are protected by intellectual property rights. You may not use them without our permission.
                  </p>
                </section>
              </div>
            </ScrollArea>

            <div className="mt-8 space-y-6">
              <div className="flex items-center space-x-3 bg-gray-50 p-4 rounded-lg">
                <Checkbox
                  id="terms"
                  checked={accepted}
                  onCheckedChange={(checked) => setAccepted(checked === true)}
                  className="h-5 w-5"
                />
                <label
                  htmlFor="terms"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  I have read and agree to the Terms and Conditions
                </label>
              </div>

              <Button
                className="w-full py-6 text-lg font-semibold"
                onClick={handleAccept}
                disabled={!accepted || loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Accept and Continue'
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
} 