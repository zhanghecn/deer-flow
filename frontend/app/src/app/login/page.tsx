import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

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
    return null;
  }

  if (authenticated) {
    return null;
  }

  return <AuthScreen />;
}
