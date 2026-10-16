// The nest itself (nest.loofta.com/app in prod): onboarding, dashboard, tabs. Marketing lives
// one level up at /nest-earn.
import NestApp from "@/components/nest/NestApp";

export default function NestAppPage() {
  return <NestApp mode="app" />;
}
