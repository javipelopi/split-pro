import { zodResolver } from '@hookform/resolvers/zod';
import {
  SiAuth0,
  SiAuthelia,
  SiAuthentik,
  SiGitlab,
  SiKeycloak,
} from '@icons-pack/react-simple-icons';
import { type GetServerSideProps, type NextPage } from 'next';
import { type ClientSafeProvider, getProviders, signIn } from 'next-auth/react';
import { type TFunction, useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { LanguageSelector } from '~/components/LanguageSelector';
import { Button } from '~/components/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '~/components/ui/form';
import { Input } from '~/components/ui/input';
import { LoadingSpinner } from '~/components/ui/spinner';
import { env } from '~/env';
import { getServerAuthSession } from '~/server/auth';
import { customServerSideTranslations } from '~/utils/i18n/server';

const providerSvgs = {
  authentik: <SiAuthentik />,
  authelia: <SiAuthelia />,
  auth0: <SiAuth0 />,
  keycloak: <SiKeycloak />,
  gitlab: <SiGitlab />,
};

const providerTypeGuard = (providerId: string): providerId is keyof typeof providerSvgs =>
  providerId in providerSvgs;

const loginSchema = (t: TFunction) =>
  z.object({
    email: z
      .string({ required_error: t('errors.email_required') })
      .email({ message: t('errors.email_invalid') }),
    password: z
      .string({ required_error: t('errors.password_required') })
      .min(1, { message: t('errors.password_required') }),
  });

const registerSchema = (t: TFunction) =>
  z.object({
    name: z
      .string({ required_error: t('errors.name_required') })
      .min(1, { message: t('errors.name_required') }),
    email: z
      .string({ required_error: t('errors.email_required') })
      .email({ message: t('errors.email_invalid') }),
    password: z
      .string({ required_error: t('errors.password_required') })
      .min(8, { message: t('errors.password_min_length') }),
  });

type LoginFormValues = z.infer<ReturnType<typeof loginSchema>>;
type RegisterFormValues = z.infer<ReturnType<typeof registerSchema>>;

const Home: NextPage<{
  error: string;
  feedbackEmail: string;
  providers: ClientSafeProvider[];
  callbackUrl?: string;
}> = ({ error, providers: serverProviders, feedbackEmail, callbackUrl }) => {
  const { t } = useTranslation();
  const [isRegistering, setIsRegistering] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [providers, setProviders] = useState<ClientSafeProvider[]>(serverProviders);
  const [isLoadingProviders, setIsLoadingProviders] = useState(false);

  const loginForm = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema(t)),
    defaultValues: { email: '', password: '' },
  });

  const registerForm = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema(t)),
    defaultValues: { name: '', email: '', password: '' },
  });

  // Client-side fallback for getProviders when server-side call fails
  useEffect(() => {
    if (serverProviders.length > 0) {
      return;
    }

    void (async () => {
      setIsLoadingProviders(true);
      try {
        const clientProviders = await getProviders();
        if (clientProviders && Object.keys(clientProviders).length > 0) {
          setProviders(Object.values(clientProviders));
        } else {
          throw new Error('No providers returned from getProviders()');
        }
      } catch (error) {
        console.error('Error fetching providers client-side:', error);
        toast.error(t('errors.no_providers'), { duration: 8000 });
      } finally {
        setIsLoadingProviders(false);
      }
    })();
  }, [serverProviders.length, t]);

  useEffect(() => {
    if (error) {
      if ('SignupDisabled' === error) {
        toast.error(t('errors.signup_disabled'), { duration: 5000 });
      } else if ('SessionRequired' === error) {
        return;
      } else if ('CredentialsSignin' === error) {
        toast.error(t('errors.invalid_credentials'), { duration: 5000 });
      } else {
        toast.error(t('errors.signin_error') + error);
        console.error('Error during sign-in:', error);
      }
    }
  }, [error, t]);

  const onLoginSubmit = useCallback(
    async (values: LoginFormValues) => {
      setIsSubmitting(true);
      try {
        const result = await signIn('credentials', {
          email: values.email.toLowerCase(),
          password: values.password,
          callbackUrl: callbackUrl || '/balances',
          redirect: false,
        });

        if (result?.error) {
          toast.error(t('errors.invalid_credentials'));
        } else if (result?.url) {
          window.location.href = result.url;
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [callbackUrl, t],
  );

  const onRegisterSubmit = useCallback(
    async (values: RegisterFormValues) => {
      setIsSubmitting(true);
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: values.name,
            email: values.email.toLowerCase(),
            password: values.password,
          }),
        });

        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          toast.error(data.error ?? t('errors.something_went_wrong'));
          return;
        }

        // Auto-login after registration
        const result = await signIn('credentials', {
          email: values.email.toLowerCase(),
          password: values.password,
          callbackUrl: callbackUrl || '/balances',
          redirect: false,
        });

        if (result?.url) {
          window.location.href = result.url;
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [callbackUrl, t],
  );

  const handleProviderSignIn = useCallback(
    (providerId: string) => () => signIn(providerId, { callbackUrl }),
    [callbackUrl],
  );

  const oauthProviders = useMemo(
    () => providers.filter((p) => 'credentials' !== p.id),
    [providers],
  );

  const feedbackEmailLink = useMemo(() => `mailto:${feedbackEmail}`, [feedbackEmail]);

  return (
    <>
      <main className="flex h-full flex-col justify-center lg:justify-normal">
        <div className="flex flex-col items-center lg:mt-20">
          <div className="mb-5 flex items-center gap-4">
            <p className="text-primary text-3xl">{t('meta.application_name')}</p>
          </div>
          <div className="mb-10 flex items-center gap-4">
            <LanguageSelector />
          </div>

          {isLoadingProviders ? (
            <div className="flex h-[200px] w-[300px] items-center justify-center">
              <LoadingSpinner className="h-8 w-8" />
            </div>
          ) : (
            <>
              {isRegistering ? (
                <Form {...registerForm}>
                  <form
                    onSubmit={registerForm.handleSubmit(onRegisterSubmit)}
                    className="w-[300px] space-y-4"
                  >
                    <FormField
                      control={registerForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('auth.name')}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t('auth.name_placeholder')}
                              className="text-lg"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={registerForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('auth.email')}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t('auth.email_placeholder')}
                              className="text-lg"
                              type="email"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={registerForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('auth.password')}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t('auth.password_placeholder')}
                              className="text-lg"
                              type="password"
                              {...field}
                            />
                          </FormControl>
                          <FormDescription>{t('auth.password_hint')}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      className="mt-2 w-full bg-white hover:bg-gray-100 focus:bg-gray-100"
                      type="submit"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? t('auth.registering') : t('auth.register')}
                    </Button>
                    <p className="text-muted-foreground text-center text-sm">
                      {t('auth.already_have_account')}{' '}
                      <button
                        type="button"
                        className="text-primary underline"
                        onClick={() => setIsRegistering(false)}
                      >
                        {t('auth.sign_in')}
                      </button>
                    </p>
                  </form>
                </Form>
              ) : (
                <>
                  <Form {...loginForm}>
                    <form
                      onSubmit={loginForm.handleSubmit(onLoginSubmit)}
                      className="w-[300px] space-y-4"
                    >
                      <FormField
                        control={loginForm.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('auth.email')}</FormLabel>
                            <FormControl>
                              <Input
                                placeholder={t('auth.email_placeholder')}
                                className="text-lg"
                                type="email"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={loginForm.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('auth.password')}</FormLabel>
                            <FormControl>
                              <Input
                                placeholder={t('auth.password_placeholder')}
                                className="text-lg"
                                type="password"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button
                        className="mt-2 w-full bg-white hover:bg-gray-100 focus:bg-gray-100"
                        type="submit"
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? t('auth.signing_in') : t('auth.sign_in')}
                      </Button>
                      <p className="text-muted-foreground text-center text-sm">
                        {t('auth.no_account')}{' '}
                        <button
                          type="button"
                          className="text-primary underline"
                          onClick={() => setIsRegistering(true)}
                        >
                          {t('auth.register')}
                        </button>
                      </p>
                    </form>
                  </Form>

                  {oauthProviders.length > 0 && (
                    <>
                      <div className="mt-6 flex w-[300px] items-center justify-between gap-2">
                        <p className="bg-background z-10 ml-[150px] -translate-x-1/2 px-4 text-sm">
                          {t('ui.or')}
                        </p>
                        <div className="absolute h-px w-[300px] bg-linear-to-r from-zinc-800 via-zinc-300 to-zinc-800" />
                      </div>
                      {oauthProviders.map((provider) => (
                        <Button
                          className="mx-auto my-2 flex w-[300px] items-center gap-3 bg-white hover:bg-gray-100 focus:bg-gray-100"
                          onClick={handleProviderSignIn(provider.id)}
                          key={provider.id}
                        >
                          {providerTypeGuard(provider.id) && providerSvgs[provider.id]}
                          {t('auth.continue_with', { provider: provider.name })}
                        </Button>
                      ))}
                    </>
                  )}
                </>
              )}

              {feedbackEmail && (
                <p className="text-muted-foreground mt-6 w-[300px] text-center text-sm">
                  {t('auth.trouble_logging_in')}
                  <br />
                  {/* oxlint-disable-next-line next/no-html-link-for-pages */}
                  <a className="underline" href={feedbackEmailLink}>
                    {feedbackEmail ?? ''}
                  </a>
                </p>
              )}
            </>
          )}
        </div>
      </main>
    </>
  );
};

export default Home;

export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = await getServerAuthSession(context);
  let providers: Record<string, ClientSafeProvider> | null = null;
  try {
    providers = await getProviders();
  } catch (error) {
    console.error(error);
  }
  const { callbackUrl, error } = context.query;

  if (session) {
    const redirectUrl = '/home' === env.DEFAULT_HOMEPAGE ? '/balances' : env.DEFAULT_HOMEPAGE;
    const destination = callbackUrl && !Array.isArray(callbackUrl) ? callbackUrl : redirectUrl;

    return {
      redirect: {
        destination: destination ?? '/balances',
        permanent: false,
      },
    };
  }

  return {
    props: {
      ...(await customServerSideTranslations(context.locale, ['common'])),
      error: typeof error === 'string' ? error : '',
      feedbackEmail: env.FEEDBACK_EMAIL ?? '',
      providers: Object.values(providers ?? {}),
      callbackUrl: callbackUrl && !Array.isArray(callbackUrl) ? callbackUrl : '',
    },
  };
};
