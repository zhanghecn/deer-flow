import {
  ArrowRightIcon,
  CheckCircle2Icon,
  LockKeyholeIcon,
  Loader2Icon,
  UserRoundPlusIcon,
} from "lucide-react";
import { lazy, type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { login, register } from "@/core/auth/api";
import { APP_NAME } from "@/core/config/site";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

type AuthTab = "login" | "register";

const FlickeringGrid = lazy(
  () => import("@/components/ui/flickering-grid").then((m) => ({ default: m.FlickeringGrid })),
);

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
    // Defer decorative visuals until form is interactive
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
      {/* Reduced-intensity background — single subtle gradient, no heavy canvas */}
      {showVisualEffects ? (
        <FlickeringGrid
          className="pointer-events-none absolute inset-0 z-0 opacity-[0.04]"
          squareSize={4}
          gridGap={5}
          color="#ffffff"
          maxOpacity={0.15}
          flickerChance={0.15}
        />
      ) : null}
      <div className="absolute inset-0 z-0 bg-[radial-gradient(120%_120%_at_80%_0%,rgba(60,80,120,0.12)_0%,rgba(4,6,11,0)_55%)]" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl items-center px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid w-full gap-8 lg:grid-cols-[1fr_1fr]">
          {/* Left: Brand panel — calmer, more trustworthy */}
          <section className="hidden flex-col justify-between lg:flex">
            <div>
              <Link to="/" className="inline-block">
                <span className="font-serif text-2xl tracking-tight text-white/90">
                  {APP_NAME}
                </span>
              </Link>
              <h1 className="mt-8 text-3xl leading-tight font-semibold tracking-tight text-white/90">
                {t.auth.heroTitle}
              </h1>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-white/50">
                {t.auth.heroDescription}
              </p>
            </div>

            {/* Feature list — tighter, calmer */}
            <ul className="space-y-3 text-sm text-white/60">
              {[
                t.auth.heroFeatureThreads,
                t.auth.heroFeatureSkills,
                t.auth.heroFeatureJwt,
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-white/30" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Right: Form panel — elevated but not glowing */}
          <section className="rounded-xl border border-white/8 bg-[#0a0f1a]/90 p-6 shadow-2xl shadow-black/40 backdrop-blur-md sm:p-8">
            {/* Mobile brand header */}
            <div className="mb-8 flex items-start justify-between gap-4 lg:hidden">
              <div>
                <Link
                  to="/"
                  className="text-2xl font-semibold tracking-tight text-white/90"
                >
                  {APP_NAME}
                </Link>
                <p className="mt-1 text-sm text-white/50">
                  {t.auth.panelSubtitle}
                </p>
              </div>
            </div>

            {/* Desktop form header */}
            <div className="mb-6 hidden items-center justify-between lg:flex">
              <p className="text-sm text-white/50">
                {t.auth.panelSubtitle}
              </p>
              <span className="rounded-full border border-white/8 bg-white/5 px-2.5 py-0.5 text-[10px] font-medium tracking-wider text-white/40 uppercase">
                {t.auth.badge}
              </span>
            </div>

            <Tabs value={activeTab} onValueChange={updateTab}>
              <TabsList className="grid h-10 w-full grid-cols-2 rounded-lg bg-white/5 p-1">
                <TabsTrigger
                  value="login"
                  disabled={!authControlsReady}
                  className={cn(
                    "h-8 rounded-md text-sm text-white/50 transition-colors",
                    "data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-none",
                  )}
                >
                  <LockKeyholeIcon className="mr-1.5 size-3.5" />
                  {t.auth.signInTab}
                </TabsTrigger>
                <TabsTrigger
                  value="register"
                  disabled={!authControlsReady}
                  className={cn(
                    "h-8 rounded-md text-sm text-white/50 transition-colors",
                    "data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow-none",
                  )}
                >
                  <UserRoundPlusIcon className="mr-1.5 size-3.5" />
                  {t.auth.registerTab}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="mt-5">
                <form onSubmit={handleLoginSubmit} className="space-y-4">
                  {loginError && (
                    /* Clearer error — more contrast, structured */
                    <div className="flex items-start gap-2 rounded-md border border-red-400/20 bg-red-400/8 px-3 py-2.5 text-sm text-red-300">
                      <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-red-400" />
                      {loginError}
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="login-account"
                      className="mb-1.5 block text-xs font-medium text-white/60"
                    >
                      {t.auth.accountLabel}
                    </label>
                    <Input
                      id="login-account"
                      type="text"
                      autoComplete="username"
                      required
                      disabled={!authControlsReady || isLoginLoading}
                      value={loginAccount}
                      onChange={(e) => setLoginAccount(e.target.value)}
                      placeholder={t.auth.loginEmailPlaceholder}
                      className="h-10 rounded-md border-white/10 bg-white/[0.03] text-sm text-white placeholder:text-white/25 focus-visible:border-white/25 focus-visible:ring-white/10"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="login-password"
                      className="mb-1.5 block text-xs font-medium text-white/60"
                    >
                      {t.auth.passwordLabel}
                    </label>
                    <Input
                      id="login-password"
                      type="password"
                      autoComplete="current-password"
                      required
                      disabled={!authControlsReady || isLoginLoading}
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder={t.auth.loginPasswordPlaceholder}
                      className="h-10 rounded-md border-white/10 bg-white/[0.03] text-sm text-white placeholder:text-white/25 focus-visible:border-white/25 focus-visible:ring-white/10"
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={!authControlsReady || isLoginLoading}
                    className="mt-1 h-10 w-full rounded-md bg-white text-sm font-medium text-black hover:bg-white/90"
                  >
                    {isLoginLoading ? (
                      <Loader2Icon className="mr-2 size-4 animate-spin" />
                    ) : (
                      <ArrowRightIcon className="mr-2 size-4" />
                    )}
                    {isLoginLoading ? t.auth.signingIn : t.auth.signInAction}
                  </Button>
                </form>

                <p className="mt-4 text-center text-sm text-white/40">
                  {t.auth.newHere}{" "}
                  <button
                    type="button"
                    disabled={!authControlsReady || isLoginLoading}
                    onClick={() => updateTab("register")}
                    className="cursor-pointer font-medium text-white/70 hover:text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {t.auth.createAccountLink}
                  </button>
                </p>
              </TabsContent>

              <TabsContent value="register" className="mt-5">
                <form onSubmit={handleRegisterSubmit} className="space-y-4">
                  {registerError && (
                    <div className="flex items-start gap-2 rounded-md border border-red-400/20 bg-red-400/8 px-3 py-2.5 text-sm text-red-300">
                      <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-red-400" />
                      {registerError}
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="register-name"
                      className="mb-1.5 block text-xs font-medium text-white/60"
                    >
                      {t.auth.nameLabel}
                    </label>
                    <Input
                      id="register-name"
                      type="text"
                      autoComplete="name"
                      required
                      disabled={!authControlsReady || isRegisterLoading}
                      value={registerName}
                      onChange={(e) => setRegisterName(e.target.value)}
                      placeholder={t.auth.registerNamePlaceholder}
                      className="h-10 rounded-md border-white/10 bg-white/[0.03] text-sm text-white placeholder:text-white/25 focus-visible:border-white/25 focus-visible:ring-white/10"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="register-email"
                      className="mb-1.5 block text-xs font-medium text-white/60"
                    >
                      {t.auth.emailLabel}
                    </label>
                    <Input
                      id="register-email"
                      type="email"
                      autoComplete="email"
                      required
                      disabled={!authControlsReady || isRegisterLoading}
                      value={registerEmail}
                      onChange={(e) => setRegisterEmail(e.target.value)}
                      placeholder={t.auth.registerEmailPlaceholder}
                      className="h-10 rounded-md border-white/10 bg-white/[0.03] text-sm text-white placeholder:text-white/25 focus-visible:border-white/25 focus-visible:ring-white/10"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="register-password"
                      className="mb-1.5 block text-xs font-medium text-white/60"
                    >
                      {t.auth.passwordLabel}
                    </label>
                    <Input
                      id="register-password"
                      type="password"
                      autoComplete="new-password"
                      required
                      disabled={!authControlsReady || isRegisterLoading}
                      value={registerPassword}
                      onChange={(e) => setRegisterPassword(e.target.value)}
                      placeholder={t.auth.registerPasswordPlaceholder}
                      className="h-10 rounded-md border-white/10 bg-white/[0.03] text-sm text-white placeholder:text-white/25 focus-visible:border-white/25 focus-visible:ring-white/10"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="confirm-password"
                      className="mb-1.5 block text-xs font-medium text-white/60"
                    >
                      {t.auth.confirmPasswordLabel}
                    </label>
                    <Input
                      id="confirm-password"
                      type="password"
                      autoComplete="new-password"
                      required
                      disabled={!authControlsReady || isRegisterLoading}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder={t.auth.confirmPasswordPlaceholder}
                      className="h-10 rounded-md border-white/10 bg-white/[0.03] text-sm text-white placeholder:text-white/25 focus-visible:border-white/25 focus-visible:ring-white/10"
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={!authControlsReady || isRegisterLoading}
                    className="mt-1 h-10 w-full rounded-md bg-white text-sm font-medium text-black hover:bg-white/90"
                  >
                    {isRegisterLoading ? (
                      <Loader2Icon className="mr-2 size-4 animate-spin" />
                    ) : (
                      <ArrowRightIcon className="mr-2 size-4" />
                    )}
                    {isRegisterLoading
                      ? t.auth.creatingAccount
                      : t.auth.createAccountAction}
                  </Button>
                </form>

                <p className="mt-4 text-center text-sm text-white/40">
                  {t.auth.alreadyHaveAccount}{" "}
                  <button
                    type="button"
                    disabled={!authControlsReady || isRegisterLoading}
                    onClick={() => updateTab("login")}
                    className="cursor-pointer font-medium text-white/70 hover:text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60"
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
