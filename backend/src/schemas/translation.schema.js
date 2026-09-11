import { z } from 'zod';

/** Languages a lesson can be translated into. The route and the model share this. */
export const TRANSLATION_LANGUAGES = ['hinglish'];

// Body of POST /lessons/:lessonId/translations.
export const requestTranslationSchema = z.object({
  language: z
    .enum(TRANSLATION_LANGUAGES, {
      required_error: 'language is required',
      invalid_type_error: `language must be one of: ${TRANSLATION_LANGUAGES.join(', ')}`,
    })
    .default('hinglish'),
});

/**
 * What the model returns for one batch of strings.
 *
 * Flat and keyed, never the lesson's block structure — see
 * services/translation/translatable.js for why the structure is rebuilt from the
 * original instead of being round-tripped through the model.
 *
 * No `max` on `text`: Gemini treats maxLength as advisory (documented on the
 * lesson schema), so a bound here would not prevent a long string, only make a
 * valid-but-verbose translation fail validation and burn a retry. Key coverage is
 * what actually has to hold, and assertTranslationCoverage checks that.
 */
export const translationOutputSchema = z.object({
  items: z
    .array(
      z.object({
        key: z.string().trim().min(1, 'key cannot be empty'),
        text: z.string().trim().min(1, 'Translated text cannot be empty'),
      })
    )
    .min(1, 'Translation must contain at least one item'),
});
