'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ArrowRight, Zap, Gift, Users, Shield } from 'lucide-react';
import OnboardingLayout from '@/components/layouts/OnboardingLayout';
import PrimaryBtn from '@/components/PrimaryBtn';
import { getUserByPrivyId } from '@/app/actions/users/users';

const FEATURES = [
  {
    icon: <Zap className="w-6 h-6" />,
    title: "Boost Post Engagement",
    description: "Increase visibility and engagement on your social media posts with our powerful boosting tools."
  },
  {
    icon: <Gift className="w-6 h-6" />,
    title: "Run Giveaways",
    description: "Create and manage giveaways to grow your community and reward your followers."
  },
  {
    icon: <Users className="w-6 h-6" />,
    title: "KOL Marketing",
    description: "Connect with Key Opinion Leaders to promote your project effectively."
  },
  {
    icon: <Shield className="w-6 h-6" />,
    title: "Secure Deals",
    description: "Handle all your KOL deals securely through our platform with escrow protection."
  }
];

export default function WelcomePage() {
  const router = useRouter();
  const { user } = usePrivy();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkUserInterests = async () => {
      if (!user?.id) return;

      try {
        const result = await getUserByPrivyId(user.id);
        if (result.success && result.user) {
          const userData = result.user;
          // If user has no interests or interests array is empty, redirect to interests page
          if (!('interests' in userData) || !Array.isArray(userData.interests) || userData.interests.length === 0) {
            router.push('/interests');
          }
        }
      } catch (error) {
        console.error('Error checking user interests:', error);
      } finally {
        setLoading(false);
      }
    };

    checkUserInterests();
  }, [user?.id, router]);

  const handleGetStarted = () => {
    router.push('/');
  };

  if (loading) {
    return (
      <OnboardingLayout currentStep={3} totalSteps={3}>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </OnboardingLayout>
    );
  }

  return (
    <OnboardingLayout currentStep={3} totalSteps={3}>
      <div className="space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Welcome to Loofta!</h1>
          <p className="text-gray-500">Let's explore what you can do on our platform</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {FEATURES.map((feature, index) => (
            <Card key={index} className="border-0 shadow-lg hover:shadow-xl transition-shadow px-4">
              <CardHeader className="space-y-4 pb-6">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  {feature.icon}
                </div>
                <CardTitle className="text-xl font-semibold">{feature.title}</CardTitle>
                <CardDescription className="text-base">{feature.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>

        <div className="flex justify-end">
          <PrimaryBtn
            text="Get Started"
            onClick={handleGetStarted}
            className="w-full"
            icon={ArrowRight}
          />
        </div>
      </div>
    </OnboardingLayout>
  );
} 