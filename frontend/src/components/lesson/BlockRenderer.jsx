import { HeadingBlock } from './blocks/HeadingBlock';
import { ParagraphBlock } from './blocks/ParagraphBlock';
import { CodeBlock } from './blocks/CodeBlock';
import { VideoBlock } from './blocks/VideoBlock';
import { McqBlock } from './blocks/McqBlock';

/**
 * Renders a lesson's content blocks.
 *
 * The block types mirror the discriminated union the generator is constrained
 * to (see backend schemas/lesson.schema.js). An unrecognized type renders
 * nothing rather than throwing: a schema that grows a new block type should
 * degrade to a slightly thinner lesson, never to a blank error page over
 * content that is otherwise perfectly readable.
 */
export const BlockRenderer = ({ blocks = [], quizByQuestionId, onAnswer }) => (
  <>
    {blocks.map((block, index) => {
      // MCQs carry `id` and video blocks carry `slotId`, both stable and
      // server-generated. The rest are positional, which is safe because content
      // is immutable once READY. Keying a video by its slot rather than its
      // position matters: an <iframe> keyed by index would remount — restarting
      // playback — if block ordering ever changed.
      const key = block.id ?? block.slotId ?? `${block.type}-${index}`;

      switch (block.type) {
        case 'heading':
          return <HeadingBlock key={key} block={block} />;

        case 'paragraph':
          return <ParagraphBlock key={key} block={block} />;

        case 'code':
          return <CodeBlock key={key} block={block} />;

        case 'video':
          return <VideoBlock key={key} block={block} />;

        case 'mcq':
          return (
            <McqBlock
              key={key}
              block={block}
              state={quizByQuestionId?.[block.id]}
              onAnswer={onAnswer}
            />
          );

        default:
          return null;
      }
    })}
  </>
);
