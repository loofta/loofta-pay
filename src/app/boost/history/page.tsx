"use client";

import { useBoostHistory } from '@/hooks/useBoostHistory';
import { formatDistanceToNow } from 'date-fns';
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import DashboardLayout from '@/components/layouts/DashboardLayout';
import Title from '@/components/Title';
import { ArrowLeft, ExternalLink, Check, Clock, X } from 'lucide-react';
import Link from 'next/link';
import { BoostStatus } from '@/app/actions/boosts/boosts';
import { useState } from 'react';
import { getTransactionUrl } from '@/lib/utils';

export default function BoostHistoryPage() {
  const { boosts, loading, error, refresh } = useBoostHistory();
  const [refreshingItems, setRefreshingItems] = useState<Set<string>>(new Set());

  const handleRefreshItem = async (itemId: string) => {
    setRefreshingItems(prev => new Set(prev).add(itemId));
    try {
      await refresh();
    } finally {
      setRefreshingItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(itemId);
        return newSet;
      });
    }
  };

  const getPaymentStatusColor = (status: BoostStatus) => {
    switch (status) {
      case 'paid':
        return 'bg-green-50 text-green-700 border-green-200';
      case 'pending':
        return 'bg-yellow-50 text-yellow-700 border-yellow-200';
      case 'failed':
        return 'bg-red-50 text-red-700 border-red-200';
      default:
        return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  const getPaymentStatusIcon = (status: BoostStatus) => {
    switch (status) {
      case 'paid':
        return <Check className="h-4 w-4" />;
      case 'pending':
        return <Clock className="h-4 w-4" />;
      case 'failed':
        return <X className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const getProcessingStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
        return 'bg-green-50 text-green-700 border-green-200';
      case 'in_progress':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'failed':
        return 'bg-red-50 text-red-700 border-red-200';
      default:
        return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  const formatProcessingStatus = (status: string) => {
    switch (status.toLowerCase()) {
      case 'in_progress':
        return 'In Progress';
      default:
        return status.charAt(0).toUpperCase() + status.slice(1);
    }
  };

  const getProcessingStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
        return <Check className="h-4 w-4" />;
      case 'in_progress':
        return <Clock className="h-4 w-4" />;
      case 'failed':
        return <X className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  return (
    <DashboardLayout>
      <div className='h-screen tg-webview flex flex-col relative'>
        <div className='flex-1 overflow-y-auto p-4'>
          <Title text="Boost History" showWallet={false} showPrevious={true} />

          <div className="max-w-4xl mx-auto mt-6">
            <div className="flex justify-end mb-6">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refresh()}
                disabled={loading}
                className="flex items-center gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>

            {error && (
              <div className="bg-red-50 p-4 rounded-lg mb-6">
                <p className="text-red-600">Error loading boost history. Please try again.</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refresh()}
                  className="mt-2"
                >
                  Retry
                </Button>
              </div>
            )}

            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
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
            ) : boosts?.length === 0 ? (
              <Card className="bg-white">
                <CardContent className="p-6 text-center">
                  <p className="text-gray-600">No boost history found</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {boosts?.map((boost) => (
                  <Card key={boost.id} className="bg-white hover:shadow-md transition-shadow">
                    <CardContent className="p-6">
                      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <a
                              href={boost.postLink.startsWith('http') ? boost.postLink : `https://${boost.postLink}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-orange-600 hover:text-orange-700 font-medium flex items-center gap-1"
                            >
                              View Post
                              <ExternalLink className="h-4 w-4" />
                            </a>
                            <div className="flex items-center gap-2">
                              <div className={`px-3 py-1 rounded-full border ${getPaymentStatusColor(boost.status)}`}>
                                <span className="text-sm font-medium capitalize">{boost.status}</span>
                              </div>
                              <div className={`px-3 py-1 rounded-full border ${getProcessingStatusColor(boost.processingStatus)}`}>
                                <span className="text-sm font-medium capitalize">{formatProcessingStatus(boost.processingStatus)}</span>
                              </div>
                            </div>
                          </div>
                          <div className="text-sm text-gray-600">
                            {formatDistanceToNow(new Date(boost.createdAt), { addSuffix: true })}
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="text-lg font-semibold text-orange-600">
                              {boost.amount} {boost.currency}
                            </div>
                            {boost.paymentHash && (
                              <a
                                href={getTransactionUrl(boost.paymentHash, 'taraxa')}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-500 hover:text-blue-700 flex items-center gap-1"
                              >
                                <span>{boost.paymentHash.slice(0, 3)}...{boost.paymentHash.slice(-3)} - See trx on explorer</span>
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRefreshItem(boost.id)}
                            disabled={refreshingItems.has(boost.id)}
                            className="h-8 w-8"
                          >
                            <RefreshCw className={`h-4 w-4 ${refreshingItems.has(boost.id) ? 'animate-spin' : ''}`} />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
} 