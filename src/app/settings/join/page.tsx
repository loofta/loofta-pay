'use client';
import { useEffect, useState, useRef } from 'react';
import { useTelegramUser } from '@/context/TelegramUserContext';
import Title from '@/components/Title';
import PrimaryBtn from '@/components/PrimaryBtn';
import SecondaryBtn from '@/components/SecondaryBtn';
import { addFreelancer } from '@/app/actions/freelancers/freelancers';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from "@/components/ui/use-toast";
import { useTonAddress } from '@tonconnect/ui-react';
import PreviousButton from '@/components/PreviousButton';
import { SETTINGS_ROUTE } from '@/app/utils/routes';
import ReviewProfile from './review';
import { createDeal } from '@/app/actions/deals/deals';
import { notifyDealReceived } from '@/services/notificationService';
import { v4 as uuidv4 } from 'uuid';
type FormData = {
  twitterHandle: string;
  jobTitle: string;
  services: string;
  country: string;
  email: string;
  fullName: string;
  github: string;
  website: string;
  description: string;
  referralUser: string;
};

// Define questions outside the component

// Define questions outside the component
const questions = [
  {
    name: 'fullName',
    label: "What's your name?",
    editable: true,
    emoji: '👤',
    placeholder: 'e.g. John Doe',
    description: "Please provide the name you'd like to showcase on your profile—this could be your full name or a nickname."
  },
  {
    name: 'email',
    label: "What's your email address?",
    editable: true,
    emoji: '📧',
    placeholder: 'e.g. hello@loofta.xyz',
    description: "A valid email address is essential for updates and communications. Make sure it’s correct!"
  },
  {
    name: 'twitterHandle',
    label: "What's your Twitter handle?",
    editable: true,
    emoji: '🐦',
    placeholder: 'e.g. @looftaxyz',
    description: "Your Twitter handle helps us verify your account. Ensure it’s valid, like @looftaxyz."
  },
  {
    name: 'jobTitle',
    label: "What's your current job title?",
    editable: true,
    emoji: '💼',
    placeholder: 'e.g. KOL | Marketing Manager | Content Creator',
    description: "Let us know your role! Examples include KOL, Marketing Manager, Ambassador, Content Creator, etc."
  },
  {
    name: 'country',
    label: "Which country are you based in?",
    editable: true,
    emoji: '🌍',
    placeholder: 'e.g. Nigeria',
    description: "Your country of residence helps us with timezone coordination."
  },
  {
    name: 'services',
    label: "What services can you offer?",
    editable: true,
    emoji: '🛠️',
    textarea: true,
    placeholder: 'e.g. Shill Post, Twitter Thread, Hosting Space',
    description: 'List the services you can provide. Examples: Shill Post, Twitter Space, Graphic Design, Web Development, etc.'
  },
  {
    name: 'description',
    label: "Tell us about yourself in a few sentences",
    editable: true,
    emoji: '📝',
    textarea: true,
    placeholder: 'e.g. I am a marketing manager with 5 years of experience in the web3 space',
    description: 'Share a brief overview of who you are, what you do, and what you bring to the table.'
  },
  {
    name: 'website',
    label: "What's your website URL?",
    editable: true,
    emoji: '🌐',
    placeholder: 'e.g. https://loofta.xyz',
    description: 'If you have a website or portfolio, please share the link. Using linktr.ee is a great option too!'
  },
  {
    name: 'github',
    label: "What's your GitHub profile link?",
    editable: true,
    emoji: '🖥️',
    placeholder: 'e.g. https://github.com/looftaxyz',
    description: "Share your GitHub URL if you have one, or skip if you don’t."
  },
  {
    name: 'referralUser',
    label: "Who referred you to us?",
    editable: true,
    emoji: '🤝',
    placeholder: 'e.g. @looftaxyz',
    description: 'If someone pointed you in our direction, let us know their X handle! Skip this if you weren’t referred.'
  }
];


export default function JoinAsFreelancerPage() {
  const { userData } = useTelegramUser();
  const walletAddress = useTonAddress(true);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [formData, setFormData] = useState<FormData>({
    twitterHandle: '@',
    jobTitle: '',
    services: '',
    country: '',
    email: '',
    fullName: '',
    github: '',
    website: '',
    description: '',
    referralUser: '@',
  });

  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isEditMode, setIsEditMode] = useState(searchParams.has('edit'));

  const questionContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  const [isFocused, setIsFocused] = useState(false);

  const handleBackgroundTap = (e: React.MouseEvent) => {
    // Only blur if clicking outside the input
    if (!inputRef.current?.contains(e.target as Node)) {
      inputRef.current?.blur();
    }
  };

  useEffect(() => {
    const storedFreelancerProfile = localStorage.getItem('freelancerProfile') || window.Telegram?.WebApp?.storage?.getItem('freelancerProfile');
    if (storedFreelancerProfile) {
      setIsEditMode(true);
      const parsedProfile = JSON.parse(storedFreelancerProfile);
      setFormData((prevData) => ({ ...prevData, ...parsedProfile }));
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name as keyof FormData]: (name === 'twitterHandle' || name === 'referralUser')
        ? `@${value.replace(/^@/, '')}`
        : value,
    }));
  };

  const handleNext = () => {
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(prev => prev + 1);
      // Clear any existing focus
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }
  };

  const handleSubmit = async () => {
    try {
      const strippedTwitterHandle = formData.twitterHandle.replace(/^@/, '');

      const result = await addFreelancer({
        ...formData,
        twitterHandle: strippedTwitterHandle.toLowerCase().trim(),
        telegramHandle: userData?.username?.toLowerCase().trim() || '',
        telegramId: userData?.id,
        category: 'in-app join',
        walletAddress: walletAddress || '',
      });
      if (result.success) {
        localStorage.setItem('freelancerProfile', JSON.stringify(formData));
        window.Telegram?.WebApp?.storage?.setItem('freelancerProfile', JSON.stringify(formData));
        const points = formData.referralUser && formData.referralUser !== '@' ? 30 : 15;
        const generatedId = uuidv4();
        if (!isEditMode) {

          await createDeal({
            id: generatedId,
            title: '🎉 Welcome Deal - Earn ' + points + ' Points!',
            description: 'Welcome to Loofta! You’re now part of a community that’s all about connecting talent with opportunities. \\n \\n ' +
              '**Ready to dive in? Here’s how to complete this deal and earn ' + points + ' points:** \\n \\n ' +
              '1. Follow **@looftaxyz** on X (x.com/looftaxyz) \\n ' +
              '2. Join our Loofta Telegram channel for updates: **https://t.me/loofta** \\n ' +
              '3. Retweet this post: **https://x.com/looftaxyz/status/1852294091888848969** \\n \\n ' +
              '🌟 **Reminder:** Earn 150 points to be eligible for your first profile review. Let’s get you noticed! \\n \\n ' +
              'Once you’ve completed these tasks, confirm your delivery, and we’ll verify your submission.',
            walletAddress: walletAddress || '',
            paymentStatus: 'unpaid',
            expectedDeliveryDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            recipientWalletAddress: walletAddress || '',
            recipientId: result.freelancerId || '',
            senderTgId: 7815070412,
            senderTgUsername: 'looftaxyz',
            recipientTgId: userData?.id || null,
            recipientTgUsername: userData?.username?.toLowerCase().trim() || '',
            amount: 0,
            points: points,
            campaignId: 'in-app-join',
            requireSubmission: true
          }).then(() => {
            console.log('deal created', userData);
            return notifyDealReceived(generatedId, userData?.id || null);
          });
        }

        toast({ description: isEditMode ? 'Profile updated successfully!' : 'Profile created successfully!' });
        router.push(SETTINGS_ROUTE);
      }
    } catch (error) {
      toast({ description: 'Failed to create profile.', variant: 'destructive' });
    }
  };

  const handleReviewProfile = () => {
    // Validate required fields before showing review
    const requiredFields = ['twitterHandle', 'jobTitle', 'services', 'country', 'email', 'fullName', 'description'] as const;
    const missingFields = requiredFields.filter(field => !formData[field as keyof FormData]);

    if (missingFields.length > 0) {
      toast({
        description: `Please fill in all required fields`,
        variant: "destructive"
      });
      return;
    }

    // Email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      toast({
        description: "Please enter a valid email address",
        variant: "destructive"
      });
      return;
    }

    // If all validations pass, show review
    setIsReviewing(true);
  };

  const { name, label, description, emoji, placeholder, textarea, editable } = questions[currentQuestion];
  const isLastStep = currentQuestion === questions.length - 1;

  const handleFieldFocus = () => {
    setIsFocused(true);
  };

  const handleFieldBlur = () => {
    setIsFocused(false);
  };

  if (isReviewing) {
    return (
      <ReviewProfile
        isEditMode={isEditMode}
        formData={formData}
        onBack={() => setIsReviewing(false)}
        onConfirm={handleSubmit}
      />
    );
  }

  return (
    <div className='min-h-screen tg-webview flex flex-col'>
      <div className="flex flex-col flex-1">
        <div
          className='flex-1 overflow-y-auto space-y-4 mt-4 px-4 mx-0 pb-24'
        >
          <div className='mb-4'>
            <Title showPrevious showWallet={false} text={isEditMode ? "Edit Your Profile" : "Create Your Profile"} customProperties='mt-2' />

          </div>

          {/* Main Container */}
          <div className="flex-grow flex flex-col justify-start pt-4"> {/* Added padding to avoid overlap with fixed header */}
            {/* Progress Bar */}
            <div className="w-full bg-gray-200 h-2">
              <div
                className="bg-orange-600 h-full"
                style={{ width: `${((currentQuestion + 1) / questions.length) * 100}%` }}
              />
            </div>
            <p className="text-center text-gray-600 mt-1">
              Step {currentQuestion + 1} of {questions.length}
            </p>

            {/* Main Form - Centered Content */}
            <div className="flex-grow flex flex-col justify-center items-center text-center mt-4">
              <div className="w-full space-y-4">
                <div
                  ref={questionContainerRef}
                  className={`p-4 bg-white rounded-lg shadow-lg ${isFocused ? 'mt-0' : ''}`}
                >
                  {!isFocused ? (
                    <>
                      <div className="flex items-center mb-4 justify-center">
                        <h1 className="text-4xl font-bold">{emoji}</h1>
                      </div>
                      <h1 className="text-2xl font-bold">{label}</h1>
                      <p className="text-xl mb-2 text-gray-500">{description}</p>
                      {!editable && isEditMode && <p className="text-sm text-gray-500">You cannot edit this field</p>}
                    </>
                  ) : (
                    <p className="text-sm mt-0 mb-0 text-gray-500">{label}</p>
                  )}
                  {textarea ? (
                    <textarea
                      ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                      name={name}
                      placeholder={placeholder}
                      value={formData[name as keyof FormData]}
                      onChange={handleInputChange}
                      onFocus={handleFieldFocus}
                      onBlur={handleFieldBlur}
                      className="w-full p-3 mt-2 text-lg border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 min-h-[130px]"
                    />
                  ) : (
                    <input
                      ref={inputRef as React.RefObject<HTMLInputElement>}
                      type="text"
                      name={name}
                      placeholder={placeholder}
                      value={formData[name as keyof FormData]}
                      onChange={handleInputChange}
                      onFocus={handleFieldFocus}
                      onBlur={handleFieldBlur}
                      disabled={isEditMode && !editable}
                      className="w-full p-3 mt-2 text-lg border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                    />
                  )}
                </div>
              </div>
            </div>
          </div>





          {/* Cancel Confirmation Modal */}
          {isModalOpen && (
            <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50">
              <div className="bg-white p-6 rounded-lg shadow-lg w-11/12 max-w-md">
                <h2 className="text-lg font-semibold mb-4">Are you sure you want to cancel?</h2>
                <p className="text-sm text-gray-600 mb-6">
                  Your information is not saved. Are you sure you want to cancel?
                </p>
                <div className="flex flex-col space-y-2">
                  <SecondaryBtn
                    text="Cancel"
                    onClick={() => setIsModalOpen(false)}
                  />
                  <PrimaryBtn
                    text="Confirm"
                    onClick={() => {
                      setIsModalOpen(false);
                      router.back();
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="w-full bg-white p-2 pb-1 fixed bottom-0 left-0 right-0 border-t">
          <div className="flex flex-col gap-0">
            {currentQuestion !== 0 && (
              <SecondaryBtn
                text="Back"
                onClick={() => setCurrentQuestion(currentQuestion - 1)}
              />
            )}
            <PrimaryBtn
              text={
                isLastStep
                  ? "Review Profile"
                  : (currentQuestion === 7 && !formData.website) || (currentQuestion === 8 && !formData.github)
                    ? "Skip"
                    : "Next"
              }
              onClick={
                isLastStep
                  ? handleReviewProfile
                  : handleNext
              }
              disabled={
                isLastStep
                  ? false
                  : currentQuestion === 0
                    ? !formData.fullName
                    : currentQuestion === 1
                      ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)
                      : currentQuestion === 2
                        ? formData.twitterHandle.length < 3
                        : currentQuestion === 7 || currentQuestion === 8
                          ? false  // website and github are optional
                          : !formData[name as keyof FormData]
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}


