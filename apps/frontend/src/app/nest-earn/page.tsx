// Home for the standalone "Loofta Nest" surface (nest.loofta.xyz in prod, see proxy.ts): the
// marketing splash with How it works / The ledger. The nest itself lives at /nest-earn/app —
// signing in here sends you there (see NestApp's mode="home" handling).
import NestApp from "@/components/nest/NestApp";

export default function NestHomePage() {
  return <NestApp mode="home" />;
}
