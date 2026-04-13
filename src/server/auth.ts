import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { compare } from 'bcryptjs';
import { type GetServerSidePropsContext } from 'next';
import { type DefaultSession, type NextAuthOptions, type User, getServerSession } from 'next-auth';
import { type Adapter, type AdapterAccount, type AdapterUser } from 'next-auth/adapters';
import AuthentikProvider from 'next-auth/providers/authentik';
import CredentialsProvider from 'next-auth/providers/credentials';
import KeycloakProvider from 'next-auth/providers/keycloak';

import { env } from '~/env';
import { db } from '~/server/db';

if (env.NODE_TLS_REJECT_UNAUTHORIZED) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = env.NODE_TLS_REJECT_UNAUTHORIZED;
}

import type { OAuthConfig } from 'next-auth/providers/oauth';

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module 'next-auth' {
  interface Session extends DefaultSession {
    user: DefaultSession['user'] & {
      id: number;
      currency: string;
      obapiProviderId?: string;
      bankingId?: string;
      preferredLanguage: string;
      hiddenFriendIds: number[];
      // ...other properties
      // Role: UserRole;
    };
  }

  interface User {
    id: number;
    name: string;
    email: string;
    image: string;
    currency: string;
    obapiProviderId?: string;
    bankingId?: string;
    preferredLanguage: string;
    hiddenFriendIds: number[];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: number;
    currency: string;
    obapiProviderId?: string;
    bankingId?: string;
    preferredLanguage: string;
    hiddenFriendIds: number[];
  }
}

const SplitProPrismaAdapter = (...args: Parameters<typeof PrismaAdapter>): Adapter => {
  const prismaAdapter = PrismaAdapter(...args);

  return {
    ...prismaAdapter,
    createUser: (user: Omit<AdapterUser, 'id'>): Promise<AdapterUser> => {
      // oxlint-disable-next-line typescript/no-unsafe-assignment
      const prismaCreateUser = prismaAdapter.createUser;

      if (env.INVITE_ONLY) {
        throw new Error('This instance is Invite Only');
      }

      if (!prismaCreateUser) {
        // This should never happen but typing says it's possible.
        throw new Error('Prisma Adapter lacks User Creation');
      }

      // oxlint-disable-next-line typescript/no-unsafe-return, typescript/no-unsafe-call
      return prismaCreateUser(user);
    },
    linkAccount: async (account: AdapterAccount) => {
      // oxlint-disable-next-line typescript/no-unsafe-assignment
      const originalLinkAccount = prismaAdapter.linkAccount;

      if (!originalLinkAccount) {
        throw new Error('Adapter is missing the linkAccount method.');
      }

      // Keycloak and Gitlab provide some non-standard fields that do not exist in the prisma schema.
      // We strip them out before passing them on to the original adapter.
      if ('keycloak' === account.provider) {
        const {
          'not-before-policy': _notBeforePolicy,
          refresh_expires_in: _refresh_expires_in,
          ...standardAccountData
        } = account as AdapterAccount & Record<string, unknown>;

        return originalLinkAccount(standardAccountData as AdapterAccount);
      } else if ('gitlab' === account.provider) {
        const { created_at: _createdAt, ...standardAccountData } = account as AdapterAccount &
          Record<string, unknown>;

        return originalLinkAccount(standardAccountData as AdapterAccount);
      }

      // Default: proceed directly
      return originalLinkAccount(account);
    },
  } as Adapter;
};

/**
 * Options for NextAuth.js used to configure adapters, providers, callbacks, etc.
 *
 * @see https://next-auth.js.org/configuration/options
 */
export const authOptions: NextAuthOptions = {
  pages: {
    signIn: '/auth/signin',
  },
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = Number(user.id);
        token.currency = user.currency;
        token.obapiProviderId = user.obapiProviderId;
        token.bankingId = user.bankingId;
        token.preferredLanguage = user.preferredLanguage;
        token.hiddenFriendIds = user.hiddenFriendIds;
      }
      return token;
    },
    session: ({ session, token }) => ({
      ...session,
      user: {
        ...session.user,
        id: token.id,
        currency: token.currency,
        obapiProviderId: token.obapiProviderId,
        bankingId: token.bankingId,
        preferredLanguage: token.preferredLanguage,
        hiddenFriendIds: token.hiddenFriendIds,
      },
    }),
    signIn() {
      return true;
    },
  },
  adapter: SplitProPrismaAdapter(db),
  providers: getProviders(),
  events: {
    createUser: async ({ user }) => {
      // Check if the user's name is empty
      if ((!user.name || '' === user.name.trim()) && user.email) {
        // Define the logic to update the user's name here
        const [updatedName] = user.email.split('@');

        // Use your database client to update the user's name
        await db.user.update({
          where: { id: user.id },
          data: { name: updatedName },
        });
      }
    },
  },
};

/**
 * Wrapper for `getServerSession` so that you don't need to import the `authOptions` in every file.
 *
 * @see https://next-auth.js.org/configuration/nextjs
 */
export const getServerAuthSession = (ctx: {
  req: GetServerSidePropsContext['req'];
  res: GetServerSidePropsContext['res'];
}) => getServerSession(ctx.req, ctx.res, authOptions);

export const getServerAuthSessionForSSG = async (context: GetServerSidePropsContext) => {
  console.log('Before getting session');
  const session = await getServerAuthSession(context);
  console.log('After getting session');

  if (!session?.user?.email) {
    return {
      redirect: {
        destination: '/',
        permanent: false,
      },
    };
  }

  return {
    props: {
      user: session.user,
    },
  };
};

/**
 * Get providers to enable
 */
function getProviders() {
  const providersList = [];

  providersList.push(
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await db.user.findUnique({
          where: { email: credentials.email.toLowerCase() },
        });

        if (!user?.passwordHash) {
          return null;
        }

        const isValid = await compare(credentials.password, user.passwordHash);
        if (!isValid) {
          return null;
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          currency: user.currency,
          obapiProviderId: user.obapiProviderId ?? undefined,
          bankingId: user.bankingId ?? undefined,
          preferredLanguage: user.preferredLanguage,
          hiddenFriendIds: user.hiddenFriendIds,
        } as unknown as User;
      },
    }),
  );

  if (env.AUTHENTIK_ID && env.AUTHENTIK_SECRET && env.AUTHENTIK_ISSUER) {
    providersList.push(
      AuthentikProvider({
        clientId: env.AUTHENTIK_ID,
        clientSecret: env.AUTHENTIK_SECRET,
        issuer: env.AUTHENTIK_ISSUER,
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }

  if (env.KEYCLOAK_ID && env.KEYCLOAK_SECRET && env.KEYCLOAK_ISSUER) {
    providersList.push(
      KeycloakProvider({
        clientId: env.KEYCLOAK_ID,
        clientSecret: env.KEYCLOAK_SECRET,
        issuer: env.KEYCLOAK_ISSUER,
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }

  if (env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET && env.OIDC_WELL_KNOWN_URL) {
    providersList.push({
      id: env.OIDC_NAME?.toLowerCase() ?? 'oidc',
      name: env.OIDC_NAME ?? 'OIDC',
      clientId: env.OIDC_CLIENT_ID,
      clientSecret: env.OIDC_CLIENT_SECRET,
      type: 'oauth',
      wellKnown: env.OIDC_WELL_KNOWN_URL,
      authorization: { params: { scope: 'openid email profile' } },
      allowDangerousEmailAccountLinking: env.OIDC_ALLOW_DANGEROUS_EMAIL_LINKING,
      idToken: true,
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: profile.picture,
        } as unknown as User;
      },
    } satisfies OAuthConfig<{
      sub: string;
      name: string;
      email: string;
      picture: string;
      preferred_username: string;
    }>);
  }

  return providersList;
}

/**
 * Validates the environment variables that are related to authentication.
 * Credentials provider is always available so at least one provider exists.
 */
export function validateAuthEnv() {
  console.log('Validating auth env');
  if (!process.env.SKIP_ENV_VALIDATION) {
    const providers = getProviders();
    if (0 === providers.length) {
      throw new Error(
        'No authentication providers are configured, at least one is required. Learn more here: https://github.com/javipelopi/split-pro#setting-up-the-environment',
      );
    }
  }
}
