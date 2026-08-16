'use client'

import { usePrivy } from '@privy-io/react-auth'
import { Loader2 } from 'lucide-react'
import { AgentChatBox } from '@/components/app/AgentChatBox'

const LOOFTA_ICON = '/images/icons/loofta-icon.svg'

export default function TwitterBotPage() {
  const { ready } = usePrivy()

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-7 w-7 animate-spin text-white/30" />
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-[calc(100dvh-var(--header-h,0px))] px-4 py-6 sm:py-10">
      <div className="w-full max-w-3xl">
        <div className="flex items-center gap-3 mb-5">
          <img src={LOOFTA_ICON} alt="" className="h-6 w-6" />
          <span className="font-display font-semibold text-lg tracking-[0.16em] text-white">loofta terminal</span>
          <div className="h-px flex-1 bg-white/[0.08]" />
        </div>

        <AgentChatBox />

        <p className="text-center text-base text-slate-600 mt-3.5">
          Non-custodial &middot; you confirm every payment before it sends.
        </p>
      </div>
    </div>
  )
}
