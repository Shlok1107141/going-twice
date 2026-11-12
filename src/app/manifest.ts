import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Going Twice",
    short_name: "Going Twice",
    description:
      "Going Twice turns any live auction into a one-tap checkout: every paddle is a PayPal authorization hold, an AI auctioneer runs the room, and the gavel settles everyone.",
    start_url: "/paddle",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#faf9f5",
    theme_color: "#faf9f5",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
