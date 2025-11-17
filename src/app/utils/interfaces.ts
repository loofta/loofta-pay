import { PaymentStatus } from "./types";

export interface IOngoingDealCardProps {
    title?: string;
    dealId: string;
    description: string;
    dateCreated: number;
    amount: string;
    points?: number;
    paymentStatus: PaymentStatus;
    recipientWalletAddress: string;
    curentIterationNumber?: number;
    recipientId: string;
    senderTgUsername: string;
    dealStatus: string;
    campaignId?: string;
    requireSubmission?: boolean;
    expectedDeliveryDate?: string | Date;
}

export interface ICreateDeal {
    title?: string;
    points?: number;
    id: string;
    walletAddress: string;
    description: string;
    paymentStatus: string;
    expectedDeliveryDate: string;
    recipientWalletAddress: string;
    recipientId: string;
    amount: number;
    senderTgId: number;
    senderTgUsername: string;
    recipientTgId: number | null;
    recipientTgUsername: string;
    campaignId?: string;
    requireSubmission?: boolean;
}

export interface IPastDealCardProps {
    title?: string;
    dealStatus?: string;
    points?: number;
    paymentStatus?: string;
    dealId: string;
    description: string;
    amount: string;
    expectedDeliveryDate: string;
    dateCreated?: string;
    earnedPoints: number;
    recipientWalletAddress: string;
    recipientId: string;
    senderTgUsername: string;
    isReceived: boolean;
    requireSubmission?: boolean;
    campaignId?: string;
}

export interface CampaignDeal {
    dealId: string;
    dealStatus?: string;
    campaignId: string;
    paymentStatus?: string;
    recipients: Freelancer[];
    pointsEarned: number;
    amountEarned: number;
    level: FreelancerStatus;
}

export interface Campaign {
    userId: number;
    campaignId: string;
    title: string;
    description: string;
    creationDate: string;
    contributorsTgHandles?: string[];
    creatorTgHandle: string;
    paymentStatus: string;
    startDate: string;
    package: string;
    campaignType: string;
    campaignStatus: CampaignStatus;
    linkToPromote?: string;
    tasks?: Array<{
        id: string;
        link: string;
        options?: string[];
    }>;
    customTasks?: Array<{
        description: string;
        link: string;
    }>;
    kolPackage?: string | null;
    kolDetails?: {
        goals: string;
        cta: string;
        targetAudience: string;
    } | null;
    rewardType?: string | null;
    rewardPool?: string;
    numberOfWinners?: string;
    distributionType?: string | null;
    rewardCriteria?: string;
    tokenContract?: string;
    tokenTicker?: string;
    addons?: string[];
    totalPrice?: number;
    paymentHash?: string;
}

export interface CreatorCampaign {
    id: string;
    itemId?: string;
    userId?: string;
    status?: 'pending' | 'processing' | 'completed';
    createdAt?: string;
    completedAt?: string;
    updatedAt?: string;
    paymentAmount?: number;
    paymentType?: 'points' | 'usdt';
    pointsSpent?: number;
    usdtSpent?: number;
    creatorsRewarded?: number;
    title?: string;
    creationDate?: string;
    startDate?: string;
    campaignId?: string;
    description?: string;
    contributorsTgHandles?: string[];
    creatorTgHandle?: string;
    paymentStatus?: string;
    package?: any;
    linkToPromote?: string;
    campaignStatus?: string;
    campaignType?: string;
    creatorTgId?: number;
}

export interface ITelegramUserData {
    username?: string;
    first_name: string;
    last_name?: string;
    photo_url?: string;
    id: number;
}

export interface Freelancer {
    id: string;
    category: string;
    jobTitle: string;
    fullName: string;
    telegramHandle: string;
    telegramId?: number;
    twitterHandle?: string;
    walletAddress: string;
    description: string;
    country: string;
    creationDate: string;
    email: string;
    github?: string;
    services: string;
    status: FreelancerStatus;
    website?: string;
    followersCount?: string;
    engagementRate?: number;
    referredUsers?: number;
  }

export enum FreelancerStatus {
  Vip = "vip",
  Verified = "verified",
  Unverified = "unverified",
  Platinium = "platinium"
}

export enum CampaignStatus {
    Draft = "draft",
    Scheduled = "scheduled",
    Started = "started",
    Paused = "paused",
    Stopped = "stopped"
}

export enum CampaignType {
    Impressions = "Impressions",
    Engagements = "Engagements",
    ProductVisit = "Product Visit"
}

export interface MemeCoinMarketingOffer {
    id: string;
    title: string;
    price: number;
    originalPrice: number;
    discount: number;
    description: string;
    features: string[];
}

export interface MemeCoinProject {
    id: string;
    projectName: string;
    contractAddress: string;
    telegram: string;
    twitter: string;
    description: string;
    selectedOfferId: string;
    paymentStatus: PaymentStatus;
    createdAt: string;
    userId: string;
}


