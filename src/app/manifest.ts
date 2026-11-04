import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "REVENGE GPT",
    short_name: "REVENGE",
    description: "Claude-style AI workspace built by Idam Emmanuel.",
    start_url: "/",
    display: "standalone",
    background_color: "#262624",
    theme_color: "#262624",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
