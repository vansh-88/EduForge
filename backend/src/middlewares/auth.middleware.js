import { auth } from 'express-oauth2-jwt-bearer';
import { AUTH0_ISSUER_BASE_URL, AUTH0_AUDIENCE } from '../config/env.config.js';
import { User } from '../models/user.model.js';
import { ApiError } from '../utils/ApiError.js';

const CLAIM_NAMESPACE = 'https://eduforge.app';

// 1. Verify the JWT access token
export const requireAuth = auth({
  issuerBaseURL: AUTH0_ISSUER_BASE_URL,
  audience: AUTH0_AUDIENCE,
  tokenSigningAlg: 'RS256',
});


// 2. Just-in-time provisioning: map the Auth0 subject to a local User
export const attachUser = async (req, res, next) => {
  const payload = req.auth?.payload;

  if (!payload?.sub) {
    throw ApiError.unauthorized('Access token is missing a subject claim');
  }

  const auth0Id = payload.sub;
  const email = payload[`${CLAIM_NAMESPACE}/email`];
  const name = payload[`${CLAIM_NAMESPACE}/name`];
  const picture = payload[`${CLAIM_NAMESPACE}/picture`];

  // A missing claim means the Post-Login Action isn't deployed or isn't in the flow — a server misconfiguration, not a malformed client request.
  if (!email) {
    throw new ApiError(500, 'Access token is missing the email claim', {
      code: 'AUTH0_CLAIMS_MISCONFIGURED',
    });
  }

  try {
    req.user = await User.findOneAndUpdate(
      { auth0Id },
      { $setOnInsert: { auth0Id, email, name, picture } },
      { upsert: true, returnDocument: 'after', runValidators: true }
    );
  } catch (error) {
    // Two parallel first-requests for the same new user.
    if (error.code !== 11000) throw error;
    req.user = await User.findOne({ auth0Id });
  }

  if (!req.user) {
    throw new ApiError(500, 'Failed to provision user', { code: 'USER_PROVISION_FAILED' });
  }

  next();
};