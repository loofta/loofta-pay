'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ExternalLink, Check, Clock, X, RefreshCw, Edit, Plus, Download, BarChart3, Users } from 'lucide-react';
import DashboardLayout from '@/components/layouts/DashboardLayout';
import Title from '@/components/Title';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatDistanceToNow } from 'date-fns';
import { TARAXA_EXPLORER_URL } from '@/lib/constants';
import { usePrivy } from '@privy-io/react-auth';
import { fetchAdvertiseCampaigns, updateCampaignTasks, updateWeeklyCampaignTasks, updateCampaignTitle } from '@/app/actions/campaigns/advertiseCampaign';
import { useCampaignStats } from '@/hooks/useCampaignStats';
import { toast } from '@/components/ui/use-toast';

interface TaskType {
  id: string;
  link: string;
  options?: string[];
}

interface CustomTaskType {
  description: string;
  link: string;
}

interface Campaign {
  id: string;
  userId?: string;
  email?: string;
  name?: string;
  title?: string;
  status: string;
  totalPrice?: number;
  totalAmount?: number;
  createdAt?: number;
  updatedAt?: number;
  linkedCampaignIds?: string[];
  duration?: {
    value: string;
    price?: number;
  };
  weeklyStatus?: Record<number, string>;
  tasks?: TaskType[];
  customTasks?: CustomTaskType[];
  weeklyTasks?: Record<number, { selectedTasks: TaskType[]; customTasks: CustomTaskType[] }>;
  projectDetails?: {
    description?: string;
    goals?: string;
  };
  kolPackage?: string;
  addons?: string[];
  telegramHandle?: string;
  paymentHash?: string;
}

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

export default function CampaignHistoryPage() {
  const router = useRouter();
  const { user } = usePrivy();
  const [activeTab, setActiveTab] = useState('ongoing');
  const [loading, setLoading] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [editingCampaign, setEditingCampaign] = useState<any>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [currentWeek, setCurrentWeek] = useState(1);
  const [newCustomTask, setNewCustomTask] = useState({ description: '', link: '' });
  const [showCustomTaskInput, setShowCustomTaskInput] = useState(false);
  const [editingTaskIndex, setEditingTaskIndex] = useState<number | null>(null);
  const [taskSearch, setTaskSearch] = useState('');
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [newTitle, setNewTitle] = useState('');

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

  const fetchCampaigns = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const result = await fetchAdvertiseCampaigns(user.id);
      if (result.success) {
        setCampaigns((result.campaigns || []) as Campaign[]);
      }
    } catch (err) {
      // handle error
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaigns();
    // eslint-disable-next-line
  }, [user?.id]);



  // Check if campaign is within 7 days of creation and can be edited
  const canEditCampaign = (campaign: any) => {
    if (!campaign.createdAt) return false;
    const createdAt = new Date(campaign.createdAt);
    const now = new Date();
    const daysDiff = (now.getTime() - createdAt.getTime()) / (1000 * 3600 * 24);
    return daysDiff <= 7 && campaign.status === 'pending';
  };

  // Check if a specific week can be edited
  const canEditWeek = (campaign: any, week: number) => {
    if (!canEditCampaign(campaign)) return false;

    // For 1-month campaigns, check weekly status
    if (campaign.duration?.value === '1month' && campaign.weeklyStatus) {
      const weekStatus = campaign.weeklyStatus[week];
      return weekStatus === 'pending';
    }

    // For 1-week and 24h trial campaigns, check if campaign has started (status is still 'pending')
    if (campaign.duration?.value === '1week' || campaign.duration?.value === '24h_trial') {
      return campaign.status === 'pending';
    }

    return false;
  };

  // Get campaign title
  const getCampaignTitle = (campaign: any) => {
    if (campaign.title) {
      return campaign.title;
    }

    if (campaign.projectDetails?.description) {
      return campaign.projectDetails.description;
    }

    if (campaign.projectDetails?.goals) {
      return campaign.projectDetails.goals;
    }

    // Generate title from date and time
    if (campaign.createdAt) {
      const date = new Date(campaign.createdAt);
      const formattedDate = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      return `Campaign ${formattedDate}`;
    }

    return 'Untitled Campaign';
  };

  // Component to display campaign stats
  const CampaignStatsDisplay = ({ campaign }: { campaign: Campaign }) => {
    const shouldShowStats = campaign.linkedCampaignIds &&
      campaign.linkedCampaignIds.length > 0 &&
      campaign.status !== 'cancelled' &&
      campaign.status !== 'pending';

    const { stats, loading, error, exportToExcel } = useCampaignStats(
      shouldShowStats ? campaign.linkedCampaignIds : undefined
    );

    if (!shouldShowStats) {
      return null;
    }

    if (loading) {
      return (
        <div className="space-y-2">
          <div className="text-sm font-medium text-gray-700">Campaign Performance:</div>
          <div className="text-sm text-gray-500">Loading stats...</div>
          <div className="flex gap-4">
            <Skeleton className="h-16 w-24" />
            <Skeleton className="h-16 w-24" />
            <Skeleton className="h-16 w-24" />
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="space-y-2">
          <div className="text-sm font-medium text-gray-700">Campaign Performance:</div>
          <div className="text-sm text-red-600">Failed to load stats: {error}</div>
        </div>
      );
    }

    if (!stats) {
      return null;
    }

    const formatNumber = (value?: number) =>
      typeof value === 'number' ? value.toLocaleString() : '0';

    const handleExport = () => {
      exportToExcel(getCampaignTitle(campaign));
    };

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-gray-700">Campaign Performance:</div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            className="flex items-center gap-2 text-xs"
          >
            <Download className="h-3 w-3" />
            Export Submissions
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-green-50 p-3 rounded-lg border border-green-200">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span className="text-xs font-medium text-green-700">Completed</span>
            </div>
            <div className="text-lg font-bold text-green-900">{formatNumber(stats.doneDeals)}</div>
            <div className="text-xs text-green-600">deals done</div>
          </div>

          <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
              <span className="text-xs font-medium text-blue-700">Ongoing</span>
            </div>
            <div className="text-lg font-bold text-blue-900">{formatNumber(stats.ongoingDeals)}</div>
            <div className="text-xs text-blue-600">deals active</div>
          </div>

          <div className="bg-orange-50 p-3 rounded-lg border border-orange-200">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-3 w-3 text-orange-600" />
              <span className="text-xs font-medium text-orange-700">Engagement</span>
            </div>
            <div className="text-lg font-bold text-orange-900">{stats.engagementRate ? stats.engagementRate.toFixed(1) + '%' : 'N/A'}</div>
            <div className="text-xs text-orange-600">engagement rate</div>
          </div>

          <div className="bg-purple-50 p-3 rounded-lg border border-purple-200">
            <div className="flex items-center gap-2">
              <Users className="h-3 w-3 text-purple-600" />
              <span className="text-xs font-medium text-purple-700">Participants</span>
            </div>
            <div className="text-lg font-bold text-purple-900">{formatNumber(stats.uniqueParticipants)}</div>
            <div className="text-xs text-purple-600">unique users</div>
          </div>
        </div>

        {/* Engagement metrics summary */}
        {stats.impressions > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
            <div className="bg-white p-3 rounded-lg border border-gray-200">
              <div className="text-xs text-gray-600">Impressions</div>
              <div className="text-base font-semibold text-gray-900">{formatNumber(stats.impressions)}</div>
            </div>
            <div className="bg-white p-3 rounded-lg border border-gray-200">
              <div className="text-xs text-gray-600">Likes</div>
              <div className="text-base font-semibold text-gray-900">{formatNumber(stats.likes)}</div>
            </div>
            <div className="bg-white p-3 rounded-lg border border-gray-200">
              <div className="text-xs text-gray-600">Reposts</div>
              <div className="text-base font-semibold text-gray-900">{formatNumber(stats.reposts)}</div>
            </div>
            <div className="bg-white p-3 rounded-lg border border-gray-200">
              <div className="text-xs text-gray-600">Comments</div>
              <div className="text-base font-semibold text-gray-900">{formatNumber(stats.postComments)}</div>
            </div>
          </div>
        )}
        <div className="text-xs text-gray-500">
          Linked Campaigns: {campaign.linkedCampaignIds?.join(', ') || 'None'}
        </div>
      </div>
    );
  };

  const handleViewCampaign = (campaign: any) => {
    setEditingCampaign(campaign);
    setCurrentWeek(1);
    setShowEditModal(true);
  };

  const handleEditCampaign = (campaign: any) => {
    // Allow editing for 1-month, 1-week, and 24h trial campaigns that are within 7 days and pending
    if ((campaign.duration?.value === '1month' || campaign.duration?.value === '1week' || campaign.duration?.value === '24h_trial') && canEditCampaign(campaign)) {
      setEditingCampaign(campaign);
      setCurrentWeek(1);
      setShowEditModal(true);
    }
  };

  const handleAddTask = (taskId: string) => {
    if (!editingCampaign) return;

    const task = TASK_TEMPLATES.find(t => t.id === taskId);
    const updatedCampaign = { ...editingCampaign };

    if (taskId === 'custom') {
      // Handle custom task
      setShowTaskModal(false);
      setShowCustomTaskInput(true);
      return;
    }

    if (editingCampaign.duration?.value === '1month') {
      if (!updatedCampaign.weeklyTasks) {
        updatedCampaign.weeklyTasks = {
          1: { selectedTasks: [], customTasks: [] },
          2: { selectedTasks: [], customTasks: [] },
          3: { selectedTasks: [], customTasks: [] },
          4: { selectedTasks: [], customTasks: [] },
        };
      }

      if (!updatedCampaign.weeklyTasks[currentWeek]) {
        updatedCampaign.weeklyTasks[currentWeek] = { selectedTasks: [], customTasks: [] };
      }

      updatedCampaign.weeklyTasks[currentWeek].selectedTasks.push(
        task?.options ? { id: taskId, link: '', options: [] } : { id: taskId, link: '' }
      );

      setEditingCampaign(updatedCampaign);
      setEditingTaskIndex(updatedCampaign.weeklyTasks[currentWeek].selectedTasks.length - 1);
    } else {
      // For 1-week and 24h trial campaigns
      if (!updatedCampaign.tasks) {
        updatedCampaign.tasks = [];
      }

      updatedCampaign.tasks.push(
        task?.options ? { id: taskId, link: '', options: [] } : { id: taskId, link: '' }
      );

      setEditingCampaign(updatedCampaign);
      setEditingTaskIndex(updatedCampaign.tasks.length - 1);
    }
  };

  const handleRemoveTask = (index: number) => {
    if (!editingCampaign) return;

    const updatedCampaign = { ...editingCampaign };

    if (editingCampaign.duration?.value === '1month') {
      updatedCampaign.weeklyTasks[currentWeek].selectedTasks.splice(index, 1);
    } else {
      // For 1-week and 24h trial campaigns
      updatedCampaign.tasks.splice(index, 1);
    }

    setEditingCampaign(updatedCampaign);
  };

  const handleTaskLinkChange = (index: number, link: string) => {
    if (!editingCampaign) return;

    const updatedCampaign = { ...editingCampaign };

    if (editingCampaign.duration?.value === '1month') {
      updatedCampaign.weeklyTasks[currentWeek].selectedTasks[index].link = link;
    } else {
      // For 1-week and 24h trial campaigns
      updatedCampaign.tasks[index].link = link;
    }

    setEditingCampaign(updatedCampaign);
  };

  const handleSaveTask = async (index: number) => {
    if (!editingCampaign) return;

    const task = editingCampaign.duration?.value === '1month'
      ? editingCampaign.weeklyTasks[currentWeek].selectedTasks[index]
      : editingCampaign.tasks[index];

    if (task.link.trim()) {
      setEditingTaskIndex(null);

      // Save the task changes to the database immediately
      try {
        console.log('Saving task:', task);
        console.log('Current editingCampaign:', editingCampaign);

        let updateResult;
        if (editingCampaign.duration?.value === '1month') {
          console.log('Updating 1-month campaign with weeklyTasks:', editingCampaign.weeklyTasks);
          updateResult = await updateCampaignTasks(editingCampaign.id, editingCampaign.weeklyTasks);
        } else {
          // For 1-week campaigns, use the new server action
          console.log('Updating 1-week campaign with tasks:', editingCampaign.tasks);
          updateResult = await updateWeeklyCampaignTasks(
            editingCampaign.id,
            editingCampaign.tasks || [],
            editingCampaign.customTasks || []
          );
        }

        console.log('Update result:', updateResult);

        if (!updateResult.success) {
          throw new Error(updateResult.error || 'Failed to update task');
        }

        // Refresh the campaigns list
        await fetchCampaigns();

        // Find and update the editingCampaign with fresh data from the updated campaigns list
        const result = await fetchAdvertiseCampaigns(user?.id || '');
        if (result.success && result.campaigns) {
          const freshCampaign = result.campaigns.find((c: any) => c.id === editingCampaign.id);
          if (freshCampaign) {
            setEditingCampaign(freshCampaign);
            console.log('Task saved successfully. Updated campaign:', freshCampaign);
          } else {
            console.error('Could not find updated campaign in the list');
          }
        } else {
          console.error('Failed to fetch updated campaigns:', result);
        }

        toast({
          title: "Task Updated",
          description: "Your task has been successfully updated.",
        });
      } catch (error) {
        console.error('Error saving task:', error);
        toast({
          title: "Error",
          description: "There was an error saving your task. Please try again.",
          variant: "destructive",
        });
      }
    }
  };

  const handleEditTask = (index: number) => {
    setEditingTaskIndex(index);
  };

  const handleAddCustomTask = () => {
    if (!editingCampaign || !newCustomTask.description.trim()) return;

    const updatedCampaign = { ...editingCampaign };

    if (editingCampaign.duration?.value === '1month') {
      if (!updatedCampaign.weeklyTasks[currentWeek]) {
        updatedCampaign.weeklyTasks[currentWeek] = { selectedTasks: [], customTasks: [] };
      }
      updatedCampaign.weeklyTasks[currentWeek].customTasks.push({ ...newCustomTask });
    } else {
      // For 1-week and 24h trial campaigns
      if (!updatedCampaign.customTasks) {
        updatedCampaign.customTasks = [];
      }
      updatedCampaign.customTasks.push({ ...newCustomTask });
    }

    setEditingCampaign(updatedCampaign);
    setNewCustomTask({ description: '', link: '' });
  };

  const handleRemoveCustomTask = (index: number) => {
    if (!editingCampaign) return;

    const updatedCampaign = { ...editingCampaign };

    if (editingCampaign.duration?.value === '1month') {
      updatedCampaign.weeklyTasks[currentWeek].customTasks.splice(index, 1);
    } else {
      // For 1-week and 24h trial campaigns
      updatedCampaign.customTasks.splice(index, 1);
    }

    setEditingCampaign(updatedCampaign);
  };

  const handleSaveCampaign = async () => {
    if (!editingCampaign) return;

    try {
      if (editingCampaign.duration?.value === '1month') {
        await updateCampaignTasks(editingCampaign.id, editingCampaign.weeklyTasks);
      } else {
        // For 1-week and 24h trial campaigns, use the new server action
        await updateWeeklyCampaignTasks(
          editingCampaign.id,
          editingCampaign.tasks || [],
          editingCampaign.customTasks || []
        );
      }

      setShowEditModal(false);
      setEditingCampaign(null);
      await fetchCampaigns();
      toast({
        title: "Campaign Tasks Updated",
        description: "Your campaign tasks have been successfully updated.",
      });
    } catch (error) {
      console.error('Error saving campaign:', error);
      toast({
        title: "Error",
        description: "There was an error updating your campaign tasks. Please try again later.",
      });
    }
  };

  const handleRenameCampaign = async () => {
    if (!editingCampaign || !newTitle.trim()) return;

    try {
      await updateCampaignTitle(editingCampaign.id, newTitle.trim());
      setEditingTitle(false);
      setNewTitle('');

      // Update the local campaign state immediately
      setEditingCampaign((prev: any) => prev ? { ...prev, title: newTitle.trim() } : null);

      await fetchCampaigns();
      toast({
        title: "Campaign Renamed",
        description: "Your campaign has been successfully renamed.",
      });
    } catch (error) {
      console.error('Error renaming campaign:', error);
      toast({
        title: "Error",
        description: "There was an error renaming your campaign. Please try again later.",
      });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-50 text-green-700 border-green-200';
      case 'completed':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'pending':
        return 'bg-yellow-50 text-yellow-700 border-yellow-200';
      case 'failed':
        return 'bg-red-50 text-red-700 border-red-200';
      default:
        return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <Clock className="h-4 w-4" />;
      case 'completed':
        return <Check className="h-4 w-4" />;
      case 'failed':
        return <X className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  // Helper function to render tasks based on campaign duration
  const renderTasks = (campaign: any) => {
    const duration = campaign.duration?.value || campaign.duration;

    if (duration === '1month' && campaign.weeklyTasks) {
      // Show weekly tasks for 1-month campaigns
      const allWeeksHaveTasks = Object.values(campaign.weeklyTasks).some((weekData: any) =>
        (weekData.selectedTasks?.length || 0) + (weekData.customTasks?.length || 0) > 0
      );

      if (!allWeeksHaveTasks) {
        return <div className="text-sm text-gray-500">No tasks configured yet</div>;
      }

      return (
        <div className="space-y-2">
          {Object.entries(campaign.weeklyTasks).map(([week, weekData]: [string, any]) => {
            const weekTasks = [...(weekData.selectedTasks || []), ...(weekData.customTasks || [])];
            const weekStatus = campaign.weeklyStatus?.[week] || 'pending';

            if (weekTasks.length === 0) return null;

            return (
              <div key={week} className="ml-2">
                <div className="flex items-center gap-2 mb-1">
                  <div className="text-xs font-medium text-orange-600">Week {week}</div>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${weekStatus === 'pending'
                    ? 'bg-gray-100 text-gray-700'
                    : weekStatus === 'started'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-green-100 text-green-700'
                    }`}>
                    {weekStatus}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {weekTasks.map((task: any, index: number) => (
                    <Badge key={index} variant="secondary" className="text-xs">
                      {task.id || task.description || 'Task'}
                    </Badge>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      );
    } else {
      // Show regular tasks for 1-week, 24h trial campaigns, or fallback
      const totalTasks = (campaign.tasks?.length || 0) + (campaign.customTasks?.length || 0);

      if (totalTasks === 0) {
        return <div className="text-sm text-gray-500">No tasks configured</div>;
      }

      return (
        <div className="flex flex-wrap gap-2">
          {(campaign.tasks || []).map((task: any, index: number) => (
            <Badge key={index} variant="secondary" className="text-xs">
              {task.id || task.description || 'Task'}
            </Badge>
          ))}
          {(campaign.customTasks || []).map((task: any, index: number) => (
            <Badge key={index} variant="secondary" className="text-xs">
              {task.description || 'Custom Task'}
            </Badge>
          ))}
        </div>
      );
    }
  };

  // Split campaigns by status
  const ongoingCampaigns = campaigns.filter(c => c.status === 'active' || c.status === 'pending');
  const pastCampaigns = campaigns.filter(c => c.status === 'completed' || c.status === 'failed');
  const filteredCampaigns = activeTab === 'ongoing' ? ongoingCampaigns : pastCampaigns;

  return (
    <DashboardLayout>
      <div className='h-screen tg-webview flex flex-col relative'>
        <div className='flex-1 overflow-y-auto p-4'>
          <Title text="Campaigns" showWallet={false} showPrevious={true} />

          <div className="max-w-4xl mx-auto mt-6">
            {/* Main Action Button */}
            <div className="mb-8">
              <div className="bg-gradient-to-r from-orange-50 to-yellow-50 p-6 rounded-2xl border border-orange-200">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div className="flex-1">
                    <h2 className="text-xl font-bold text-gray-900 mb-2">Ready to Launch Your Next Campaign?</h2>
                    <p className="text-gray-700 mb-4">
                      Create engaging campaigns with our Web3 community. Get real engagement from verified ambassadors and content creators.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                        <span>3500+ verified Web3 ambassadors</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                        <span>Guaranteed engagement metrics</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                        <span>Detailed analytics dashboard</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <Button
                      onClick={() => router.push('/advertise')}
                      className="bg-orange-500 hover:bg-orange-600 text-white px-8 py-3 text-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-200 transform hover:-translate-y-1"
                    >
                      New Campaign
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end mb-4">
              <Button
                variant="outline"
                size="sm"
                onClick={fetchCampaigns}
                disabled={loading}
                className="flex items-center gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="ongoing">Ongoing Campaigns</TabsTrigger>
                <TabsTrigger value="past">Past Campaigns</TabsTrigger>
              </TabsList>

              <TabsContent value="ongoing" className="space-y-4">
                {loading ? (
                  <div className="space-y-4">
                    {[1, 2].map((i) => (
                      <Card key={i} className="bg-white">
                        <CardContent className="p-6">
                          <div className="space-y-3">
                            <Skeleton className="h-4 w-3/4" />
                            <Skeleton className="h-4 w-1/2" />
                            <Skeleton className="h-4 w-1/4" />
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : filteredCampaigns.length === 0 ? (
                  <Card className="bg-white">
                    <CardContent className="p-8 text-center">
                      <div className="max-w-md mx-auto">
                        <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                          <span className="text-2xl">🚀</span>
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">No Campaigns Yet</h3>
                        <p className="text-gray-600 mb-6">
                          Start your first campaign and get real engagement from our Web3 community
                        </p>
                        <Button
                          onClick={() => router.push('/advertise')}
                          className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 text-base font-semibold"
                        >
                          Start Your First Campaign
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  filteredCampaigns.map((campaign) => (
                    <Card key={campaign.id} className="bg-white hover:shadow-md transition-shadow">
                      <CardContent className="p-6">
                        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                          <div className="flex-1 space-y-3">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2">
                                <h3 className="font-semibold text-lg">{getCampaignTitle(campaign)}</h3>
                                <div className={`px-3 py-1 rounded-full border ${getStatusColor(campaign.status)}`}>
                                  <span className="text-sm font-medium capitalize">{campaign.status}</span>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-xl font-bold text-orange-600">
                                  {campaign.totalPrice || campaign.totalAmount} USDT
                                </div>
                                <div className="text-sm text-gray-500">
                                  {campaign.duration?.value === '1week' ? '1 Week' : '1 Month'}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-4 text-sm text-gray-600">
                              <span>Started {campaign.createdAt ? formatDistanceToNow(new Date(campaign.createdAt), { addSuffix: true }) : ''}</span>
                              {campaign.telegramHandle && (
                                <span>Contact: {campaign.telegramHandle}</span>
                              )}
                            </div>

                            {/* Campaign Type and Status */}
                            <div className="flex items-center gap-4">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-700">Type:</span>
                                <Badge variant="outline" className="text-xs">
                                  {campaign.duration?.value === '1week' ? 'Weekly Campaign' : campaign.duration?.value === '24h_trial' ? '24h Trial' : 'Monthly Campaign'}
                                </Badge>
                              </div>
                              {campaign.kolPackage && campaign.kolPackage !== 'skip' && (
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-gray-700">KOL:</span>
                                  <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700">
                                    {campaign.kolPackage === 'kol-spark' ? 'Spark Package' : 'Boost Package'}
                                  </Badge>
                                </div>
                              )}
                            </div>

                            {/* Weekly Status for Monthly Campaigns */}
                            {campaign.duration?.value === '1month' && campaign.weeklyStatus && (
                              <div className="space-y-2">
                                <div className="text-sm font-medium text-gray-700">Weekly Progress:</div>
                                <div className="flex gap-2">
                                  {[1, 2, 3, 4].map(week => {
                                    const status = campaign.weeklyStatus?.[week] || 'pending';
                                    const getWeekStatusColor = (status: string) => {
                                      switch (status) {
                                        case 'completed': return 'bg-green-100 text-green-700 border-green-200';
                                        case 'started': return 'bg-blue-100 text-blue-700 border-blue-200';
                                        default: return 'bg-gray-100 text-gray-600 border-gray-200';
                                      }
                                    };
                                    return (
                                      <div
                                        key={week}
                                        className={`px-3 py-1 rounded-full border text-xs font-medium ${getWeekStatusColor(status)}`}
                                      >
                                        Week {week}: {status}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Task Summary */}
                            <div className="space-y-2">
                              <div className="text-sm font-medium text-gray-700">Tasks:</div>
                              {renderTasks(campaign)}
                            </div>

                            {/* Campaign Stats */}
                            <CampaignStatsDisplay campaign={campaign} />

                            {/* Add-ons */}
                            {campaign.addons && campaign.addons.length > 0 && (
                              <div className="space-y-2">
                                <div className="text-sm font-medium text-gray-700">Add-ons:</div>
                                <div className="flex flex-wrap gap-2">
                                  {campaign.addons.map((addon: string) => (
                                    <Badge key={addon} variant="secondary" className="text-xs">
                                      {addon}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="flex flex-col items-end gap-3">
                            <div className="flex items-center gap-2">
                              {(campaign.duration?.value === '1month' || campaign.duration?.value === '1week' || campaign.duration?.value === '24h_trial') && canEditCampaign(campaign) ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleEditCampaign(campaign)}
                                  className="flex items-center gap-2"
                                >
                                  <Edit className="h-4 w-4" />
                                  Edit Tasks
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleViewCampaign(campaign)}
                                  className="flex items-center gap-2"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                  View Details
                                </Button>
                              )}
                            </div>

                            {/* Transaction Link - Only in detail view */}
                            {campaign.paymentHash && (
                              <div className="text-xs text-gray-500">
                                Transaction: {campaign.paymentHash.slice(0, 8)}...{campaign.paymentHash.slice(-6)}
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </TabsContent>

              <TabsContent value="past" className="space-y-4">
                {loading ? (
                  <div className="space-y-4">
                    {[1, 2].map((i) => (
                      <Card key={i} className="bg-white">
                        <CardContent className="p-6">
                          <div className="space-y-3">
                            <Skeleton className="h-4 w-3/4" />
                            <Skeleton className="h-4 w-1/2" />
                            <Skeleton className="h-4 w-1/4" />
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : filteredCampaigns.length === 0 ? (
                  <Card className="bg-white">
                    <CardContent className="p-8 text-center">
                      <div className="max-w-md mx-auto">
                        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                          <span className="text-2xl">📊</span>
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">No Past Campaigns</h3>
                        <p className="text-gray-600 mb-6">
                          Your completed campaigns will appear here once they finish
                        </p>
                        <Button
                          onClick={() => router.push('/advertise')}
                          className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 text-base font-semibold"
                        >
                          Create New Campaign
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  filteredCampaigns.map((campaign) => (
                    <Card key={campaign.id} className="bg-white hover:shadow-md transition-shadow">
                      <CardContent className="p-6">
                        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                          <div className="flex-1 space-y-3">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2">
                                <h3 className="font-semibold text-lg">{getCampaignTitle(campaign)}</h3>
                                <div className={`px-3 py-1 rounded-full border ${getStatusColor(campaign.status)}`}>
                                  <span className="text-sm font-medium capitalize">{campaign.status}</span>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-xl font-bold text-orange-600">
                                  {campaign.totalPrice || campaign.totalAmount} USDT
                                </div>
                                <div className="text-sm text-gray-500">
                                  {campaign.duration?.value === '1week' ? '1 Week' : campaign.duration?.value === '24h_trial' ? '24h Trial' : '1 Month'}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-4 text-sm text-gray-600">
                              <span>Ended {campaign.createdAt ? formatDistanceToNow(new Date(campaign.createdAt), { addSuffix: true }) : ''}</span>
                              {campaign.telegramHandle && (
                                <span>Contact: {campaign.telegramHandle}</span>
                              )}
                            </div>

                            {/* Campaign Type and Status */}
                            <div className="flex items-center gap-4">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-700">Type:</span>
                                <Badge variant="outline" className="text-xs">
                                  {campaign.duration?.value === '1week' ? 'Weekly Campaign' : 'Monthly Campaign'}
                                </Badge>
                              </div>
                              {campaign.kolPackage && campaign.kolPackage !== 'skip' && (
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-gray-700">KOL:</span>
                                  <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700">
                                    {campaign.kolPackage === 'kol-spark' ? 'Spark Package' : 'Boost Package'}
                                  </Badge>
                                </div>
                              )}
                            </div>

                            {/* Weekly Status for Monthly Campaigns */}
                            {campaign.duration?.value === '1month' && campaign.weeklyStatus && (
                              <div className="space-y-2">
                                <div className="text-sm font-medium text-gray-700">Final Progress:</div>
                                <div className="flex gap-2">
                                  {[1, 2, 3, 4].map(week => {
                                    const status = campaign.weeklyStatus?.[week] || 'pending';
                                    const getWeekStatusColor = (status: string) => {
                                      switch (status) {
                                        case 'completed': return 'bg-green-100 text-green-700 border-green-200';
                                        case 'started': return 'bg-blue-100 text-blue-700 border-blue-200';
                                        default: return 'bg-gray-100 text-gray-600 border-gray-200';
                                      }
                                    };
                                    return (
                                      <div
                                        key={week}
                                        className={`px-3 py-1 rounded-full border text-xs font-medium ${getWeekStatusColor(status)}`}
                                      >
                                        Week {week}: {status}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Task Summary */}
                            <div className="space-y-2">
                              <div className="text-sm font-medium text-gray-700">Tasks:</div>
                              {renderTasks(campaign)}
                            </div>

                            {/* Campaign Stats */}
                            <CampaignStatsDisplay campaign={campaign} />

                            {/* Add-ons */}
                            {campaign.addons && campaign.addons.length > 0 && (
                              <div className="space-y-2">
                                <div className="text-sm font-medium text-gray-700">Add-ons:</div>
                                <div className="flex flex-wrap gap-2">
                                  {campaign.addons.map((addon: string) => (
                                    <Badge key={addon} variant="secondary" className="text-xs">
                                      {addon}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="flex flex-col items-end gap-3">
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleViewCampaign(campaign)}
                                className="flex items-center gap-2"
                              >
                                <ExternalLink className="h-4 w-4" />
                                View Details
                              </Button>
                            </div>

                            {/* Transaction Link - Only in detail view */}
                            {campaign.paymentHash && (
                              <div className="text-xs text-gray-500">
                                Transaction: {campaign.paymentHash.slice(0, 8)}...{campaign.paymentHash.slice(-6)}
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* Campaign Details Modal */}
        <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
          <DialogContent className="sm:max-w-[800px] w-[95vw] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {(editingCampaign?.duration?.value === '1month' || editingCampaign?.duration?.value === '1week' || editingCampaign?.duration?.value === '24h_trial') && canEditCampaign(editingCampaign)
                  ? 'Edit Campaign Tasks'
                  : 'Campaign Details'
                }
              </DialogTitle>
              <DialogDescription>
                {editingCampaign?.duration?.value === '1month' && canEditCampaign(editingCampaign)
                  ? 'Manage tasks for your 1-month campaign. You can edit tasks for weeks that haven\'t started yet.'
                  : editingCampaign?.duration?.value === '1week' && canEditCampaign(editingCampaign)
                    ? 'Manage tasks for your 1-week campaign. You can edit tasks if the campaign hasn\'t started yet.'
                    : editingCampaign?.duration?.value === '24h_trial' && canEditCampaign(editingCampaign)
                      ? 'Manage tasks for your 24-hour trial campaign. You can edit tasks if the campaign hasn\'t started yet.'
                      : 'View your campaign details and progress.'
                }
              </DialogDescription>
            </DialogHeader>

            {editingCampaign && (
              <div className="space-y-6">
                {/* Campaign Header */}
                <div className="bg-gradient-to-r from-orange-50 to-yellow-50 p-6 rounded-xl border border-orange-200">
                  <div className="flex items-start justify-between mb-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        {editingTitle ? (
                          <div className="flex items-center gap-2">
                            <Input
                              value={newTitle}
                              onChange={(e) => setNewTitle(e.target.value)}
                              placeholder="Enter campaign name"
                              className="text-2xl font-bold text-gray-900 bg-white border-orange-300 focus:border-orange-500"
                            />
                            <Button
                              size="sm"
                              onClick={handleRenameCampaign}
                              disabled={!newTitle.trim()}
                              className="h-8"
                            >
                              Save
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setEditingTitle(false);
                                setNewTitle('');
                              }}
                              className="h-8"
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <h2 className="text-2xl font-bold text-gray-900">{getCampaignTitle(editingCampaign)}</h2>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditingTitle(true);
                                setNewTitle(editingCampaign.title || getCampaignTitle(editingCampaign));
                              }}
                              className="h-8 w-8 p-0 hover:bg-orange-100"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                        <div className={`px-3 py-1 rounded-full border ${getStatusColor(editingCampaign.status)}`}>
                          <span className="text-sm font-medium capitalize">{editingCampaign.status}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-600">
                        <span>Started {editingCampaign.createdAt ? formatDistanceToNow(new Date(editingCampaign.createdAt), { addSuffix: true }) : ''}</span>
                        <span>Duration: {editingCampaign.duration?.value === '24h_trial' ? '24h Trial' :
                          editingCampaign.duration?.value === '1week' ? '1 Week' : '1 Month'}</span>
                        <span>Total: {editingCampaign.totalPrice || editingCampaign.totalAmount} USDT</span>
                      </div>
                    </div>
                    <div className="text-right">
                      {editingCampaign.paymentHash && (
                        <a
                          href={`${editingCampaign.paymentHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-500 hover:text-blue-700 flex items-center gap-1 text-sm"
                        >
                          <span>View Transaction</span>
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Campaign Type and Features */}
                  <div className="flex flex-wrap gap-3">
                    <Badge variant="outline" className="bg-white">
                      {editingCampaign.duration?.value === '24h_trial' ? 'Trial Campaign' :
                        editingCampaign.duration?.value === '1week' ? 'Weekly Campaign' : 'Monthly Campaign'}
                    </Badge>
                    {editingCampaign.kolPackage && editingCampaign.kolPackage !== 'skip' && (
                      <Badge variant="outline" className="bg-blue-50 text-blue-700">
                        {editingCampaign.kolPackage === 'kol-spark' ? 'Spark KOL Package' : 'Boost KOL Package'}
                      </Badge>
                    )}
                    {editingCampaign.addons && editingCampaign.addons.length > 0 && (
                      editingCampaign.addons.map((addon: string) => (
                        <Badge key={addon} variant="outline" className="bg-green-50 text-green-700">
                          {addon}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>

                {/* Weekly Status Overview - Only for 1-month campaigns */}
                {editingCampaign.duration?.value === '1month' && editingCampaign.weeklyStatus && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">Weekly Progress</h3>
                      {canEditCampaign(editingCampaign) && (
                        <div className="text-sm text-gray-600">
                          You can edit tasks for weeks that haven't started yet
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[1, 2, 3, 4].map(week => {
                        const weekStatus = editingCampaign.weeklyStatus[week];
                        const isEditable = canEditWeek(editingCampaign, week);
                        const getWeekStatusColor = (status: string) => {
                          switch (status) {
                            case 'completed': return 'bg-green-100 text-green-700 border-green-200';
                            case 'started': return 'bg-blue-100 text-blue-700 border-blue-200';
                            default: return 'bg-gray-100 text-gray-600 border-gray-200';
                          }
                        };

                        return (
                          <div
                            key={week}
                            className={`p-4 rounded-lg border transition-all cursor-pointer ${currentWeek === week
                              ? 'border-orange-500 bg-orange-50'
                              : isEditable
                                ? 'border-gray-200 hover:border-orange-300 hover:bg-orange-50/30'
                                : 'border-gray-200 opacity-60'
                              }`}
                            onClick={() => setCurrentWeek(week)}
                          >
                            <div className="text-center space-y-2">
                              <div className="text-lg font-bold">Week {week}</div>
                              <div className={`px-2 py-1 rounded-full text-xs font-medium ${getWeekStatusColor(weekStatus)}`}>
                                {weekStatus}
                              </div>
                              {isEditable && canEditCampaign(editingCampaign) && (
                                <div className="text-xs text-orange-600 font-medium">
                                  Editable
                                </div>
                              )}
                              {!isEditable && weekStatus === 'started' && (
                                <div className="text-xs text-blue-600 font-medium">
                                  In Progress
                                </div>
                              )}
                              {!isEditable && weekStatus === 'completed' && (
                                <div className="text-xs text-green-600 font-medium">
                                  Completed
                                </div>
                              )}
                              {!isEditable && weekStatus === 'pending' && !canEditCampaign(editingCampaign) && (
                                <div className="text-xs text-gray-600 font-medium">
                                  Locked
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Additional Info for Editable Campaigns */}
                    {canEditCampaign(editingCampaign) && (
                      <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
                        <div className="flex items-start gap-2">
                          <span className="text-blue-600">💡</span>
                          <div className="text-sm text-blue-700">
                            <div className="font-medium mb-1">Setup All Weeks Now</div>
                            <div>You can configure tasks for all 4 weeks during the first 7 days. Click on any week above to set up its tasks. Once a week starts, its tasks cannot be modified.</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Trial Campaign Info - Only for 24h trial campaigns */}
                {editingCampaign.duration?.value === '24h_trial' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">Trial Campaign</h3>
                      {canEditCampaign(editingCampaign) && (
                        <div className="text-sm text-gray-600">
                          You can edit tasks if the campaign hasn't started yet
                        </div>
                      )}
                    </div>

                    <div className="p-4 rounded-lg bg-orange-50 border border-orange-200">
                      <div className="flex items-start gap-2">
                        <span className="text-orange-600">🚀</span>
                        <div className="text-sm text-orange-700">
                          <div className="font-medium mb-1">24-Hour Trial Campaign</div>
                          <div>This is a trial campaign that runs for 24 hours. Perfect for testing our platform and getting quick results. You can edit tasks if the campaign hasn't started yet.</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Current Week Tasks */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-medium">
                      {editingCampaign.duration?.value === '1month' ? `Week ${currentWeek} Tasks` :
                        editingCampaign.duration?.value === '24h_trial' ? 'Trial Campaign Tasks' : 'Campaign Tasks'}
                    </h3>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-600">
                        {editingCampaign.duration?.value === '1month'
                          ? `${(editingCampaign.weeklyTasks?.[currentWeek]?.selectedTasks?.length || 0) + (editingCampaign.weeklyTasks?.[currentWeek]?.customTasks?.length || 0)} tasks`
                          : `${(editingCampaign.tasks?.length || 0) + (editingCampaign.customTasks?.length || 0)} tasks`
                        }
                      </span>
                      {editingCampaign.duration?.value === '1month' && editingCampaign.weeklyStatus?.[currentWeek] && (
                        <div className={`px-2 py-1 rounded-full text-xs font-medium ${editingCampaign.weeklyStatus[currentWeek] === 'completed'
                          ? 'bg-green-100 text-green-700'
                          : editingCampaign.weeklyStatus[currentWeek] === 'started'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-600'
                          }`}>
                          {editingCampaign.weeklyStatus[currentWeek]}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Week Status Info */}
                  {editingCampaign.weeklyStatus?.[currentWeek] && editingCampaign.weeklyStatus[currentWeek] !== 'pending' && (
                    <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                      <div className="flex items-center gap-2">
                        <span className="text-blue-600">ℹ️</span>
                        <span className="text-sm text-blue-700">
                          Week {currentWeek} is {editingCampaign.weeklyStatus[currentWeek]}. Tasks cannot be modified once a week has started.
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Add Task Button - Only for campaigns that are editable */}
                  {editingCampaign.duration?.value === '1month' ? (
                    canEditWeek(editingCampaign, currentWeek) ? (
                      <div className="space-y-2">
                        <Button
                          onClick={() => setShowTaskModal(true)}
                          className="flex items-center gap-2"
                          disabled={(editingCampaign?.weeklyTasks?.[currentWeek]?.selectedTasks?.length || 0) + (editingCampaign?.weeklyTasks?.[currentWeek]?.customTasks?.length || 0) >= 8}
                        >
                          <Plus className="h-4 w-4" />
                          Add Task
                        </Button>
                        <div className="text-xs text-gray-500">
                          Up to 8 tasks per week. You can edit tasks for weeks that haven't started yet.
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                        <span className="text-sm text-gray-600">
                          Week {currentWeek} is {editingCampaign.weeklyStatus?.[currentWeek] || 'not editable'}. Tasks cannot be modified.
                        </span>
                      </div>
                    )
                  ) : (
                    canEditWeek(editingCampaign, currentWeek) ? (
                      <div className="space-y-2">
                        <Button
                          onClick={() => setShowTaskModal(true)}
                          className="flex items-center gap-2"
                          disabled={(editingCampaign.tasks?.length || 0) + (editingCampaign.customTasks?.length || 0) >= 8}
                        >
                          <Plus className="h-4 w-4" />
                          Add Task
                        </Button>
                        <div className="text-xs text-gray-500">
                          {editingCampaign.duration?.value === '24h_trial'
                            ? 'Up to 8 tasks for your trial campaign. You can edit tasks if the campaign hasn\'t started yet.'
                            : 'Up to 8 tasks. You can edit tasks if the campaign hasn\'t started yet.'}
                        </div>
                      </div>
                    ) : (
                      <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                        <span className="text-sm text-gray-600">
                          Campaign is {editingCampaign.status}. Tasks cannot be modified once the campaign has started.
                        </span>
                      </div>
                    )
                  )}

                  {/* Selected Tasks */}
                  <div className="space-y-3">
                    {(editingCampaign.duration?.value === '1month'
                      ? editingCampaign.weeklyTasks?.[currentWeek]?.selectedTasks
                      : editingCampaign.tasks || []
                    )?.map((task: any, index: number) => {
                      const taskTemplate = TASK_TEMPLATES.find(t => t.id === task.id);
                      const isEditing = editingTaskIndex === index;
                      const canEdit = editingCampaign.duration?.value === '1month'
                        ? canEditWeek(editingCampaign, currentWeek)
                        : canEditWeek(editingCampaign, currentWeek);

                      return (
                        <div key={index} className="bg-orange-50 p-3 rounded-lg space-y-2 border border-orange-200">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="bg-white p-1.5 rounded-lg">
                                <span className="text-lg">{taskTemplate?.icon}</span>
                              </div>
                              <div className="flex flex-col">
                                <span className="font-medium text-gray-900 text-sm">{taskTemplate?.title}</span>
                                {task.options && task.options.length > 0 && !isEditing && (
                                  <div className="flex flex-wrap gap-2">
                                    {task.options.map((option: string) => (
                                      <span key={option} className="px-2 py-1 bg-orange-500 text-white rounded-full text-xs font-semibold">
                                        {option}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {!isEditing && canEdit && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleEditTask(index)}
                                  className="h-7 hover:bg-orange-100"
                                >
                                  Edit
                                </Button>
                              )}
                              {canEdit && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleRemoveTask(index)}
                                  className="h-7 w-7 hover:bg-orange-100"
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </div>
                          {isEditing ? (
                            <div className="space-y-3">
                              {task.id === 'engage_post' && (
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                  {TASK_TEMPLATES.find(t => t.id === 'engage_post')?.options?.map((option) => (
                                    <button
                                      key={option}
                                      onClick={() => {
                                        const updatedCampaign = { ...editingCampaign };
                                        if (editingCampaign.duration?.value === '1month') {
                                          const currentOptions = updatedCampaign.weeklyTasks[currentWeek].selectedTasks[index].options || [];
                                          if (currentOptions.includes(option)) {
                                            updatedCampaign.weeklyTasks[currentWeek].selectedTasks[index].options = currentOptions.filter((o: string) => o !== option);
                                          } else {
                                            updatedCampaign.weeklyTasks[currentWeek].selectedTasks[index].options = [...currentOptions, option];
                                          }
                                        } else {
                                          const currentOptions = updatedCampaign.tasks[index].options || [];
                                          if (currentOptions.includes(option)) {
                                            updatedCampaign.tasks[index].options = currentOptions.filter((o: string) => o !== option);
                                          } else {
                                            updatedCampaign.tasks[index].options = [...currentOptions, option];
                                          }
                                        }
                                        setEditingCampaign(updatedCampaign);
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
                            </div>
                          ) : (
                            task.link && (
                              <div className="flex flex-col gap-2 text-sm text-gray-700">
                                {task.options && task.options.length > 0 && (
                                  <div className="flex flex-wrap gap-2">
                                    {task.options.map((option: string) => (
                                      <span key={option} className="px-2 py-1 bg-orange-100 text-orange-700 rounded-full text-xs">
                                        {option}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <div className="flex items-center gap-2">
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
                              </div>
                            )
                          )}
                        </div>
                      );
                    })}

                    {/* Custom Tasks */}
                    {(editingCampaign.duration?.value === '1month'
                      ? editingCampaign.weeklyTasks?.[currentWeek]?.customTasks
                      : editingCampaign.customTasks || []
                    )?.map((task: any, index: number) => {
                      const canEdit = editingCampaign.duration?.value === '1month'
                        ? canEditWeek(editingCampaign, currentWeek)
                        : canEditWeek(editingCampaign, currentWeek); // Allow editing for weekly campaigns that haven't started

                      return (
                        <div key={index} className="bg-orange-50 p-3 rounded-lg space-y-2 border border-orange-200">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="bg-white p-1.5 rounded-lg">
                                <span className="text-lg">✨</span>
                              </div>
                              <span className="font-medium text-gray-900 text-sm">{task.description}</span>
                            </div>
                            {canEdit && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRemoveCustomTask(index)}
                                className="h-7 w-7 hover:bg-orange-100"
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            )}
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
                      );
                    })}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowEditModal(false);
                      setEditingCampaign(null);
                    }}
                  >
                    {(editingCampaign?.duration?.value === '1month' || editingCampaign?.duration?.value === '1week' || editingCampaign?.duration?.value === '24h_trial') && canEditCampaign(editingCampaign) ? 'Cancel' : 'Close'}
                  </Button>
                  {(editingCampaign?.duration?.value === '1month' || editingCampaign?.duration?.value === '1week' || editingCampaign?.duration?.value === '24h_trial') && canEditCampaign(editingCampaign) && (
                    <Button onClick={handleSaveCampaign}>
                      Save Changes
                    </Button>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Add Task Modal */}
        <Dialog open={showTaskModal} onOpenChange={setShowTaskModal}>
          <DialogContent className="sm:max-w-[600px] w-[95vw] max-h-[90vh] overflow-y-auto">
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
                        disabled={
                          editingCampaign?.duration?.value === '1month'
                            ? (editingCampaign?.weeklyTasks?.[currentWeek]?.selectedTasks?.length || 0) + (editingCampaign?.weeklyTasks?.[currentWeek]?.customTasks?.length || 0) >= 8
                            : (editingCampaign?.tasks?.length || 0) + (editingCampaign?.customTasks?.length || 0) >= 8
                        }
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
                  onChange={(e) => setNewCustomTask({ ...newCustomTask, description: e.target.value })}
                  placeholder="Describe what participants need to do"
                  className="text-sm"
                  rows={4}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="task-link">Task Link (Optional)</Label>
                <Input
                  id="task-link"
                  value={newCustomTask.link}
                  onChange={(e) => setNewCustomTask({ ...newCustomTask, link: e.target.value })}
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
      </div>
    </DashboardLayout>
  );
} 