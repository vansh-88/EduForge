import { HeadingBlock } from './blocks/HeadingBlock';
import { ParagraphBlock } from './blocks/ParagraphBlock';
import { CodeBlock } from './blocks/CodeBlock';
import { VideoBlock } from './blocks/VideoBlock';
import { McqBlock } from './blocks/McqBlock';
import { blockAnchorId } from '../../utils/paths';

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

      const rendered = (() => {
        switch (block.type) {
          case 'heading':
            return <HeadingBlock block={block} />;

          case 'paragraph':
            return <ParagraphBlock block={block} />;

          case 'code':
            return <CodeBlock block={block} />;

          case 'video':
            return <VideoBlock block={block} />;

          case 'mcq':
            return (
              <McqBlock
                block={block}
                state={quizByQuestionId?.[block.id]}
                onAnswer={onAnswer}
              />
            );

          default:
            return null;
        }
      })();

      if (!rendered) return null;

      /*
       * A wrapper rather than an id on each block component: it keeps the anchor in
       * one place instead of threading a prop through five components that have no
       * other reason to know their own position.
       *
       * scroll-mt keeps the target clear of the sticky navbar — without it the
       * browser scrolls the anchor to y=0, underneath the header, and the reader
       * lands above the passage they asked about.
       */
      return (
        <div key={key} id={blockAnchorId(index)} className="scroll-mt-24">
          {rendered}
        </div>
      );
    })}
  </>
);
