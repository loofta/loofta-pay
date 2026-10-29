'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { Loader2, AlertCircle, ScanLine } from 'lucide-react'
import { GradientActionButton } from '@/components/ui/GradientActionButton'
import { fetchApi } from '@/services/api/client'

interface DecodedQr {
  scheme: 'PIX' | 'PROMPTPAY' | 'VIETQR' | 'QRPH' | 'QRIS' | 'SGQR' | 'BREB' | 'UNKNOWN'
  country: string | null
  currency: string | null
  amount: number | null
  merchantName: string | null
  merchantCity: string | null
  isStatic: boolean
  reference: string | null
  payee: Record<string, string>
}

const SCHEME_LABEL: Record<DecodedQr['scheme'], string> = {
  PIX: 'PIX (Brazil)',
  PROMPTPAY: 'PromptPay (Thailand)',
  VIETQR: 'VietQR (Vietnam)',
  QRPH: 'QR Ph (Philippines)',
  QRIS: 'QRIS (Indonesia)',
  SGQR: 'SGQR (Singapore)',
  BREB: 'Bre-B (Colombia)',
  UNKNOWN: 'Unrecognised QR',
}

export default function ScanPage() {
  const { ready, authenticated, login, getAccessToken } = usePrivy()
  const [payload, setPayload] = useState('')
  const [decoded, setDecoded] = useState<DecodedQr | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const cameraSupported = typeof window !== 'undefined' && 'BarcodeDetector' in window

  const decode = useCallback(
    async (text: string) => {
      setLoading(true)
      setError(null)
      setDecoded(null)
      try {
        const result = await fetchApi<DecodedQr>('/qr-pay/decode', {
          method: 'POST',
          body: JSON.stringify({ payload: text.trim() }),
          accessToken: await getAccessToken(),
        })
        setDecoded(result)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not read this QR code')
      } finally {
        setLoading(false)
      }
    },
    [getAccessToken],
  )

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCameraOn(false)
  }, [])

  useEffect(() => {
    if (!cameraOn) return
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] })
        timer = setInterval(async () => {
          try {
            const codes = await detector.detect(video)
            if (codes[0]?.rawValue) {
              clearInterval(timer)
              setPayload(codes[0].rawValue)
              stopCamera()
              decode(codes[0].rawValue)
            }
          } catch {
            // A failed frame is not an error, keep scanning.
          }
        }, 400)
      } catch {
        setError('Camera access was blocked. Paste the QR text instead.')
        setCameraOn(false)
      }
    })()
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [cameraOn, decode, stopCamera])

  useEffect(() => stopCamera, [stopCamera])

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!authenticated) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white px-4">
        <p className="text-base text-gray-300 text-center">Sign in to pay a merchant QR from your balance.</p>
        <div className="w-full max-w-xs">
          <GradientActionButton onClick={() => login()}>Sign in</GradientActionButton>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-var(--header-h,0px))] bg-[#0f0f12] text-white">
      <div className="mx-auto w-full max-w-md px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Loofta Pay</h1>
          <p className="mt-1 text-base text-gray-400">
            Scan a merchant QR in Brazil, Colombia, Thailand, Vietnam, the Philippines, Indonesia or Singapore and pay from your USDC balance.
          </p>
        </div>

        {cameraOn ? (
          <div className="space-y-3">
            <video ref={videoRef} className="w-full rounded-2xl bg-black aspect-square object-cover" playsInline muted />
            <button type="button" onClick={stopCamera} className="w-full h-11 rounded-2xl border border-white/10 text-base text-gray-300">
              Stop camera
            </button>
          </div>
        ) : (
          cameraSupported && (
            <GradientActionButton onClick={() => { setError(null); setCameraOn(true) }}>
              <ScanLine className="w-5 h-5" /> Scan QR
            </GradientActionButton>
          )
        )}

        <div className="space-y-2">
          <label htmlFor="qr-payload" className="block text-base text-gray-300">
            {cameraSupported ? 'Or paste the QR text' : 'Paste the QR text (PIX copia e cola)'}
          </label>
          <textarea
            id="qr-payload"
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            rows={3}
            placeholder="00020126..."
            className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-base text-white placeholder:text-gray-500 focus:outline-none focus:border-orange-400"
          />
          <GradientActionButton loading={loading} loadingText="Reading…" disabled={!payload.trim()} onClick={() => decode(payload)}>
            Read QR
          </GradientActionButton>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-2xl bg-red-500/10 border border-red-500/20 p-4 text-base text-red-300">
            <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {decoded && (
          <div className="rounded-2xl bg-[#111114] border border-white/10 p-5 space-y-3">
            <div className="text-base text-gray-400">{SCHEME_LABEL[decoded.scheme]}</div>
            <div className="text-xl font-semibold text-slate-100">{decoded.merchantName || 'Merchant'}</div>
            {decoded.merchantCity && <div className="text-base text-gray-400">{decoded.merchantCity}</div>}
            <div className="text-2xl font-semibold text-slate-100">
              {decoded.amount !== null ? `${decoded.amount.toLocaleString()} ${decoded.currency}` : `Amount set at payment (${decoded.currency})`}
            </div>
            <button
              type="button"
              disabled
              className="w-full h-11 rounded-2xl bg-white/5 text-base text-gray-400 cursor-not-allowed"
            >
              Payment for this rail is being connected
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
