'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { updateUserInterests } from '@/app/actions/users/users';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, Check } from 'lucide-react';
import OnboardingLayout from '@/components/layouts/OnboardingLayout';

const INTERESTS = [
  { id: 'boost-engagement', label: 'Boost engagement on my social post' },
  { id: 'run-giveaway', label: 'Run giveaway for community' },
  { id: 'kol-marketing', label: 'KOL marketing to promote a project' }
];

export default function InterestsPage() {
  const router = useRouter();
  const { user } = usePrivy();
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const toggleInterest = (interestId: string) => {
    setSelectedInterests(prev =>
      prev.includes(interestId)
        ? prev.filter(id => id !== interestId)
        : [...prev, interestId]
    );
  };

  const handleSubmit = async () => {
    if (!user?.id) {
      toast({
        title: "Error",
        description: "Please sign in first",
        variant: "destructive",
      });
      return;
    }

    if (selectedInterests.length === 0) {
      toast({
        title: "Error",
        description: "Please select at least one interest",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const result = await updateUserInterests(user.id, selectedInterests);
      if (result.success) {
        toast({
          title: "Success",
          description: "Interests updated successfully",
        });
        router.push('/onboarding/profile');
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update interests. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <OnboardingLayout currentStep={2} totalSteps={3}>
      <div className="space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">What are you interested in?</h1>
          <p className="text-gray-500">Select the services you'd like to use on Loofta</p>
        </div>

        <Card className="w-full border-0 shadow-lg p-4">
          <CardHeader className="space-y-6 pb-8">
            <div className="space-y-2">
              <CardTitle className="text-2xl font-semibold">Choose Your Interests</CardTitle>
              <CardDescription className="text-base">
                Select all that apply to help us personalize your experience
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 gap-4">
              {INTERESTS.map(interest => (
                <Button
                  key={interest.id}
                  variant={selectedInterests.includes(interest.id) ? "default" : "outline"}
                  className={`h-auto py-6 px-6 justify-start text-left group relative overflow-hidden ${selectedInterests.includes(interest.id)
                    ? 'bg-primary text-white hover:bg-primary/90'
                    : 'hover:bg-gray-50'
                    }`}
                  onClick={() => toggleInterest(interest.id)}
                >
                  <div className="flex items-center space-x-4">
                    {selectedInterests.includes(interest.id) && (
                      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
                        <Check className="w-4 h-4" />
                      </div>
                    )}
                    <span className="text-base font-medium">{interest.label}</span>
                  </div>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button
            size="lg"
            className="px-8"
            onClick={handleSubmit}
            disabled={selectedInterests.length === 0 || loading}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              'Continue to Profile'
            )}
          </Button>
        </div>
      </div>
    </OnboardingLayout>
  );
} 