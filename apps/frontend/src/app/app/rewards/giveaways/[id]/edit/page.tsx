"use client";

import { use } from "react";
import { GiveawayWizard } from "../../GiveawayWizard";

export default function EditGiveawayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <GiveawayWizard mode="edit" giveawayId={id} />;
}
