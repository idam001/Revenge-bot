import { notFound, redirect } from "next/navigation";

const valid = new Set(["search", "image", "creator", "converter", "sports", "scripture"]);
export default async function NativeAppRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!valid.has(slug)) notFound();
  redirect(`/chat?apps=1&app=${encodeURIComponent(slug)}`);
}
