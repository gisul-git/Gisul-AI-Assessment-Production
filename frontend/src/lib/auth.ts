import { GetServerSidePropsContext, GetServerSidePropsResult } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../pages/api/auth/[...nextauth]";

/**
 * Server-side authentication check utility
 * Use this in getServerSideProps to protect pages
 */
export async function requireAuth(
  context: GetServerSidePropsContext
): Promise<GetServerSidePropsResult<{ session: any }>> {
  const session = await getServerSession(context.req, context.res, authOptions);

  if (!session) {
    return {
      redirect: {
        destination: "/auth/signin",
        permanent: false,
      },
    };
  }

  return {
    props: {
      session: JSON.parse(JSON.stringify(session)), // Serialize session for client
    },
  };
}

