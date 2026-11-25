import { redirectTo } from "@/lib/http";
import { isDemoModeSafe } from "@/lib/demo";
import { getSession } from "@/lib/session";

export async function GET() {
  if (isDemoModeSafe()) return redirectTo("/");
  const session = await getSession();
  session.destroy();
  return redirectTo("/login");
}
