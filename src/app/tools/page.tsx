import { redirect } from "next/navigation";

/** Legacy app launcher URL: keep all user experiences inside the REVENGE workspace. */
export default function ToolsRoute() {
  redirect("/chat?apps=1");
}
