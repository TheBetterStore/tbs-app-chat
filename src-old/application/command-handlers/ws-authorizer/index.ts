import { APIGatewayRequestAuthorizerEventV2 } from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

const ALLOWED_ORIGINS = (process.env.ALLOWED_CORS_DOMAINS || '').split(',');
const ALLOWED_USER = process.env.ALLOWED_USER || '';

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.USER_POOL_ID || '',
  clientId: process.env.USER_POOL_CLIENT_ID || '',
  tokenUse: 'id',
});

export const handler = async (event: APIGatewayRequestAuthorizerEventV2) => {
  const qs = event.queryStringParameters || {};
  const token = qs.token || '';
  const origin = event.headers?.['Origin'] || event.headers?.['origin'] || '';

  // Origin validation (defense-in-depth, spoofable but still useful)
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    console.warn('Rejected origin:', origin);
    return { isAuthorized: false };
  }

  try {
    const payload = await verifier.verify(token);
    const username = (payload['cognito:username'] as string) || '';

    if (ALLOWED_USER && username !== ALLOWED_USER) {
      console.warn('Unauthorized user:', username);
      return { isAuthorized: false };
    }

    return {
      isAuthorized: true,
      context: { username },
    };
  } catch (err) {
    console.warn('Token verification failed:', err);
    return { isAuthorized: false };
  }
};
