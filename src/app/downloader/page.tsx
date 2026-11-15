import { redirect } from "next/navigation";

/** Open the downloader mini-app inside the REVENGE chat workspace shell. */
export default function DownloaderRoute() {
  redirect("/chat?apps=1&app=downloader");
}
