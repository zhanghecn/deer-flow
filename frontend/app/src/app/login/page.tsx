import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { AuthLoadingScreen } from "@/components/auth/auth-loading-screen";
import { AuthScreen } from "@/components/auth/auth-screen";
import { useAuth } from "@/core/auth/hooks";

export default function LoginPage() {
  const navigate = useNavigate();
  const { authenticated, ready } = useAuth();

  useEffect(() => {
    if (ready && authenticated) {
      void navigate("/workspace", { replace: true });
    }
  }, [authenticated, navigate, ready]);

  if (!ready) {
    return <AuthLoadingScreen />;
  }

  if (authenticated) {
    return <AuthLoadingScreen />;
  }

  return <AuthScreen />;
}
