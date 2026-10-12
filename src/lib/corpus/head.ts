import { PRODUCT_NAME } from "@/lib/branding";

export function pageHead(title: string, description: string) {
  const t = `${title} — ${PRODUCT_NAME}`;
  return {
    meta: [
      { title: t },
      { name: "description", content: description },
      { property: "og:title", content: t },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  };
}
