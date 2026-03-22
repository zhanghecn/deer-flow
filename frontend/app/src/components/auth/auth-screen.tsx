import {
  ArrowRightIcon,
  CheckCircle2Icon,
  LockKeyholeIcon,
  UserRoundPlusIcon,
} from "lucide-react";
import { lazy, type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { login, register } from "@/core/auth/api";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

type AuthTab = "login" | "register";

const FlickeringGrid = lazy(
  () => import("@/components/ui/flickering-grid").then((m) => ({ default: m.FlickeringGrid })),
);
const Galaxy = lazy(() => import("@/components/ui/galaxy"));

export function AuthScreen() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const queryMode =
    searchParams.get("mode") === "register" ? "register" : "login";

  const [activeTab, setActiveTab] = useState<AuthTab>(queryMode);
  const [authControlsReady, setAuthControlsReady] = useState(false);
  const [showVisualEffects, setShowVisualEffects] = useState(false);

  const [loginAccount, setLoginAccount] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoginLoading, setIsLoginLoading] = useState(false);

  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [isRegisterLoading, setIsRegisterLoading] = useState(false);

  useEffect(() => {
    setActiveTab(queryMode);
  }, [queryMode]);

  useEffect(() => {
    setAuthControlsReady(true);
  }, []);

  useEffect(() => {
    // Defer heavy canvas/WebGL effects so the auth form hydrates and becomes
    // interactive before decorative visuals start consuming the main thread.
    const timer = window.setTimeout(() => {
      setShowVisualEffects(true);
    }, 300);
    return () => window.clearTimeout(timer);
  }, []);

  function updateTab(value: string) {
    const nextTab: AuthTab = value === "register" ? "register" : "login";
    setActiveTab(nextTab);
    setLoginError(null);
    setRegisterError(null);
    void navigate(nextTab === "register" ? "/login?mode=register" : "/login", {
      replace: true,
    });
  }

  async function handleLoginSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoginError(null);
    setIsLoginLoading(true);
    try {
      await login(loginAccount, loginPassword);
      window.location.assign("/workspace");
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : t.auth.loginFailed);
    } finally {
      setIsLoginLoading(false);
    }
  }

  async function handleRegisterSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setRegisterError(null);
    if (registerPassword !== confirmPassword) {
      setRegisterError(t.auth.passwordMismatchError);
      return;
    }
    if (registerPassword.length < 8) {
      setRegisterError(t.auth.passwordTooShortError);
      return;
    }

    setIsRegisterLoading(true);
    try {
      await register(registerEmail, registerPassword, registerName);
      window.location.assign("/workspace");
    } catch (err) {
      setRegisterError(
        err instanceof Error ? err.message : t.auth.registrationFailed,
      );
    } finally {
      setIsRegisterLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#04060b] text-white">
      {showVisualEffects ? (
        <>
          <div className="pointer-events-none absolute inset-0 z-0 bg-black/30">
            <Galaxy
              mouseRepulsion={false}
              starSpeed={0.15}
              density={0.45}
              glowIntensity={0.25}
              twinkleIntensity={0.28}
              speed={0.45}
            />
          </div>
          <FlickeringGrid
            className="pointer-events-none absolute inset-0 z-0 opacity-30"
            squareSize={4}
            gridGap={5}
            color="#00D1FF"
            maxOpacity={0.22}
            flickerChance={0.22}
          />
        </>
      ) : null}
      <div className="absolute inset-0 z-0 bg-[radial-gradient(120%_120%_at_80%_0%,rgba(109,141,255,0.24)_0%,rgba(4,6,11,0)_55%),radial-gradient(120%_120%_at_0%_100%,rgba(25,211,178,0.2)_0%,rgba(4,6,11,0)_48%)]" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid w-full gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="hidden rounded-3xl border border-white/15 bg-black/35 p-8 backdrop-blur-md lg:flex lg:flex-col lg:justify-between">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-medium tracking-[0.18em] text-cyan-100 uppercase">
                DeerFlow
              </p>
              <h1 className="mt-6 text-4xl leading-tight font-semibold text-white">
                {t.auth.heroTitle}
              </h1>
              <p className="mt-5 max-w-lg text-base leading-relaxed text-white/70">
                {t.auth.heroDescription}
              </p>
            </div>

            <ul className="space-y-4 text-sm text-white/80">
              {[
                t.auth.heroFeatureThreads,
                t.auth.heroFeatureSkills,
                t.auth.heroFeatureJwt,
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-cyan-200" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-3xl border border-white/15 bg-[#0d1322]/82 p-6 shadow-[0_24px_80px_rgba(3,8,18,0.65)] backdrop-blur-md sm:p-8 dark:glass dark:glow-cyan">
            <div className="mb-8 flex items-start justify-between gap-4">
              <div>
                <Link
                  to="/"
                  className="text-3xl font-semibold tracking-tight"
                >
                  DeerFlow
                </Link>
                <p className="mt-2 text-sm text-white/60">
                  {t.auth.panelSubtitle}
                </p>
              </div>
              <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-xs font-medium text-emerald-100">
                {t.auth.badge}
              </span>
            </div>

            <Tabs value={activeTab} onValueChange={updateTab}>
              <TabsList className="grid h-11 w-full grid-cols-2 rounded-xl bg-white/5 p-1">
                <TabsTrigger
                  value="login"
                  disabled={!authControlsReady}
                  className={cn(
                    "h-9 rounded-lg text-white/70",
                    "data-[state=active]:border-white/20 data-[state=active]:bg-white/10 data-[state=active]:text-white",
                  )}
                >
                  <LockKeyholeIcon className="size-4" />
                  {t.auth.signInTab}
                </TabsTrigger>
                <TabsTrigger
                  value="register"
                  disabled={!authControlsReady}
                  className={cn(
                    "h-9 rounded-lg text-white/70",
                    "data-[state=active]:border-white/20 data-[state=active]:bg-white/10 data-[state=active]:text-white",
                  )}
                >
                  <UserRoundPlusIcon className="size-4" />
                  {t.auth.registerTab}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="mt-6">
                <form onSubmit={handleLoginSubmit} className="space-y-4">
                  {loginError && (
                    <div className="rounded-lg border border-red-300/30 bg-red-300/10 px-3 py-2 text-sm text-red-100">
                      {loginError}
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="login-account"
                      className="mb-2 block text-sm text-white/75"
                    >
                      Account
                    </label>
                    <Input
                      id="login-account"
                      type="text"
                      autoComplete="username"
                      required
                      disabled={!authControlsReady}
                      value={loginAccount}
                      onChange={(e) => setLoginAccount(e.target.value)}
                      placeholder="admin"
                      className="h-11 rounded-lg border-white/20 bg-white/5 text-white placeholder:text-white/40 focus-visible:border-white/35 focus-visible:ring-white/20"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="login-password"
                      className="mb-2 block text-sm text-white/75"
                    >
                      {t.auth.passwordLabel}
                    </label>
                    <Input
                      id="login-password"
                      type="password"
                      autoComplete="current-password"
                      required
                      disabled={!authControlsReady}
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder={t.auth.loginPasswordPlaceholder}
                      className="h-11 rounded-lg border-white/20 bg-white/5 text-white placeholder:text-white/40 focus-visible:border-white/35 focus-visible:ring-white/20"
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={!authControlsReady || isLoginLoading}
                    className="mt-2 h-11 w-full rounded-lg bg-white text-black hover:bg-white/90"
                  >
                    {isLoginLoading ? t.auth.signingIn : t.auth.signInAction}
                    <ArrowRightIcon className="size-4" />
                  </Button>
                </form>

                <p className="mt-4 text-center text-sm text-white/60">
                  {t.auth.newHere}{" "}
                  <button
                    type="button"
                    disabled={!authControlsReady}
                    onClick={() => updateTab("register")}
                    className="cursor-pointer font-medium text-cyan-200 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {t.auth.createAccountLink}
                  </button>
                </p>
              </TabsContent>

              <TabsContent value="register" className="mt-6">
                <form onSubmit={handleRegisterSubmit} className="space-y-4">
                  {registerError && (
                    <div className="rounded-lg border border-red-300/30 bg-red-300/10 px-3 py-2 text-sm text-red-100">
                      {registerError}
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="register-name"
                      className="mb-2 block text-sm text-white/75"
                    >
                      {t.auth.nameLabel}
                    </label>
                    <Input
                      id="register-name"
                      type="text"
                      autoComplete="name"
                      required
                      disabled={!authControlsReady}
                      value={registerName}
                      onChange={(e) => setRegisterName(e.target.value)}
                      placeholder={t.auth.registerNamePlaceholder}
                      className="h-11 rounded-lg border-white/20 bg-white/5 text-white placeholder:text-white/40 focus-visible:border-white/35 focus-visible:ring-white/20"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="register-email"
                      className="mb-2 block text-sm text-white/75"
                    >
                      {t.auth.emailLabel}
                    </label>
                    <Input
                      id="register-email"
                      type="email"
                      autoComplete="email"
                      required
                      disabled={!authControlsReady}
                      value={registerEmail}
                      onChange={(e) => setRegisterEmail(e.target.value)}
                      placeholder={t.auth.registerEmailPlaceholder}
                      className="h-11 rounded-lg border-white/20 bg-white/5 text-white placeholder:text-white/40 focus-visible:border-white/35 focus-visible:ring-white/20"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="register-password"
                      className="mb-2 block text-sm text-white/75"
                    >
                      {t.auth.passwordLabel}
                    </label>
                    <Input
                      id="register-password"
                      type="password"
                      autoComplete="new-password"
                      required
                      disabled={!authControlsReady}
                      value={registerPassword}
                      onChange={(e) => setRegisterPassword(e.target.value)}
                      placeholder={t.auth.registerPasswordPlaceholder}
                      className="h-11 rounded-lg border-white/20 bg-white/5 text-white placeholder:text-white/40 focus-visible:border-white/35 focus-visible:ring-white/20"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="confirm-password"
                      className="mb-2 block text-sm text-white/75"
                    >
                      {t.auth.confirmPasswordLabel}
                    </label>
                    <Input
                      id="confirm-password"
                      type="password"
                      autoComplete="new-password"
                      required
                      disabled={!authControlsReady}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder={t.auth.confirmPasswordPlaceholder}
                      className="h-11 rounded-lg border-white/20 bg-white/5 text-white placeholder:text-white/40 focus-visible:border-white/35 focus-visible:ring-white/20"
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={!authControlsReady || isRegisterLoading}
                    className="mt-2 h-11 w-full rounded-lg bg-cyan-300 text-[#041422] hover:bg-cyan-200"
                  >
                    {isRegisterLoading
                      ? t.auth.creatingAccount
                      : t.auth.createAccountAction}
                    <ArrowRightIcon className="size-4" />
                  </Button>
                </form>

                <p className="mt-4 text-center text-sm text-white/60">
                  {t.auth.alreadyHaveAccount}{" "}
                  <button
                    type="button"
                    disabled={!authControlsReady}
                    onClick={() => updateTab("login")}
                    className="cursor-pointer font-medium text-cyan-200 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {t.auth.signInLink}
                  </button>
                </p>
              </TabsContent>
            </Tabs>
          </section>
        </div>
      </div>
    </div>
  );
}
