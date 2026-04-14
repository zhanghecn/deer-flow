import { z } from "zod";

const envSchema = z.object({
  VITE_BACKEND_BASE_URL: z.string().optional(),
  VITE_OPENPENCIL_DEV_SERVER_URL: z.string().optional(),
  VITE_STATIC_WEBSITE_ONLY: z.string().optional(),
});

function getEnv() {
  const parsed = envSchema.safeParse({
    VITE_BACKEND_BASE_URL: import.meta.env.VITE_BACKEND_BASE_URL,
    VITE_OPENPENCIL_DEV_SERVER_URL: import.meta.env.VITE_OPENPENCIL_DEV_SERVER_URL,
    VITE_STATIC_WEBSITE_ONLY: import.meta.env.VITE_STATIC_WEBSITE_ONLY,
  });

  if (!parsed.success) {
    console.error(
      "Invalid environment variables:",
      parsed.error.flatten().fieldErrors,
    );
    throw new Error("Invalid environment variables");
  }

  return parsed.data;
}

export const env = getEnv();
