import { useState, useEffect } from 'react';
import { getDealsByCampaignIds, exportCampaignDealsToExcel, CampaignStats } from '@/app/actions/campaigns/campaignStats';
import { exportToExcel } from '@/lib/exportUtils';
import { toast } from '@/components/ui/use-toast';

export function useCampaignStats(linkedCampaignIds: string[] | undefined) {
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    if (!linkedCampaignIds || linkedCampaignIds.length === 0) {
      setStats(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await getDealsByCampaignIds(linkedCampaignIds);
      
      if (result.success && result.stats) {
        setStats(result.stats);
      } else {
        setError(result.error || 'Failed to fetch campaign stats');
      }
    } catch (err) {
      setError('An error occurred while fetching stats');
      console.error('Error fetching campaign stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const exportToExcelFile = async (campaignTitle: string) => {
    if (!linkedCampaignIds || linkedCampaignIds.length === 0) {
      toast({
        title: "No Data",
        description: "No campaign data available to export.",
        variant: "destructive",
      });
      return;
    }

    try {
      const result = await exportCampaignDealsToExcel(linkedCampaignIds);
      
      if (result.success && result.data) {
        const filename = `${campaignTitle.replace(/[^a-zA-Z0-9]/g, '_')}_submissions_${new Date().toISOString().slice(0, 10)}`;
        const success = exportToExcel(result.data, filename);
        
        if (success) {
          toast({
            title: "Export Successful",
            description: "Campaign submissions have been exported to Excel.",
          });
        } else {
          throw new Error('Export failed');
        }
      } else {
        throw new Error(result.error || 'Export failed');
      }
    } catch (err) {
      console.error('Error exporting to Excel:', err);
      toast({
        title: "Export Failed",
        description: "There was an error exporting the data. Please try again.",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    fetchStats();
  }, [linkedCampaignIds]);

  return {
    stats,
    loading,
    error,
    refetch: fetchStats,
    exportToExcel: exportToExcelFile,
  };
}

