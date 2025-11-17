import React from 'react';
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

interface PreviousButtonProps {
  onBack: () => void;
}

export default function PreviousButton({ onBack }: PreviousButtonProps) {
  return (
    <Button variant="ghost" className="flex items-center space-x-2" onClick={onBack}>
      <ArrowLeft className="w-5 h-5" />
      <span>Previous</span>
    </Button>
  );
}