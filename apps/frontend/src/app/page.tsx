import { redirect } from "next/navigation";

/** Homepage is payroll — redirect to organizations list */
export default function Home() {
  redirect("/payroll");
}
