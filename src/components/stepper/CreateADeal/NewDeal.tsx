import Title from "@/components/Title";
import CreateDealForm from "./Form";
import PreviousButton from "@/components/PreviousButton"; // Import the PreviousButton component
import { useRouter } from 'next/navigation';
import { Freelancer } from '@/app/utils/interfaces';  // Import the Freelancer type
import { CREATE_DEAL_ROUTE } from "@/app/utils/routes";

interface NewDealProps {
  formData: {
    description: string;
    amount: string;
    walletAddress: string;
    freelancerId: string;
    freelancer: Freelancer | null;
    expectedDeliveryDate: Date | undefined;
    valid: boolean;
  };
  setFormData: (data: {
    description: string;
    amount: string;
    walletAddress: string;
    freelancerId: string;
    freelancer: Freelancer | null;
    expectedDeliveryDate: Date | undefined;
    valid: boolean;
  }) => void;
  freelancers: Freelancer[];  // Add the freelancers prop here
}

export default function NewDeal({ formData, setFormData, freelancers }: NewDealProps) {
  const router = useRouter();
  console.log('formDaa', formData)

  return (
    <section className="mt-2">
      <PreviousButton onBack={() => router.push(CREATE_DEAL_ROUTE)} />
      <Title text="New Deal" customProperties="mx-4" />
      <CreateDealForm formData={formData} setFormData={setFormData} freelancers={freelancers} />
    </section>
  );
}
