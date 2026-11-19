import { redirectTo } from "@/lib/http";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  session.destroy();
  return redirectTo("/login");
}
