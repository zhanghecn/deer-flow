import { z } from "zod";

const envSchema = z.object({
  VITE_BACKEND_BASE_URL: z.string().optional(),
  VITE_MESSAGE_TRACE_DISPLAY_MODE: z.enum(["debug", "user"]).default("debug"),
  VITE_OPENPENCIL_DEV_SERVER_URL: z.string().optional(),
  VITE_STATIC_WEBSITE_ONLY: z.string().optional(),
});

function getEnv() {
  // Keep display-mode policy explicit and build-time configurable; invalid
  // values should fail fast instead of silently changing what users can see.
  const parsed = envSchema.safeParse({
    VITE_BACKEND_BASE_URL: import.meta.env.VITE_BACKEND_BASE_URL,
    VITE_MESSAGE_TRACE_DISPLAY_MODE:
      import.meta.env.VITE_MESSAGE_TRACE_DISPLAY_MODE,
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
