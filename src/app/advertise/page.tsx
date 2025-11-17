'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { Button } from '@/components/ui/button';
import { Users, ArrowRight, CheckCircle, Shield, X, Plus } from 'lucide-react';
import DashboardLayout from '@/components/layouts/DashboardLayout';
import Title from '@/components/Title';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { usePayment } from '@/hooks/usePayment';
import { toast } from '@/components/ui/use-toast';
import { Checkbox } from '@/components/ui/checkbox';
import confetti from 'canvas-confetti';
import PrimaryBtn from '@/components/PrimaryBtn';
import PaymentMethod from '@/components/PaymentMethod';
import { getUserByPrivyId } from '@/app/actions/users/users';
import { createCampaign } from '@/app/actions/campaigns/advertiseCampaign';

interface TaskType {
  id: string;
  link: string;
  options?: string[];
}

interface CustomTaskType {
  description: string;
  link: string;
}

const DURATION_OPTIONS = [
  {
    value: '1week',
    label: '1 Week Campaign',
    price: 150,
    description: 'Perfect for short-term campaigns and quick engagement boosts',
    features: [
      '7 days of promotion',
      '50 USDT of blocked for creators in case of a dispute',
      'Access to 3500+ Web3 ambassadors',
      'Basic analytics dashboard'
    ],
    emoji: '⏳',
    popular: true,
  },
  {
    value: '1month',
    label: '1 Month Campaign',
    price: 500,
    originalPrice: 550,
    description: 'Ideal for sustained growth and community building',
    features: [
      '30 days of active promotion',
      'Weekly new deals',
      'Promotion on Telegram and X',
      '50 USDT of blocked for creators in case of a dispute',
      'Weekly task management available'
    ],
    emoji: '📅',
    discount: '10% OFF',
    featured: true,
  },
  {
    value: '24h_trial',
    label: '24h Trial',
    price: 50,
    description: 'Perfect for testing the waters and quick campaigns',
    features: [
      '24 hours of promotion',
      'Access to 3500+ Web3 ambassadors',
      'Basic analytics dashboard'
    ],
    emoji: '🚀',
    trial: true,
    special: true,
  }
];

const KOL_PACKAGES = [
  {
    id: 'kol-spark',
    title: 'Spark KOL Package',
    description: '10,000+ guaranteed impressions',
    price: 199,
    features: [
      '1 Platinum KOL post (10K+ followers)',
      '5+ VIP Creator posts (1K+ followers)',
      '5% average engagement rate',
      'Access to all content submissions',
    ],
    emoji: '🔥',
  },
  {
    id: 'kol-boost',
    title: 'Boost KOL Package',
    description: '30,000+ guaranteed impressions',
    price: 499,
    features: [
      '2 Platinum KOL posts (10K+ followers)',
      '10+ VIP Creator posts (1K+ followers)',
      '5% average engagement rate',
      '1 X Space on Loofta Spotlight',
      'Cross-platform promotion (X, Medium, TikTok, CMC, Binance Square, Instagram)',
      'Access to all content submissions',
    ],
    emoji: '🚀',
  }
];

const ADDONS = [
  {
    id: 'telegram',
    title: 'Post on our TG channel + X page',
    description: 'Get your campaign promoted on our official channels',
    price: 30,
    icon: '📢'
  },
  {
    id: 'space',
    title: 'Space on Loofta Spotlight',
    description: 'Get your project featured on our Loofta Spotlight AMA space',
    price: 50,
    icon: '🎤'
  }
];

const TASK_TEMPLATES = [
  {
    id: 'follow_x',
    title: 'Follow on X',
    icon: '𝕏',
    placeholder: 'Your X profile link'
  },
  {
    id: 'engage_post',
    title: 'Engage with Post',
    icon: '💬',
    placeholder: 'Post URL',
    options: ['Like', 'Comment', 'Retweet', 'Bookmark'],
    multiSelect: true
  },
  {
    id: 'join_telegram',
    title: 'Join Telegram',
    icon: '📱',
    placeholder: 'Your Telegram group link'
  },
  {
    id: 'join_discord',
    title: 'Join Discord',
    icon: '🎮',
    placeholder: 'Your Discord server link'
  },
  {
    id: 'visit_website',
    title: 'Visit Website',
    icon: '🌐',
    placeholder: 'Website URL'
  },
  {
    id: 'follow_medium',
    title: 'Follow on Medium',
    icon: '📝',
    placeholder: 'Medium profile link'
  },
  {
    id: 'subscribe_youtube',
    title: 'Subscribe to YouTube',
    icon: '🎥',
    placeholder: 'YouTube channel link'
  },
  {
    id: 'tiktok',
    title: 'Follow on TikTok',
    icon: '🎵',
    placeholder: 'TikTok profile link'
  },
  {
    id: 'connect_wallet',
    title: 'Connect Wallet',
    icon: '👛',
    placeholder: 'Describe what wallet the user needs to connect (e.g., MetaMask, WalletConnect, etc.)',
    inputType: 'text',
  }
];

const CREATOR_CONTEST_TYPES = [
  {
    id: 'creator_contest',
    title: 'Creator Contest',
    icon: '🎨',
    description: 'Engage our Web3 ambassadors to create content about your project',
    price: 250,
    features: [
      'Web3 ambassadors participation',
      '200$ Prize pool included',
      'Community engagement',
      'Content ownership rights'
    ]
  }
];

// Add new rewards configuration
const REWARD_DISTRIBUTION_TYPES = [
  {
    id: 'fcfs',
    title: 'First-Come, First-Served',
    description: 'Rewards go to the first users who complete the task',
    icon: '⚡'
  },
  {
    id: 'raffle',
    title: 'Raffle',
    description: 'Completed entries are entered into a random draw',
    icon: '🎲'
  },
  {
    id: 'top_performers',
    title: 'Top Performers',
    description: 'Rewards go to the leaderboard leaders',
    icon: '🏆'
  }
];

const REWARD_TYPES = [
  {
    id: 'usdt',
    title: 'USDT',
    description: 'Additional rewards in USDT (on top of our included reward pool)',
    icon: '💵',
    guaranteed: true
  },
  {
    id: 'project_token',
    title: 'Project Token',
    description: 'Rewards in your project token or other token',
    icon: '🎯',
    guaranteed: false
  },
  {
    id: 'whitelist',
    title: 'Whitelist / Airdrop / NFT',
    description: 'Whitelist spots, airdrop spots, or NFT rewards for your project',
    icon: '📝',
    guaranteed: false
  },
  {
    id: 'custom',
    title: 'Custom Rewards',
    description: 'Describe your own unique rewards (merch, exclusive access, etc.)',
    icon: '🎁',
    guaranteed: false
  }
];

interface UserProfile {
  id: string;
  socialInfo?: {
    telegram?: string;
    email?: string;
    name?: string;
  };
}

export default function AdvertisePage() {
  const router = useRouter();
  const { user } = usePrivy();
  const { makePayment, isLoading: isPaymentLoading } = usePayment();
  const [currentStep, setCurrentStep] = useState(1);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentStep, setPaymentStep] = useState(1);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'automated' | 'manual' | null>(null);
  const [selectedDuration, setSelectedDuration] = useState(DURATION_OPTIONS[0]);
  const [selectedAddons, setSelectedAddons] = useState<string[]>([]);
  const [selectedKolPackage, setSelectedKolPackage] = useState<string | null>(null);
  const [weeklyTasks, setWeeklyTasks] = useState<Record<number, { selectedTasks: TaskType[]; customTasks: CustomTaskType[] }>>({
    1: { selectedTasks: [], customTasks: [] },
    2: { selectedTasks: [], customTasks: [] },
    3: { selectedTasks: [], customTasks: [] },
    4: { selectedTasks: [], customTasks: [] },
  });
  const [currentWeek, setCurrentWeek] = useState(1);
  const [currentDay, setCurrentDay] = useState(1);
  const [newCustomTask, setNewCustomTask] = useState({ description: '', link: '' });
  const [projectDetails, setProjectDetails] = useState({
    description: '',
    roadmap: '',
    tvl: '',
    mau: '',
    goals: '',
    cta: '',
    targetAudience: ''
  });
  const [showCustomTaskInput, setShowCustomTaskInput] = useState(false);
  const [skipKol, setSkipKol] = useState(false);
  const [editingTaskIndex, setEditingTaskIndex] = useState<number | null>(null);
  const [selectedContestType, setSelectedContestType] = useState<string | null>(null);
  const [contestDetails, setContestDetails] = useState<Record<string, string>>({});
  const [kolDetails, setKolDetails] = useState({
    goals: '',
    cta: '',
    targetAudience: ''
  });
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskSearch, setTaskSearch] = useState('');
  const [selectedRewardType, setSelectedRewardType] = useState<string | null>(null);
  const [rewardPool, setRewardPool] = useState('');
  const [selectedDistributionType, setSelectedDistributionType] = useState<string | null>(null);
  const [numberOfWinners, setNumberOfWinners] = useState('');
  const [rewardCriteria, setRewardCriteria] = useState('');
  const [tokenContract, setTokenContract] = useState('');
  const [tokenTicker, setTokenTicker] = useState('');
  const [telegramHandle, setTelegramHandle] = useState('');
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [customRewardDescription, setCustomRewardDescription] = useState('');

  const totalPrice = selectedDuration.price +
    (selectedKolPackage ? KOL_PACKAGES.find(p => p.id === selectedKolPackage)?.price || 0 : 0) +
    (selectedContestType ? CREATOR_CONTEST_TYPES.find(t => t.id === selectedContestType)?.price || 0 : 0) +
    ADDONS.filter(addon => selectedAddons.includes(addon.id))
      .reduce((sum, addon) => sum + (addon.price || 0), 0);

  // Categorize tasks for modal
  const categorizedTasks = useMemo(() => {
    return [
      {
        category: 'Actions',
        tasks: TASK_TEMPLATES.filter(t => ['visit_website', 'subscribe_youtube', 'connect_wallet', 'engage_post'].includes(t.id)),
      },
      {
        category: 'Social',
        tasks: TASK_TEMPLATES.filter(t => ['join_discord', 'join_telegram', 'follow_x', 'tiktok', 'follow_medium'].includes(t.id)),
      },
      // Add more categories as needed
      {
        category: 'Custom',
        tasks: [{ id: 'custom', title: 'Custom Task', icon: '✨', placeholder: 'Define your own task' }],
      },
    ];
  }, []);

  const filteredTasks = useMemo(() => {
    if (!taskSearch.trim()) return categorizedTasks;
    return categorizedTasks.map(cat => ({
      ...cat,
      tasks: cat.tasks.filter(t => t.title.toLowerCase().includes(taskSearch.toLowerCase())),
    })).filter(cat => cat.tasks.length > 0);
  }, [taskSearch, categorizedTasks]);

  const handleAddTask = (taskId: string) => {
    const task = TASK_TEMPLATES.find(t => t.id === taskId);
    const targetWeek = selectedDuration.value === '24h_trial' ? 1 : currentWeek;
    setWeeklyTasks(prev => {
      const updatedTasks = [
        ...prev[targetWeek].selectedTasks,
        taskId === 'engage_post' ? { id: taskId, link: '', options: [] } : { id: taskId, link: '' }
      ];
      setEditingTaskIndex(updatedTasks.length - 1);
      return {
        ...prev,
        [targetWeek]: {
          ...prev[targetWeek],
          selectedTasks: updatedTasks
        }
      };
    });
  };

  const handleRemoveTask = (index: number) => {
    const targetWeek = selectedDuration.value === '24h_trial' ? 1 : currentWeek;
    setWeeklyTasks(prev => ({
      ...prev,
      [targetWeek]: {
        ...prev[targetWeek],
        selectedTasks: prev[targetWeek].selectedTasks.filter((_, i) => i !== index)
      }
    }));
  };

  const handleTaskLinkChange = (index: number, link: string) => {
    const targetWeek = selectedDuration.value === '24h_trial' ? 1 : currentWeek;
    setWeeklyTasks(prev => {
      const newTasks = [...prev[targetWeek].selectedTasks];
      newTasks[index].link = link;
      return {
        ...prev,
        [targetWeek]: {
          ...prev[targetWeek],
          selectedTasks: newTasks
        }
      };
    });
  };

  const handleSaveTask = (index: number) => {
    if (weeklyTasks[currentWeek].selectedTasks[index].link.trim()) {
      setEditingTaskIndex(null);
    }
  };

  const handleEditTask = (index: number) => {
    setEditingTaskIndex(index);
  };

  const handleAddCustomTask = () => {
    if (newCustomTask.description.trim()) {
      const targetWeek = selectedDuration.value === '24h_trial' ? 1 : currentWeek;
      setWeeklyTasks(prev => ({
        ...prev,
        [targetWeek]: {
          ...prev[targetWeek],
          customTasks: [...prev[targetWeek].customTasks, { ...newCustomTask }]
        }
      }));
      setNewCustomTask({ description: '', link: '' });
      setShowCustomTaskInput(false);
    }
  };

  const handleRemoveCustomTask = (index: number) => {
    const targetWeek = selectedDuration.value === '24h_trial' ? 1 : currentWeek;
    setWeeklyTasks(prev => ({
      ...prev,
      [targetWeek]: {
        ...prev[targetWeek],
        customTasks: prev[targetWeek].customTasks.filter((_, i) => i !== index)
      }
    }));
  };

  const handleCustomTaskChange = (field: 'description' | 'link', value: string) => {
    setNewCustomTask(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleNext = () => {
    if (currentStep === 2) {
      if (weeklyTasks[currentWeek].selectedTasks.length === 0 && weeklyTasks[currentWeek].customTasks.length === 0) {
        toast({
          title: "Error",
          description: "Please add at least one task",
          variant: "destructive",
        });
        return;
      }
    }
    if (currentStep === 3) {
      if (!selectedDuration) {
        toast({
          title: "Error",
          description: "Please select a campaign duration",
          variant: "destructive",
        });
        return;
      }
    }
    // KOL validation removed - step 4 is now commented out
    /*
    if (currentStep === 4) {
      if (selectedKolPackage && selectedKolPackage !== 'skip' && !kolDetails.goals) {
        toast({
          title: "Error",
          description: "Please fill in the KOL campaign details",
          variant: "destructive",
        });
        return;
      }
    }
    */
    if (currentStep === 4) {
      if (selectedContestType === 'creator_contest' && !contestDetails.instructions) {
        toast({
          title: "Error",
          description: "Please fill in contest details",
          variant: "destructive",
        });
        return;
      }
    }
    setCurrentStep(prev => prev + 1);
  };

  const handleBack = () => {
    setCurrentStep(prev => prev - 1);
  };

  const handleNextPaymentStep = () => {
    if (!telegramHandle.trim()) {
      toast({
        title: "Error",
        description: "Please enter your Telegram handle before proceeding.",
        variant: "destructive",
      });
      return;
    }
    setPaymentStep(2);
  };

  const handleBackPaymentStep = () => {
    setPaymentStep(1);
  };

  const validateRewardAmount = () => {
    if (selectedRewardType === 'none' || !selectedRewardType) {
      return true; // Skip option is always valid
    }
    if (selectedRewardType === 'whitelist') {
      return Number(numberOfWinners) > 0;
    }
    if (selectedRewardType === 'custom') {
      return customRewardDescription.trim() !== '';
    }
    if (selectedRewardType === 'usdt') {
      return Number(rewardPool) > 0;
    }
    if (selectedRewardType === 'project_token') {
      return tokenContract.trim() !== '' && tokenTicker.trim() !== '';
    }
    return true; // No reward type selected is also valid
  };

  const validateProjectToken = () => {
    if (selectedRewardType === 'project_token') {
      return tokenContract.trim() !== '' && tokenTicker.trim() !== '';
    }
    return true;
  };

  // Add useEffect to fetch user profile when payment modal opens
  useEffect(() => {
    const fetchUserProfile = async () => {
      if (showPaymentModal && user?.id) {
        setIsLoadingProfile(true);
        try {
          const result = await getUserByPrivyId(user.id);
          if (result.success && result.user) {
            const userProfile = result.user as UserProfile;
            if (userProfile.socialInfo?.telegram) {
              setTelegramHandle(userProfile.socialInfo.telegram);
            }
          }
        } catch (error) {
          console.error('Error fetching user profile:', error);
        } finally {
          setIsLoadingProfile(false);
        }
      }
    };

    fetchUserProfile();
  }, [showPaymentModal, user?.id]);

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-6">
            <div className="bg-gradient-to-br from-orange-50 to-yellow-50 rounded-2xl p-8 shadow-sm border border-orange-200">
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-3xl">🌟</span>
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-4">Build Active Communities with Loofta</h3>
                <p className="text-lg text-gray-700">
                  Get real engagement from 3500+ verified Web3 ambassadors
                </p>
              </div>

              <div className="grid md:grid-cols-3 gap-6 mb-8">
                <div className="text-center">
                  <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <span className="text-xl">📝</span>
                  </div>
                  <h4 className="font-semibold text-gray-900 mb-2">Create Tasks</h4>
                  <p className="text-sm text-gray-600">Set up engaging actions for our community</p>
                </div>

                <div className="text-center">
                  <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <span className="text-xl">👥</span>
                  </div>
                  <h4 className="font-semibold text-gray-900 mb-2">Community Engages</h4>
                  <p className="text-sm text-gray-600">Real users complete your tasks</p>
                </div>

                <div className="text-center">
                  <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <span className="text-xl">📈</span>
                  </div>
                  <h4 className="font-semibold text-gray-900 mb-2">Grow Together</h4>
                  <p className="text-sm text-gray-600">Get authentic followers & engagement</p>
                </div>
              </div>


              <div className="bg-white p-6 rounded-xl border border-orange-200 shadow-sm">
                <h4 className="font-semibold text-gray-900 mb-4 text-center">What You'll Get</h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="flex items-center gap-2 text-base">
                    <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                    <span className="text-gray-700">3500+ ambassadors</span>
                  </div>
                  <div className="flex items-center gap-2 text-base">
                    <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                    <span className="text-gray-700">Real engagement</span>
                  </div>
                  <div className="flex items-center gap-2 text-base">
                    <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                    <span className="text-gray-700">Analytics dashboard</span>
                  </div>
                  <div className="flex items-center gap-2 text-base">
                    <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                    <span className="text-gray-700">24/7 support</span>
                  </div>
                  <div className="flex items-center gap-2 text-base">
                    <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                    <span className="text-gray-700">Authentic growth</span>
                  </div>
                  <div className="flex items-center gap-2 text-base">
                    <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                    <span className="text-gray-700">Web3 focused</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200/75">
              {/* Duration-based Task Management */}
              {selectedDuration.value === '1month' && (
                <div className="flex gap-2 mb-4">
                  {[1, 2, 3, 4].map(week => (
                    <Button
                      key={week}
                      variant={currentWeek === week ? "default" : "outline"}
                      onClick={() => setCurrentWeek(week)}
                    >
                      Week {week}
                    </Button>
                  ))}
                </div>
              )}
              {selectedDuration.value === '24h_trial' && (
                <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-200">
                  <div className="flex items-center gap-2 text-blue-800">
                    <span className="text-lg">⏰</span>
                    <span className="text-sm font-medium">24-Hour Trial Campaign</span>
                  </div>
                  <p className="text-xs text-blue-700 mt-1">
                    This is a trial campaign that runs for 24 hours. Add your tasks below.
                  </p>
                </div>
              )}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 md:gap-0 mb-4 md:mb-6">
                <div>
                  <h3 className="text-lg md:text-xl font-bold text-gray-900 mb-1">Campaign Tasks</h3>
                  <p className="text-sm md:text-base text-gray-600">Choose up to 8 engaging tasks for our community of web3 ambassadors and creators to complete</p>
                </div>
                <div className="text-center">
                  <div className="inline-flex items-center px-3 md:px-4 py-2 rounded-full text-base md:text-lg font-bold bg-orange-100 text-orange-700 border-2 border-orange-200 shadow-sm">
                    <span className="text-xl md:text-2xl mr-2">📊</span>
                    {selectedDuration.value === '24h_trial'
                      ? `${weeklyTasks[1].selectedTasks.length + weeklyTasks[1].customTasks.length}/8 tasks`
                      : `${weeklyTasks[currentWeek].selectedTasks.length + weeklyTasks[currentWeek].customTasks.length}/8 tasks`
                    }
                  </div>
                </div>
              </div>

              {/* Intro Section */}
              <div className="mb-4 md:mb-6 p-3 md:p-4 rounded-lg bg-gradient-to-r from-orange-50 to-yellow-50 border border-orange-200">
                <div className="flex items-center gap-2 md:gap-3 mb-3">
                  <div className="w-8 h-8 md:w-10 md:h-10 bg-white rounded-full flex items-center justify-center shadow-sm">
                    <span className="text-lg md:text-xl">🎯</span>
                  </div>
                  <div>
                    <h4 className="text-base md:text-lg font-semibold text-gray-900">Campaign Tasks</h4>
                    <p className="text-xs md:text-sm text-gray-700">Actions for Web3 ambassadors/creators to complete</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 text-xs md:text-sm">
                  <div>
                    <h5 className="font-medium text-gray-900 mb-1 md:mb-2">Examples:</h5>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-orange-500">•</span>
                        <span>Follow social media</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-orange-500">•</span>
                        <span>Join Telegram/Discord</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-orange-500">•</span>
                        <span>Visit website</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h5 className="font-medium text-gray-900 mb-1 md:mb-2">Benefits:</h5>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-green-500">✓</span>
                        <span>Real users, no bots</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-green-500">✓</span>
                        <span>Web3 focused</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-green-500">✓</span>
                        <span>Authentic engagement</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mb-4 md:mb-6 flex flex-col items-center gap-2">
                {(() => {
                  const targetWeek = selectedDuration.value === '24h_trial' ? 1 : currentWeek;
                  const taskCount = weeklyTasks[targetWeek].selectedTasks.length + weeklyTasks[targetWeek].customTasks.length;
                  return (
                    <>
                      <PrimaryBtn
                        icon={Plus}
                        text="Add Task"
                        customProperties="w-full md:w-1/2"
                        onClick={() => setShowTaskModal(true)}
                        disabled={taskCount >= 8}
                      />
                      {taskCount >= 8 && (
                        <span className="text-xs text-orange-600 font-semibold mt-1">Maximum 8 tasks allowed</span>
                      )}
                    </>
                  );
                })()}
              </div>

              {/* Selected Tasks */}
              {(() => {
                const targetWeek = selectedDuration.value === '24h_trial' ? 1 : currentWeek;
                const hasTasks = weeklyTasks[targetWeek].selectedTasks.length > 0 || weeklyTasks[targetWeek].customTasks.length > 0;

                if (!hasTasks) return null;

                return (
                  <div className="space-y-3">
                    <h4 className="font-medium text-sm text-gray-700">Selected Tasks</h4>
                    <div className="space-y-2">
                      {weeklyTasks[targetWeek].selectedTasks.map((task, index) => {
                        const taskTemplate = TASK_TEMPLATES.find(t => t.id === task.id);
                        const isEditing = editingTaskIndex === index;

                        return (
                          <div key={index} className="bg-orange-50 p-3 rounded-lg space-y-2 border border-orange-200">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <div className="bg-white p-1.5 rounded-lg">
                                  <span className="text-lg">{taskTemplate?.icon}</span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="font-medium text-gray-900 text-sm">{taskTemplate?.title}</span>
                                  {task.id === 'engage_post' && !isEditing && task.options && task.options.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                      {task.options.map((option) => (
                                        <span key={option} className="px-2 py-1 bg-orange-500 text-white rounded-full text-xs font-semibold">
                                          {option}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {!isEditing && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleEditTask(index)}
                                    className="h-7 hover:bg-orange-100"
                                  >
                                    Edit
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleRemoveTask(index)}
                                  className="h-7 w-7 hover:bg-orange-100"
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                            {task.id === 'engage_post' && isEditing && (
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                {TASK_TEMPLATES.find(t => t.id === 'engage_post')?.options?.map((option) => (
                                  <button
                                    key={option}
                                    type="button"
                                    onClick={() => {
                                      setWeeklyTasks(prev => {
                                        const newTasks = [...prev[targetWeek].selectedTasks];
                                        const currentOptions = Array.isArray(newTasks[index].options) ? newTasks[index].options : [];
                                        let updatedOptions;
                                        if (currentOptions.includes(option)) {
                                          updatedOptions = currentOptions.filter((o: string) => o !== option);
                                        } else {
                                          updatedOptions = [...currentOptions, option];
                                        }
                                        newTasks[index] = { ...newTasks[index], options: updatedOptions };
                                        return {
                                          ...prev,
                                          [targetWeek]: {
                                            ...prev[targetWeek],
                                            selectedTasks: newTasks
                                          }
                                        };
                                      });
                                    }}
                                    className={`p-2 rounded-lg border text-sm font-medium transition-all ${task.options?.includes(option)
                                      ? 'bg-orange-500 text-white border-orange-500'
                                      : 'bg-white border-gray-200 hover:border-orange-200 hover:bg-orange-50/50'
                                      }`}
                                  >
                                    {option}
                                  </button>
                                ))}
                              </div>
                            )}
                            {isEditing ? (
                              <div className="flex gap-2">
                                <Input
                                  value={task.link}
                                  onChange={(e) => handleTaskLinkChange(index, e.target.value)}
                                  placeholder={taskTemplate?.placeholder}
                                  className="text-sm bg-white flex-1"
                                />
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleSaveTask(index)}
                                  disabled={!task.link.trim() || (task.id === 'engage_post' && (!task.options || task.options.length === 0))}
                                  className="whitespace-nowrap"
                                >
                                  Save
                                </Button>
                              </div>
                            ) : (
                              task.link && (
                                <div className="flex items-center gap-2 text-sm text-gray-700">
                                  <span className="font-medium">Link:</span>
                                  <a
                                    href={task.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-orange-600 hover:text-orange-700 truncate"
                                  >
                                    {task.link}
                                  </a>
                                </div>
                              )
                            )}
                          </div>
                        );
                      })}

                      {weeklyTasks[targetWeek].customTasks.map((task, index) => (
                        <div key={index} className="bg-orange-50 p-3 rounded-lg space-y-2 border border-orange-200">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="bg-white p-1.5 rounded-lg">
                                <span className="text-lg">✨</span>
                              </div>
                              <span className="font-medium text-gray-900 text-sm">{task.description}</span>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemoveCustomTask(index)}
                              className="h-7 w-7 hover:bg-orange-100"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                          {task.link && (
                            <div className="flex items-center gap-2 text-sm text-gray-700">
                              <span className="font-medium">Link:</span>
                              <a
                                href={task.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-orange-600 hover:text-orange-700 truncate"
                              >
                                {task.link}
                              </a>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Add Task Modal */}
            <Dialog open={showTaskModal} onOpenChange={setShowTaskModal}>
              <DialogContent className="sm:max-w-[600px] w-[95vw] max-h-[90vh] overflow-y-auto animate-in fade-in-0 zoom-in-95 duration-200">
                <DialogHeader>
                  <DialogTitle className="text-xl">Select a Task Type</DialogTitle>
                  <DialogDescription>
                    <Input
                      placeholder="Find a task type"
                      value={taskSearch}
                      onChange={e => setTaskSearch(e.target.value)}
                      className="mt-2"
                    />
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-6 mt-4">
                  {filteredTasks.map(cat => (
                    <div key={cat.category}>
                      <h5 className="text-xs font-semibold text-gray-500 mb-2 uppercase">{cat.category}</h5>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {cat.tasks.map(task => (
                          <button
                            key={task.id}
                            className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-orange-200 hover:bg-orange-50/50 transition-all cursor-pointer w-full text-left"
                            onClick={() => {
                              if (task.id === 'custom') {
                                setShowTaskModal(false);
                                setShowCustomTaskInput(true);
                              } else {
                                handleAddTask(task.id);
                                setShowTaskModal(false);
                                setTaskSearch('');
                              }
                            }}
                            disabled={(() => {
                              const targetWeek = selectedDuration.value === '24h_trial' ? 1 : currentWeek;
                              return weeklyTasks[targetWeek].selectedTasks.length + weeklyTasks[targetWeek].customTasks.length >= 8;
                            })()}
                          >
                            <div className="bg-orange-50 p-2 rounded-lg">
                              <span className="text-lg">{task.icon}</span>
                            </div>
                            <div>
                              <span className="font-medium text-gray-900">{task.title}</span>
                              <p className="text-xs text-gray-500 mt-0.5">{task.placeholder}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </DialogContent>
            </Dialog>

            {/* Custom Task Input Modal */}
            <Dialog open={showCustomTaskInput} onOpenChange={setShowCustomTaskInput}>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>Add Custom Task</DialogTitle>
                  <DialogDescription>
                    Define your own custom task for participants to complete
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="task-description">Task Description</Label>
                    <Textarea
                      id="task-description"
                      value={newCustomTask.description}
                      onChange={(e) => handleCustomTaskChange('description', e.target.value)}
                      placeholder="Describe what participants need to do (create post, use your media kit, etc.)"
                      className="text-sm"
                      rows={4}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="task-link">Task Link (Optional)</Label>
                    <Input
                      id="task-link"
                      value={newCustomTask.link}
                      onChange={(e) => handleCustomTaskChange('link', e.target.value)}
                      placeholder="Add a link if needed (e.g., website, form, etc.)"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowCustomTaskInput(false);
                      setNewCustomTask({ description: '', link: '' });
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => {
                      handleAddCustomTask();
                      setShowCustomTaskInput(false);
                    }}
                    disabled={!newCustomTask.description.trim()}
                  >
                    Add Task
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div >
        );

      case 3:
        return (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200/75">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl">🕒</span>
                <h3 className="text-lg font-semibold">How long should your campaign run?</h3>
              </div>
              <div className="text-gray-700 mb-6 text-base">Pick a duration that fits your goals! Longer campaigns help build a stronger community. <span className="text-xl">🎉</span></div>

              {/* Campaign Duration Benefits */}
              {selectedDuration.value === '1month' && (
                <div className="mb-6 p-4 rounded-lg bg-blue-50/50 border border-blue-100">
                  <div className="flex items-start gap-3">
                    <div className="bg-white p-2 rounded-lg">
                      <span className="text-xl">📅</span>
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 mb-1">1-Month Campaign Benefits</div>
                      <div className="text-sm text-gray-700">
                        With 1-month campaigns, you can add and edit tasks for each week (Week 1, 2, 3, 4) during the first 7 days after creation. This allows you to adapt your campaign based on performance and feedback.
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {selectedDuration.value === '24h_trial' && (
                <div className="mb-6 p-4 rounded-lg bg-orange-50/50 border border-orange-100">
                  <div className="flex items-start gap-3">
                    <div className="bg-white p-2 rounded-lg">
                      <span className="text-xl">🚀</span>
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 mb-1">24-Hour Trial Benefits</div>
                      <div className="text-sm text-gray-700">
                        Perfect for testing our platform! Your trial campaign runs for 24 hours with access to our full community. Great for quick promotions, product launches, or testing campaign effectiveness.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Main Campaign Options */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mb-6 md:mb-8">
                {DURATION_OPTIONS.filter(option => !option.trial).map((option) => (
                  <div
                    key={option.value}
                    className={`p-4 md:p-6 rounded-xl md:rounded-2xl border transition-all duration-200 cursor-pointer flex flex-col items-center text-center shadow-sm hover:shadow-md bg-white relative ${selectedDuration.value === option.value
                      ? 'border-2 border-orange-500 shadow-lg'
                      : 'border-gray-200 hover:border-orange-300'
                      }`}
                    onClick={() => setSelectedDuration(option)}
                  >
                    {/* Popular/Featured Badge */}
                    {option.popular && (
                      <div className="absolute -top-2 md:-top-3 left-1/2 transform -translate-x-1/2">
                        <span className="px-2 md:px-3 py-1 rounded-full bg-orange-500 text-white text-xs font-semibold">
                          MOST POPULAR
                        </span>
                      </div>
                    )}
                    {option.featured && (
                      <div className="absolute -top-2 md:-top-3 left-1/2 transform -translate-x-1/2">
                        <span className="px-2 md:px-3 py-1 rounded-full bg-green-500 text-white text-xs font-semibold">
                          BEST VALUE
                        </span>
                      </div>
                    )}

                    <div className="text-3xl md:text-4xl mb-2 md:mb-3">{option.emoji}</div>
                    <h4 className="font-bold text-lg md:text-xl mb-2">{option.label}</h4>

                    <div className="flex flex-col items-center mb-3 md:mb-4">
                      {option.originalPrice && option.price !== option.originalPrice ? (
                        <div className="flex items-center gap-2">
                          <span className="text-base md:text-lg text-gray-400 line-through">{option.originalPrice} USDT</span>
                          <span className="text-xl md:text-2xl font-bold text-orange-700">{option.price} USDT</span>
                          {option.discount && (
                            <span className="ml-2 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold border border-green-200">{option.discount}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xl md:text-2xl font-bold text-orange-700">{option.price} USDT</span>
                      )}
                    </div>

                    <div className="text-xs md:text-sm text-gray-600 mb-3 md:mb-4">{option.description}</div>

                    <ul className="space-y-1 md:space-y-2 mb-3 md:mb-4 text-left w-full">
                      {option.features.map((feature, index) => (
                        <li key={index} className="flex items-start gap-2 text-gray-700">
                          <span className="text-green-500 mt-0.5">✓</span>
                          <span className="text-xs md:text-sm">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {/* Trial Option - Highlighted Below */}
              <div className="text-center mb-4 md:mb-6">
                <h3 className="text-base md:text-lg font-medium text-gray-700 mb-2">Want to try first?</h3>
                <p className="text-xs md:text-sm text-gray-500">Start with our 24-hour trial campaign</p>
              </div>

              <div className="w-full">
                {DURATION_OPTIONS.filter(option => option.trial).map((option) => (
                  <div
                    key={option.value}
                    className={`p-3 md:p-4 rounded-lg border transition-all duration-200 cursor-pointer text-center shadow-sm hover:shadow-md bg-orange-50 relative ${selectedDuration.value === option.value
                      ? 'border-2 border-orange-500 shadow-lg'
                      : 'border-orange-200 hover:border-orange-300'
                      }`}
                    onClick={() => setSelectedDuration(option)}
                  >
                    <div className="flex items-center justify-center gap-2 md:gap-3 mb-2">
                      <span className="text-base md:text-lg">{option.emoji}</span>
                      <h4 className="font-medium text-sm md:text-base text-orange-700">{option.label}</h4>
                    </div>

                    <div className="mb-2 md:mb-3">
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-lg md:text-xl font-bold text-orange-600">50 USDT</span>
                      </div>
                      <div className="text-xs text-orange-600">for 24 hours only</div>
                    </div>

                    <div className="text-xs text-orange-600 mb-2 md:mb-3">Basic trial version - limited features</div>

                  </div>
                ))}
              </div>
            </div>
          </div>
        );

      // KOL Package Step - Commented out for future use
      // KOL Package Step - Completely removed

      case 4:
        return (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200/75">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-2xl">🎁</span>
                <h3 className="text-lg font-semibold">Set Up Additional Rewards (Optional)</h3>
              </div>

              {/* Info about included reward pool */}
              <div className="mb-6 p-4 rounded-lg bg-green-50 border border-green-200">
                <div className="flex items-start gap-3">
                  <div className="bg-white p-2 rounded-lg">
                    <span className="text-xl">✅</span>
                  </div>
                  <div>
                    <div className="font-medium text-gray-900 mb-1">Included Reward Pool</div>
                    <div className="text-sm text-gray-700">
                      Your campaign already includes a reward pool for our community: {
                        selectedDuration.value === '24h_trial' ? '25 USDT' :
                          selectedDuration.value === '1week' ? '50 USDT' : '50 USDT'
                      } of community rewards.
                      You can add additional rewards below to increase engagement and participation.
                    </div>
                  </div>
                </div>
              </div>

              <div className="text-gray-700 mb-6 text-base">
                Add extra rewards to boost engagement and attract more participants. This is completely optional - your campaign will run successfully with just our included reward pool.
              </div>

              <div className="space-y-6">
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label>Additional Reward Type (Optional)</Label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {REWARD_TYPES.map((type) => (
                        <div
                          key={type.id}
                          onClick={() => setSelectedRewardType(type.id)}
                          className={`p-4 rounded-xl border transition-all duration-200 cursor-pointer ${selectedRewardType === type.id
                            ? 'border-orange-500 bg-orange-50/30'
                            : 'border-gray-200 hover:border-orange-200 hover:bg-orange-50/30'
                            }`}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-2xl">{type.icon}</span>
                            <div>
                              <h4 className="font-medium">{type.title}</h4>
                              <p className="text-sm text-gray-600">{type.description}</p>
                            </div>
                          </div>
                          {type.guaranteed && (
                            <div className="mt-2 flex items-center gap-1 text-xs text-green-600">
                              <Shield className="h-3 w-3" />
                              <span>Guaranteed by Loofta</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Skip option */}
                  <div className="flex justify-center">
                    <Button
                      variant={selectedRewardType === 'none' ? "default" : "outline"}
                      onClick={() => {
                        setSelectedRewardType('none');
                        setRewardPool('');
                        setNumberOfWinners('');
                        setSelectedDistributionType(null);
                        setRewardCriteria('');
                        setTokenContract('');
                        setTokenTicker('');
                        setCustomRewardDescription('');
                      }}
                      className={selectedRewardType === 'none' ? "bg-orange-500 text-white hover:bg-orange-600" : "text-gray-600"}
                    >
                      Skip Additional Rewards
                    </Button>
                  </div>

                  {selectedRewardType && selectedRewardType !== 'none' && (
                    <>
                      {selectedRewardType === 'whitelist' ? (
                        <div className="grid gap-2">
                          <Label htmlFor="number-of-spots">Number of Spots</Label>
                          <Input
                            id="number-of-spots"
                            type="number"
                            value={numberOfWinners}
                            onChange={(e) => setNumberOfWinners(e.target.value)}
                            placeholder="How many whitelist/airdrop/NFT spots will be available?"
                            className="text-sm"
                            min="1"
                          />
                          {Number(numberOfWinners) <= 0 && (
                            <p className="text-sm text-red-500">Please enter a number greater than 0</p>
                          )}
                        </div>
                      ) : selectedRewardType === 'custom' ? (
                        <div className="grid gap-2">
                          <Label htmlFor="custom-reward-description">Describe Your Custom Rewards</Label>
                          <Textarea
                            id="custom-reward-description"
                            value={customRewardDescription}
                            onChange={(e) => setCustomRewardDescription(e.target.value)}
                            placeholder="Describe your unique rewards (e.g., exclusive merchandise, VIP access, special events, unique experiences, etc.)"
                            className="text-sm"
                            rows={4}
                          />
                          {!customRewardDescription.trim() && (
                            <p className="text-sm text-red-500">Please describe your custom rewards</p>
                          )}
                        </div>
                      ) : (
                        <>
                          <div className="grid gap-2">
                            <Label htmlFor="reward-pool">
                              Additional Reward Pool {selectedRewardType === 'usdt' ? '(USDT)' : ''}
                            </Label>
                            <Input
                              id="reward-pool"
                              type="number"
                              value={rewardPool}
                              onChange={(e) => setRewardPool(e.target.value)}
                              placeholder={`Enter the additional amount to be distributed${selectedRewardType === 'usdt' ? ' in USDT' : ''}`}
                              className="text-sm"
                              min="0"
                              step="0.01"
                            />
                            {selectedRewardType === 'usdt' && (
                              <div className="space-y-1">
                                <p className="text-sm text-blue-600">
                                  Recommended: {
                                    selectedDuration.value === '24h_trial' ? '25 USDT' :
                                      selectedDuration.value === '1week' ? '50 USDT' : '100 USDT'
                                  }
                                </p>
                              </div>
                            )}
                          </div>

                          {selectedRewardType === 'project_token' && (
                            <>
                              <div className="grid gap-2">
                                <Label htmlFor="token-ticker">Token Ticker</Label>
                                <Input
                                  id="token-ticker"
                                  value={tokenTicker}
                                  onChange={(e) => setTokenTicker(e.target.value)}
                                  placeholder="Enter your token ticker (e.g., $ABC)"
                                  className="text-sm"
                                />
                                {!tokenTicker.trim() && (
                                  <p className="text-sm text-red-500">Please enter your token ticker</p>
                                )}
                              </div>

                              <div className="grid gap-2">
                                <Input
                                  id="token-contract"
                                  value={tokenContract}
                                  onChange={(e) => setTokenContract(e.target.value)}
                                  placeholder="Enter your token contract address"
                                  className="text-sm"
                                />
                                {!tokenContract.trim() && (
                                  <p className="text-sm text-red-500">Please enter your token contract address</p>
                                )}
                              </div>
                            </>
                          )}
                        </>
                      )}

                      {!REWARD_TYPES.find(t => t.id === selectedRewardType)?.guaranteed && (
                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                          <div className="flex items-start gap-2">
                            <div className="mt-0.5">
                              <Shield className="h-4 w-4 text-yellow-600" />
                            </div>
                            <div>
                              <h4 className="font-medium text-yellow-800 mb-1">Important Notice</h4>
                              <p className="text-sm text-yellow-700">
                                {selectedRewardType === 'project_token'
                                  ? 'Project token rewards are managed by your project. You are responsible for distributing these rewards to participants.'
                                  : selectedRewardType === 'custom'
                                    ? 'Custom rewards are managed by your project. You are responsible for providing these rewards to participants.'
                                    : 'Whitelist/airdrop/NFT spots are managed by your project. You are responsible for honoring these spots for participants.'}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="grid gap-2">
                        <Label>Distribution Method</Label>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {REWARD_DISTRIBUTION_TYPES.map((type) => (
                            <div
                              key={type.id}
                              onClick={() => setSelectedDistributionType(type.id)}
                              className={`p-4 rounded-xl border transition-all duration-200 cursor-pointer ${selectedDistributionType === type.id
                                ? 'border-orange-500 bg-orange-50/30'
                                : 'border-gray-200 hover:border-orange-200 hover:bg-orange-50/30'
                                }`}
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-2xl">{type.icon}</span>
                                <h4 className="font-medium">{type.title}</h4>
                              </div>
                              <p className="text-sm text-gray-600">{type.description}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      {selectedRewardType !== 'whitelist' && selectedRewardType !== 'custom' && (
                        <div className="grid gap-2">
                          <Label htmlFor="number-of-winners">Number of Winners</Label>
                          <Input
                            id="number-of-winners"
                            type="number"
                            value={numberOfWinners}
                            onChange={(e) => setNumberOfWinners(e.target.value)}
                            placeholder="How many participants will receive rewards?"
                            className="text-sm"
                          />
                        </div>
                      )}

                      {selectedDistributionType === 'top_performers' && (
                        <div className="grid gap-2">
                          <Label htmlFor="reward-criteria">Reward Criteria</Label>
                          <Textarea
                            id="reward-criteria"
                            value={rewardCriteria}
                            onChange={(e) => setRewardCriteria(e.target.value)}
                            placeholder="Describe how winners will be selected and what they need to do to qualify (e.g., quality of content, engagement metrics, etc.)"
                            className="text-sm"
                            rows={4}
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        );

      case 5:
        return (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200/75">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium">Enhance Your Campaign</h3>
                <span className="text-sm text-gray-500">{selectedAddons.length} add-ons selected</span>
              </div>
              <p className="text-gray-600 mb-6">
                Boost your campaign's effectiveness with these optional add-ons. Each add-on is designed to maximize your campaign's reach and engagement.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {ADDONS.map((addon) => {
                  const isDisabled = (selectedDuration.value === '1month' &&
                    (addon.id === 'telegram' || addon.id === 'space'))
                  return (
                    <div key={addon.id} className="relative">
                      <div
                        className={`p-4 rounded-xl border transition-all duration-200 ${selectedAddons.includes(addon.id)
                          ? 'border-orange-200 bg-orange-50/30'
                          : isDisabled
                            ? 'border-gray-100 bg-gray-50/50 cursor-not-allowed'
                            : 'border-gray-200 hover:border-orange-200 hover:bg-orange-50/30'
                          }`}
                      >
                        <div className="flex items-start gap-3">
                          <Checkbox
                            id={addon.id}
                            checked={selectedAddons.includes(addon.id) || isDisabled}
                            onCheckedChange={(checked) => {
                              if (!isDisabled) {
                                if (checked) {
                                  setSelectedAddons([...selectedAddons, addon.id]);
                                } else {
                                  setSelectedAddons(selectedAddons.filter(id => id !== addon.id));
                                }
                              }
                            }}
                            className="mt-1"
                            disabled={isDisabled}
                          />
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-2">
                              <Label htmlFor={addon.id} className={`font-medium cursor-pointer ${isDisabled ? 'text-gray-400' : 'text-gray-900'}`}>
                                {addon.title}
                                {isDisabled && (
                                  <span className="ml-2 text-xs text-gray-400">
                                    {selectedDuration.value === '1month' ? '(Included in 1-month plan)' :
                                      selectedDuration.value === '1week' ? '(Not available for trial)' : ''}
                                  </span>
                                )}
                              </Label>
                              <span className={`font-semibold ${isDisabled ? 'text-gray-400' : 'text-orange-700'}`}>
                                {addon.price} USDT
                              </span>
                            </div>
                            <p className={`text-sm ${isDisabled ? 'text-gray-400' : 'text-gray-700'}`}>{addon.description}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200/75">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-lg font-medium">Total Price</h3>
                  <p className="text-sm text-gray-600">Including selected packages and add-ons</p>
                </div>
                <div className="text-2xl font-bold text-orange-600">{totalPrice} USDT</div>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <DashboardLayout>
      <div className='h-screen tg-webview flex flex-col relative'>
        <div className='flex-1 overflow-y-auto p-3 md:p-4'>
          <Title text="Advertise with Loofta" showWallet={false} showPrevious={true} />

          <div className="max-w-4xl mx-auto mt-6 md:mt-10">
            {/* Progress Steps */}
            <div className="mb-6 md:mb-8">
              <div className="flex items-center justify-between">
                {[1, 2, 3, 4, 5].map((step) => (
                  <div key={step} className="flex items-center">
                    <div
                      className={`w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center cursor-pointer transition-all duration-300 text-sm md:text-base ${currentStep >= step
                        ? 'bg-gradient-to-r from-[#FF0F00] to-yellow-500 text-white shadow-lg shadow-orange-200'
                        : 'bg-gray-100 text-gray-400'
                        }`}
                      onClick={() => {
                        if (step < currentStep) {
                          setCurrentStep(step);
                        }
                      }}
                    >
                      {step}
                    </div>
                    {step < 5 && (
                      <div
                        className={`w-8 md:w-16 h-1 transition-all duration-300 ${currentStep > step
                          ? 'bg-gradient-to-r from-[#FF0F00] to-yellow-500'
                          : 'bg-gray-100'
                          }`}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-between mt-2">
                <span className="text-xs md:text-sm text-gray-600">About</span>
                <span className="text-xs md:text-sm text-gray-600">Tasks</span>
                <span className="text-xs md:text-sm text-gray-600">Duration</span>
                <span className="text-xs md:text-sm text-gray-600">Rewards</span>
                <span className="text-xs md:text-sm text-gray-600">Add-ons</span>
              </div>
            </div>

            {/* Step Content */}
            {renderStep()}

            {/* Navigation Buttons */}
            <div className="flex justify-between mt-4 md:mt-6">
              {currentStep > 1 && (
                <Button
                  variant="outline"
                  onClick={handleBack}
                  className="flex items-center gap-2 text-sm md:text-base px-3 md:px-4 py-2 md:py-2"
                >
                  Back
                </Button>
              )}
              <Button
                onClick={currentStep === 5 ? () => setShowPaymentModal(true) : handleNext}
                className="flex items-center gap-2 ml-auto text-sm md:text-base px-3 md:px-4 py-2 md:py-2"
                disabled={Boolean(
                  currentStep === 4
                    ? !validateRewardAmount() || !validateProjectToken() ||
                    (selectedRewardType && selectedRewardType !== 'none' && !selectedDistributionType) ||
                    (selectedDistributionType === 'top_performers' && !rewardCriteria)
                    : false // KOL validation removed - step 4 is now commented out
                )}
              >
                {currentStep === 5 ? 'Proceed to Payment' : 'Next'}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Payment Modal */}
        <Dialog open={showPaymentModal} onOpenChange={(open) => {
          setShowPaymentModal(open);
          if (!open) {
            setPaymentStep(1);
            setSelectedPaymentMethod(null);
          }
        }}>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>
                {paymentStep === 1 ? 'Verification Details' :
                  paymentStep === 2 ? 'Payment Method' : 'Payment Details'}
              </DialogTitle>
              <DialogDescription>
                {paymentStep === 1
                  ? 'Please provide your Telegram handle for campaign verification'
                  : paymentStep === 2
                    ? 'Choose your preferred payment method'
                    : 'Complete your payment to start your campaign'
                }
              </DialogDescription>
            </DialogHeader>

            {paymentStep === 1 ? (
              <div className="space-y-4 py-4">
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="telegram-handle">Telegram Handle</Label>
                    <div className="flex gap-2">
                      <span className="inline-flex items-center px-3 py-2 text-gray-500 bg-gray-50 border border-gray-200 rounded-l-md text-sm">
                        @
                      </span>
                      <Input
                        id="telegram-handle"
                        value={telegramHandle}
                        onChange={(e) => setTelegramHandle(e.target.value)}
                        placeholder="Your Telegram username"
                        className="text-sm rounded-l-none"
                        disabled={isLoadingProfile}
                      />
                    </div>
                    <p className="text-sm text-gray-500">
                      We'll use this to contact you about your campaign. Make sure it's correct!
                    </p>
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5">
                      <Shield className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <h4 className="font-medium text-blue-800 mb-1">Verification Process</h4>
                      <p className="text-sm text-blue-700">
                        After payment, our team will review your submission and contact you on Telegram (@{telegramHandle || 'your handle'}) for additional information. Please ensure your Telegram handle is correct.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={handleNextPaymentStep}
                    disabled={!telegramHandle.trim()}
                  >
                    Next
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : paymentStep === 2 ? (
              <div className="space-y-4 py-4">
                {/* Campaign Summary */}
                <div className="bg-gray-50 p-4 rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Duration</span>
                    <span className="font-medium text-sm">{selectedDuration.label}</span>
                  </div>
                  {selectedKolPackage && selectedKolPackage !== 'skip' && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">KOL Package</span>
                      <span className="font-medium text-sm">
                        {KOL_PACKAGES.find(p => p.id === selectedKolPackage)?.title}
                      </span>
                    </div>
                  )}
                  {selectedRewardType && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Reward Type</span>
                      <span className="font-medium text-sm">
                        {REWARD_TYPES.find(t => t.id === selectedRewardType)?.title}
                      </span>
                    </div>
                  )}
                  {selectedRewardType === 'whitelist' ? (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Number of Spots</span>
                      <span className="font-medium text-sm">{numberOfWinners}</span>
                    </div>
                  ) : selectedRewardType && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">Reward Pool</span>
                      <span className="font-medium text-sm">
                        {rewardPool} {selectedRewardType === 'usdt' ? 'USDT' : ''}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Add-ons</span>
                    <span className="font-medium text-right text-sm">
                      {selectedAddons
                        .map(id => ADDONS.find(a => a.id === id)?.title)
                        .join(', ') || 'None'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                    <span className="text-sm font-medium text-gray-900">Total Amount</span>
                    <span className="font-bold text-orange-600">{totalPrice} USDT</span>
                  </div>
                </div>

                {/* Payment Method Options */}
                <div className="space-y-3">
                  <h4 className="font-medium text-gray-900">Choose Payment Method</h4>

                  <button
                    onClick={() => setSelectedPaymentMethod('automated')}
                    className={`w-full p-4 rounded-lg border transition-all text-left ${selectedPaymentMethod === 'automated'
                      ? 'border-orange-500 bg-orange-50'
                      : 'border-gray-200 hover:border-orange-200 hover:bg-orange-50/30'
                      }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="bg-white p-2 rounded-lg">
                        <span className="text-xl">⚡</span>
                      </div>
                      <div>
                        <h5 className="font-semibold text-gray-900">Automated Payment</h5>
                        <p className="text-sm text-gray-600">Pay instantly with crypto wallet</p>
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => setSelectedPaymentMethod('manual')}
                    className={`w-full p-4 rounded-lg border transition-all text-left ${selectedPaymentMethod === 'manual'
                      ? 'border-orange-500 bg-orange-50'
                      : 'border-gray-200 hover:border-orange-200 hover:bg-orange-50/30'
                      }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="bg-white p-2 rounded-lg">
                        <span className="text-xl">💳</span>
                      </div>
                      <div>
                        <h5 className="font-semibold text-gray-900">Manual Payment</h5>
                        <p className="text-sm text-gray-600">Save campaign and pay later</p>
                      </div>
                    </div>
                  </button>
                </div>

                <div className="flex justify-between">
                  <Button
                    variant="outline"
                    onClick={handleBackPaymentStep}
                  >
                    Back
                  </Button>
                  <Button
                    onClick={() => setPaymentStep(3)}
                    disabled={!selectedPaymentMethod}
                  >
                    Continue
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 py-4">
                {selectedPaymentMethod === 'automated' ? (
                  <PaymentMethod
                    amount={totalPrice}
                    currency="USDT"
                    onSuccess={async (paymentHash) => {
                      try {
                        if (!user?.id) {
                          throw new Error('User not found');
                        }

                        let selectedTasks: TaskType[] = [];
                        let customTasks: CustomTaskType[] = [];
                        let weeklyTasksToSubmit: Record<number, { selectedTasks: TaskType[]; customTasks: CustomTaskType[] }> | undefined = undefined;
                        let weeklyStatusToSubmit: Record<number, 'pending' | 'started' | 'completed'> | undefined = undefined;

                        if (selectedDuration.value === '24h_trial' || selectedDuration.value === '1week') {
                          selectedTasks = weeklyTasks[1].selectedTasks;
                          customTasks = weeklyTasks[1].customTasks;
                          weeklyTasksToSubmit = undefined;
                          weeklyStatusToSubmit = undefined;
                        } else if (selectedDuration.value === '1month') {
                          for (let week = 1; week <= 4; week++) {
                            selectedTasks = selectedTasks.concat(weeklyTasks[week].selectedTasks);
                            customTasks = customTasks.concat(weeklyTasks[week].customTasks);
                          }
                          weeklyTasksToSubmit = weeklyTasks;
                          weeklyStatusToSubmit = {
                            1: 'pending',
                            2: 'pending',
                            3: 'pending',
                            4: 'pending'
                          };
                        }

                        const result = await createCampaign({
                          userId: user.id,
                          email: user.email?.address || '',
                          name: user.email?.address?.split('@')[0] || '',
                          projectDetails,
                          selectedDuration,
                          selectedTasks,
                          customTasks,
                          weeklyTasks: weeklyTasksToSubmit,
                          selectedKolPackage,
                          kolDetails,
                          selectedRewardType,
                          rewardPool,
                          numberOfWinners,
                          selectedDistributionType,
                          rewardCriteria,
                          tokenContract,
                          tokenTicker,
                          selectedAddons,
                          totalPrice,
                          paymentHash,
                          telegramHandle,
                          weeklyStatus: weeklyStatusToSubmit
                        });

                        if (!result.success) {
                          throw new Error(result.error || 'Failed to create campaign');
                        }

                        setShowPaymentModal(false);
                        setPaymentStep(1);
                        setSelectedPaymentMethod(null);
                        confetti({
                          particleCount: 100,
                          spread: 70,
                          origin: { y: 0.6 }
                        });
                        toast({
                          title: "Success!",
                          description: selectedDuration.value === '24h_trial'
                            ? `Your 24-hour trial campaign has been submitted successfully! We'll review it and contact you on Telegram (@${telegramHandle}) within 2 hours to start your campaign.`
                            : `Your campaign has been submitted successfully. We'll review it and contact you on Telegram (@${telegramHandle}) within 24 hours.`,
                        });
                        router.push('/advertise/history');
                      } catch (error) {
                        console.error('Error saving campaign:', error);
                        toast({
                          title: "Error",
                          description: "There was an error saving your campaign. Please contact support.",
                          variant: "destructive",
                        });
                      }
                    }}
                    onError={(error) => {
                      console.error('Payment error:', error);
                    }}
                  />
                ) : (
                  <div className="text-center space-y-4">
                    <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                      <div className="flex items-center justify-center gap-2 mb-2">
                        <span className="text-2xl">💳</span>
                        <h4 className="font-semibold text-gray-900">Manual Payment</h4>
                      </div>
                      <p className="text-sm text-gray-600 mb-4">
                        Your campaign will be saved and we'll contact you on Telegram with payment instructions.
                      </p>
                      <Button
                        onClick={async () => {
                          try {
                            if (!user?.id) {
                              throw new Error('User not found');
                            }

                            let selectedTasks: TaskType[] = [];
                            let customTasks: CustomTaskType[] = [];
                            let weeklyTasksToSubmit: Record<number, { selectedTasks: TaskType[]; customTasks: CustomTaskType[] }> | undefined = undefined;
                            let weeklyStatusToSubmit: Record<number, 'pending' | 'started' | 'completed'> | undefined = undefined;

                            if (selectedDuration.value === '24h_trial' || selectedDuration.value === '1week') {
                              selectedTasks = weeklyTasks[1].selectedTasks;
                              customTasks = weeklyTasks[1].customTasks;
                              weeklyTasksToSubmit = undefined;
                              weeklyStatusToSubmit = undefined;
                            } else if (selectedDuration.value === '1month') {
                              for (let week = 1; week <= 4; week++) {
                                selectedTasks = selectedTasks.concat(weeklyTasks[week].selectedTasks);
                                customTasks = customTasks.concat(weeklyTasks[week].customTasks);
                              }
                              weeklyTasksToSubmit = weeklyTasks;
                              weeklyStatusToSubmit = {
                                1: 'pending',
                                2: 'pending',
                                3: 'pending',
                                4: 'pending'
                              };
                            }

                            const result = await createCampaign({
                              userId: user.id,
                              email: user.email?.address || '',
                              name: user.email?.address?.split('@')[0] || '',
                              projectDetails,
                              selectedDuration,
                              selectedTasks,
                              customTasks,
                              weeklyTasks: weeklyTasksToSubmit,
                              selectedKolPackage,
                              kolDetails,
                              selectedRewardType,
                              rewardPool,
                              numberOfWinners,
                              selectedDistributionType,
                              rewardCriteria,
                              tokenContract,
                              tokenTicker,
                              selectedAddons,
                              totalPrice,
                              paymentHash: 'manual_payment_pending',
                              telegramHandle,
                              weeklyStatus: weeklyStatusToSubmit
                            });

                            if (!result.success) {
                              throw new Error(result.error || 'Failed to create campaign');
                            }

                            setShowPaymentModal(false);
                            setPaymentStep(1);
                            setSelectedPaymentMethod(null);
                            toast({
                              title: "Campaign Saved!",
                              description: selectedDuration.value === '24h_trial'
                                ? `Your 24-hour trial campaign has been saved with pending payment. We'll contact you on Telegram (@${telegramHandle}) with payment instructions. Campaign will start once payment is confirmed.`
                                : `Your campaign has been saved with pending payment. We'll contact you on Telegram (@${telegramHandle}) with payment instructions. Campaign will start once payment is confirmed.`,
                            });
                            router.push('/advertise/history');
                          } catch (error) {
                            console.error('Error saving campaign:', error);
                            toast({
                              title: "Error",
                              description: "There was an error saving your campaign. Please contact support.",
                              variant: "destructive",
                            });
                          }
                        }}
                        className="w-full"
                      >
                        Save Campaign & Pay Manually
                      </Button>
                    </div>
                  </div>
                )}

                <div className="flex justify-start">
                  <Button
                    variant="outline"
                    onClick={() => setPaymentStep(2)}
                  >
                    Back
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
} 