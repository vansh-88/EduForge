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
      // MCQs carry a stable server-generated id; the rest are positional, and
      // content is immutable once READY, so the index is a safe key for them.
      const key = block.id ?? `${block.type}-${index}`;

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
