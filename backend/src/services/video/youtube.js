import {
  YOUTUBE_API_KEY,
  YOUTUBE_MIN_DURATION_S,
  YOUTUBE_MAX_DURATION_S,
} from '../../config/env.config.js';

const API_ROOT = 'https://www.googleapis.com/youtube/v3';

// Quota costs, from YouTube Data API v3. search.list is the expensive one by two
// orders of magnitude, which is what shapes the whole enrichment design: search
// once, then learn everything else about the candidates for a single unit.
export const SEARCH_COST = 100;
export const VIDEOS_COST = 1;

const CANDIDATE_COUNT = 10;

/**
 * Raised when the provider could not complete a search. Distinct from "searched
 * fine, found nothing suitable", which is an empty result rather than a throw —
 * the caller turns the former into FAILED and the latter into UNAVAILABLE.
 */
export class VideoProviderError extends Error {
  constructor(message, { status = null, reason = null } = {}) {
    super(message);
    this.name = 'VideoProviderError';
    this.status = status;
    this.reason = reason;
  }
}

/** ISO 8601 duration (PT1H2M3S) → seconds. */
export function parseIsoDuration(iso) {
  if (typeof iso !== 'string') return null;

  const match = iso.match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;

  const [, days, hours, minutes, seconds] = match;

  return (
    Number(days || 0) * 86400 +
    Number(hours || 0) * 3600 +
    Number(minutes || 0) * 60 +
    Number(seconds || 0)
  );
}

async function callApi(path, params) {
  if (!YOUTUBE_API_KEY) {
    throw new VideoProviderError('YOUTUBE_API_KEY is not configured', {
      reason: 'NOT_CONFIGURED',
    });
  }

  const url = new URL(`${API_ROOT}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  url.searchParams.set('key', YOUTUBE_API_KEY);

  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new VideoProviderError(`YouTube request failed: ${error.message}`, {
      reason: 'NETWORK',
    });
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const detail = body?.error?.errors?.[0];
    throw new VideoProviderError(
      detail?.message || `YouTube API returned ${response.status}`,
      { status: response.status, reason: detail?.reason ?? null }
    );
  }

  return body;
}

/**
 * Candidate ids for a query. Costs SEARCH_COST.
 *
 * `videoEmbeddable=true` filters server-side, but it is not trustworthy on its
 * own — the authoritative flag comes back from videos.list below, and a video
 * that cannot be embedded renders as an error box rather than a lesson aid.
 */
async function searchCandidates(query, { language = 'en' } = {}) {
  const body = await callApi('search', {
    part: 'snippet',
    q: query,
    type: 'video',
    videoEmbeddable: 'true',
    maxResults: CANDIDATE_COUNT,
    relevanceLanguage: language,
    safeSearch: 'strict',
  });

  // Order is YouTube's own relevance ranking, and is preserved downstream —
  // it is the ranking signal, since nothing cheaper is better.
  return (body?.items ?? [])
    .map((item) => item?.id?.videoId)
    .filter(Boolean);
}

/** Full detail for up to 50 ids in one call. Costs VIDEOS_COST regardless of count. */
async function hydrateCandidates(videoIds) {
  if (videoIds.length === 0) return [];

  const body = await callApi('videos', {
    part: 'snippet,contentDetails,status',
    id: videoIds.join(','),
  });

  const byId = new Map(
    (body?.items ?? []).map((item) => [
      item.id,
      {
        videoId: item.id,
        title: item.snippet?.title ?? null,
        channelTitle: item.snippet?.channelTitle ?? null,
        thumbnailUrl:
          item.snippet?.thumbnails?.medium?.url ??
          item.snippet?.thumbnails?.default?.url ??
          null,
        durationSeconds: parseIsoDuration(item.contentDetails?.duration),
        embeddable: item.status?.embeddable === true,
        isPublic: item.status?.privacyStatus === 'public',
        liveState: item.snippet?.liveBroadcastContent ?? 'none',
      },
    ])
  );

  // Re-impose the search order; videos.list does not preserve it.
  return videoIds.map((id) => byId.get(id)).filter(Boolean);
}

/**
 * Hard filters only — no scoring. There is no ground truth to tune weights
 * against yet, and YouTube's own relevance order is a better guess than an
 * invented formula. `pickBest` is the seam if that changes.
 */
export function isUsable(candidate) {
  if (!candidate.embeddable) return false;
  if (!candidate.isPublic) return false;

  // Live and upcoming broadcasts have no stable duration and are not lessons.
  if (candidate.liveState && candidate.liveState !== 'none') return false;

  const { durationSeconds } = candidate;
  if (durationSeconds == null) return false;
  if (durationSeconds < YOUTUBE_MIN_DURATION_S) return false;
  if (durationSeconds > YOUTUBE_MAX_DURATION_S) return false;

  return true;
}

export function pickBest(candidates) {
  return candidates.find(isUsable) ?? null;
}

/**
 * Resolve one query to a usable video, or null.
 *
 * Returns `{ video, unitsSpent }` so the caller can account for quota even when
 * the search found nothing — the units were spent either way.
 */
async function resolveQuery(query, { language } = {}) {
  const ids = await searchCandidates(query, { language });
  let unitsSpent = SEARCH_COST;

  if (ids.length === 0) return { video: null, unitsSpent };

  const candidates = await hydrateCandidates(ids);
  unitsSpent += VIDEOS_COST;

  const best = pickBest(candidates);

  if (!best) return { video: null, unitsSpent };

  return {
    video: {
      provider: 'youtube',
      videoId: best.videoId,
      title: best.title,
      channelTitle: best.channelTitle,
      thumbnailUrl: best.thumbnailUrl,
      durationSeconds: best.durationSeconds,
    },
    unitsSpent,
  };
}

export const youtubeProvider = {
  name: 'youtube',
  searchCost: SEARCH_COST,
  resolveQuery,
};
