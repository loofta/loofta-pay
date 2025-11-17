'use client';

import { ArrowLeftRight } from 'lucide-react';
import DashboardLayout from '@/components/layouts/DashboardLayout';
import Title from '@/components/Title';

export default function BridgePage() {
  return (
    <DashboardLayout>
      <div className='h-screen tg-webview flex flex-col relative'>
        <div className='flex-1 overflow-y-auto p-4'>
          <Title text="Bridge Assets" showWallet={false} showPrevious={true} />

          <div className="max-w-4xl mx-auto mt-6">
            {/* Header Section */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200/75 mb-8">
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-gradient-to-br from-blue-100 to-blue-50 p-2.5 rounded-xl">
                  <ArrowLeftRight className="h-7 w-7 text-blue-600" />
                </div>
                <h2 className="text-xl font-semibold">Bridge Your Assets</h2>
              </div>
              <p className="text-gray-600 mb-6">
                Seamlessly bridge your tokens between different blockchain networks using RocketX's secure and efficient cross-chain bridge.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-blue-600 font-bold">⚡</span>
                    <span className="font-medium text-blue-700">Fast & Secure</span>
                  </div>
                  <p className="text-sm text-blue-600">Quick cross-chain transfers</p>
                </div>
                <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-blue-600 font-bold">🔗</span>
                    <span className="font-medium text-blue-700">Multi-Chain</span>
                  </div>
                  <p className="text-sm text-blue-600">Support for major networks</p>
                </div>
                <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-blue-600 font-bold">💰</span>
                    <span className="font-medium text-blue-700">Low Fees</span>
                  </div>
                  <p className="text-sm text-blue-600">Competitive bridge fees</p>
                </div>
              </div>
            </div>

            {/* RocketX Widget */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200/75 overflow-hidden">
              <div style={{ height: 'calc(100vh - 300px)', minHeight: '600px', width: '100%' }}>
                <iframe
                  height="100%"
                  width="100%"
                  src="https://widget.rocketx.exchange/swap/ETHEREUM.ethereum/POLYGON.matic-network/1?rx_p=1&rx_t=light&rx_p_c=038A6A&rx_k=cef36f1a-bba4-4da0-a1f6-d40eed89f5f7"
                  style={{ border: 'none' }}
                  title="RocketX Bridge Widget"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
} 