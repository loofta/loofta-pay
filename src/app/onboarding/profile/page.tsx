'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Twitter, MessageSquare, Globe, Github, ArrowLeft, Sparkles, Building2, ArrowRight } from 'lucide-react';
import OnboardingLayout from '@/components/layouts/OnboardingLayout';
import { updateUserProfile, getUserByPrivyId } from '@/app/actions/users/users';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import confetti from 'canvas-confetti';
import { useUserData } from '@/hooks/useUserData';
import { sendWelcomeEmail } from '@/services/notificationService';

interface UserData {
  id: string;
  socialInfo?: {
    name?: string;
    email?: string;
    twitter?: string;
    telegram?: string;
    website?: string;
    github?: string;
    bio?: string;
  };
}

interface SocialInfo {
  name: string;
  email: string;
  bio: string;
  website: string;
  twitter: string;
  telegram: string;
  github: string;
  socialLinks?: {
    twitter: string;
    telegram: string;
    website: string;
    github: string;
  };
}

const SOCIAL_FIELDS = [
  {
    id: 'twitter',
    label: 'Twitter Handle',
    placeholder: '@yourhandle',
    icon: Twitter,
    description: 'Connect your Twitter to boost your visibility'
  },
  {
    id: 'telegram',
    label: 'Telegram Handle',
    placeholder: '@yourhandle',
    icon: MessageSquare,
    description: 'Let us reach you on Telegram'
  },
  {
    id: 'website',
    label: 'Website',
    placeholder: 'https://yourwebsite.com',
    icon: Globe,
    description: 'Share your portfolio or personal website'
  },
  {
    id: 'github',
    label: 'GitHub',
    placeholder: 'yourusername',
    icon: Github,
    description: 'Showcase your development work'
  }
];

export default function ProfilePage() {
  const router = useRouter();
  const { user } = usePrivy();
  const { toast } = useToast();
  const { updateUserData } = useUserData();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [socialInfo, setSocialInfo] = useState<SocialInfo>({
    name: '',
    email: '',
    bio: '',
    website: '',
    twitter: '',
    telegram: '',
    github: '',
  });

  useEffect(() => {
    const loadUserProfile = async () => {
      if (!user?.id) return;

      try {
        const result = await getUserByPrivyId(user.id);
        if (result.success && result.user) {
          const userData = result.user as UserData;
          const existingSocialInfo = userData.socialInfo || {};
          setSocialInfo(prev => ({
            ...prev,
            name: existingSocialInfo.name || '',
            email: user?.email?.address || '',
            twitter: existingSocialInfo.twitter || '',
            telegram: existingSocialInfo.telegram || '',
            website: existingSocialInfo.website || '',
            github: existingSocialInfo.github || '',
            bio: existingSocialInfo.bio || '',
          }));
        }
      } catch (error) {
        console.error('Error loading user profile:', error);
      }
    };

    loadUserProfile();
  }, [user?.id, user?.email?.address]);

  const handleSocialInfoChange = (field: keyof SocialInfo, value: string) => {
    setSocialInfo((prev: SocialInfo) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (!user) {
        throw new Error('User not authenticated');
      }

      // Update user profile
      const result = await updateUserProfile(user.id, {
        name: socialInfo.name,
        email: socialInfo.email,
        bio: socialInfo.bio,
        website: socialInfo.website,
        twitter: socialInfo.twitter,
        telegram: socialInfo.telegram,
        github: socialInfo.github
      });

      if (result.success) {
        // Update localStorage with new user data
        const newUserData = {
          id: user.id,
          socialInfo: {
            name: socialInfo.name,
            email: socialInfo.email,
            twitter: socialInfo.twitter,
            telegram: socialInfo.telegram,
            website: socialInfo.website,
            github: socialInfo.github,
            bio: socialInfo.bio
          }
        };
        updateUserData(newUserData);

        // Trigger confetti animation
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 }
        });

        toast({
          title: "Profile Updated!",
          description: "Your profile has been successfully updated.",
          className: "animate-in slide-in-from-right duration-500",
        });
        router.push('/onboarding/welcome');
      } else {
        throw new Error(result.error || 'Failed to update profile');
      }
    } catch (err) {
      console.error('Error updating profile:', err);
      setError(err instanceof Error ? err.message : 'Failed to update profile');
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to update profile. Please try again.",
        variant: "destructive",
        className: "animate-in slide-in-from-right duration-500",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <OnboardingLayout currentStep={3} totalSteps={3}>
      <div className="flex flex-col min-h-[calc(100vh-200px)] justify-between">
        <div className="space-y-8">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold">Complete Your Profile</h1>
            <p className="text-gray-500">Let's make your profile shine ✨</p>
          </div>

          <Card className="w-full border-0 shadow-lg p-4">
            <CardHeader className="space-y-6 pb-8">
              <div className="space-y-2">
                <CardTitle className="text-2xl font-semibold">Tell Us About Yourself</CardTitle>
                <CardDescription className="text-base">
                  Add your social profiles to help others discover you
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-8">
              <div className="flex flex-col gap-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <Label htmlFor="name">Name or Username *</Label>
                    <Input
                      id="name"
                      placeholder="Your name or username"
                      value={socialInfo.name}
                      onChange={(e) => handleSocialInfoChange('name', e.target.value)}
                      required
                    />
                    <p className="text-sm text-gray-500">This will be displayed on your profile</p>
                  </div>

                  <div className="space-y-3">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      value={socialInfo.email}
                      disabled
                    />
                    <p className="text-sm text-gray-500">Connected via Privy</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <Label htmlFor="twitter">Twitter Handle</Label>
                    <Input
                      id="twitter"
                      placeholder="@username"
                      value={socialInfo.twitter}
                      onChange={(e) => handleSocialInfoChange('twitter', e.target.value)}
                    />
                    <p className="text-sm text-gray-500">Your Twitter username without @</p>
                  </div>

                  <div className="space-y-3">
                    <Label htmlFor="telegram">Telegram Handle</Label>
                    <Input
                      id="telegram"
                      placeholder="@username"
                      value={socialInfo.telegram}
                      onChange={(e) => handleSocialInfoChange('telegram', e.target.value)}
                    />
                    <p className="text-sm text-gray-500">Your Telegram username without @</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <Label htmlFor="website">Website</Label>
                    <Input
                      id="website"
                      placeholder="https://yourwebsite.com"
                      value={socialInfo.website}
                      onChange={(e) => handleSocialInfoChange('website', e.target.value)}
                    />
                    <p className="text-sm text-gray-500">Your personal or business website</p>
                  </div>

                  <div className="space-y-3">
                    <Label htmlFor="github">GitHub</Label>
                    <Input
                      id="github"
                      placeholder="username"
                      value={socialInfo.github}
                      onChange={(e) => handleSocialInfoChange('github', e.target.value)}
                    />
                    <p className="text-sm text-gray-500">Your GitHub username</p>
                  </div>
                </div>

                <div className="mt-4 p-4 bg-primary/5 rounded-lg border border-primary/10">
                  <div className="flex items-start gap-3">
                    <Building2 className="w-5 h-5 text-primary mt-0.5" />
                    <div>
                      <h3 className="font-medium text-primary">Coming Soon: Organizations</h3>
                      <p className="text-sm text-gray-600 mt-1">
                        Soon you'll be able to create an organization for your project or team.
                        This will help you manage multiple projects and collaborate with others.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-between items-center pt-8">
          <Button
            variant="outline"
            onClick={() => router.push('/interests')}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Interests
          </Button>
          <form onSubmit={handleSubmit}>
            <Button
              type="submit"
              className="px-8"
              size="lg"
            >
              Complete Profile
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>
    </OnboardingLayout>
  );
} 